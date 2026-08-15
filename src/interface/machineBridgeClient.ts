import type { Universe } from "../simulation/universe";
import { SIMULATION_VERSION } from "../simulation/universe";
import { buildWorldSnapshot } from "./worldSnapshot";
import { SAVE_STATE_SCHEMA_VERSION } from "../simulation/saveState";

export const MACHINE_INTERFACE_VERSION = "protouniverse-machine-interface/5";
export const HEARTBEAT_INTERVAL_MS = 1_000;
export const SNAPSHOT_INTERVAL_MS = 15_000;

export interface MachineBridgeStatus {
  connected: boolean;
  lastPublishAt: number | null;
  lastSnapshotDurationMs: number | null;
  lastSnapshotBytes: number | null;
}
export interface CounterfactualMachineController {
  machineCreate(args: unknown): unknown;
  machineStatus(): unknown;
  machineCompare(args: { entityId?: number; relationshipId?: string }): unknown;
  machineInspect(args: { entityId?: number; relationshipId?: string }): unknown;
  machineTerminate(): unknown;
}

export function startMachineBridgeClient(
  getUniverse: () => Universe,
  onStatus: (status: MachineBridgeStatus) => void,
  counterfactual?: CounterfactualMachineController,
): () => void {
  let socket: WebSocket | null = null;
  let reconnectTimer = 0;
  let heartbeatTimer = 0;
  let snapshotTimer = 0;
  let occurrenceTimer = 0;
  let stopped = false;
  let lastSequence = -1;
  const status: MachineBridgeStatus = { connected: false, lastPublishAt: null, lastSnapshotDurationMs: null, lastSnapshotBytes: null };
  const report = () => onStatus({ ...status });
  const send = (message: object): boolean => {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    status.lastPublishAt = performance.now();
    report();
    return true;
  };
  const heartbeat = () => {
    const universe = getUniverse();
    send({ type: "heartbeat", interfaceVersion: MACHINE_INTERFACE_VERSION, simulationVersion: SIMULATION_VERSION,
      seed: universe.seed, currentTick: universe.state.ticks, entityCount: universe.entities.length, runtime: universe.runtime,
      saveStateSchemaVersion: SAVE_STATE_SCHEMA_VERSION });
  };
  const snapshot = () => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    const started = performance.now();
    const value = buildWorldSnapshot(getUniverse());
    status.lastSnapshotDurationMs = performance.now() - started;
    status.lastSnapshotBytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    const universe = getUniverse();
    send({ type: "snapshot", interfaceVersion: MACHINE_INTERFACE_VERSION, snapshot: value,
      observationMetrics: {
        buildDurationMs: status.lastSnapshotDurationMs,
        serializedBytes: status.lastSnapshotBytes,
        entityCount: value.entities.length,
        relationshipCount: value.relationships.length,
      },
      simulationTimings: universe.profiler.snapshot(),
    });
  };
  const occurrences = () => {
    const allRecords = getUniverse().occurrences.records;
    if (allRecords.length && allRecords[allRecords.length - 1].sequence < lastSequence) lastSequence = -1;
    const records = allRecords.filter((record) => record.sequence > lastSequence);
    if (!records.length) return;
    if (send({ type: "occurrences", interfaceVersion: MACHINE_INTERFACE_VERSION, occurrences: records })) {
      lastSequence = records[records.length - 1].sequence;
    }
  };
  const connect = () => {
    if (stopped) return;
    socket = new WebSocket("ws://localhost:8787");
    socket.addEventListener("open", () => {
      status.connected = true;
      report();
      heartbeat();
      snapshot();
    });
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type?: string; requestId?: string; operation?:string; args?:unknown };
        if(message.type==="counterfactual-request"&&message.requestId&&counterfactual){try{const result=message.operation==="create"?counterfactual.machineCreate(message.args):message.operation==="status"?counterfactual.machineStatus():message.operation==="compare"?counterfactual.machineCompare((message.args??{}) as {entityId?:number;relationshipId?:string}):message.operation==="inspect"?counterfactual.machineInspect((message.args??{}) as {entityId?:number;relationshipId?:string}):message.operation==="terminate"?counterfactual.machineTerminate():(()=>{throw new Error("Unsupported counterfactual operation");})();send({type:"counterfactual-response",interfaceVersion:MACHINE_INTERFACE_VERSION,requestId:message.requestId,result});}catch(error){send({type:"counterfactual-response",interfaceVersion:MACHINE_INTERFACE_VERSION,requestId:message.requestId,error:error instanceof Error?error.message:"Counterfactual request failed"});}return;}
        if (message.type !== "save-state-request" || !message.requestId) return;
        const universe = getUniverse();
        send({ type: "save-state-response", interfaceVersion: MACHINE_INTERFACE_VERSION, requestId: message.requestId,
          continuation: universe.continuationState() });
      } catch (error) {
        // A malformed bridge control message cannot alter the universe.
      }
    });
    socket.addEventListener("close", () => {
      status.connected = false;
      report();
      if (!stopped) reconnectTimer = window.setTimeout(connect, 2_000);
    });
    socket.addEventListener("error", () => socket?.close());
  };
  connect();
  heartbeatTimer = window.setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
  snapshotTimer = window.setInterval(snapshot, SNAPSHOT_INTERVAL_MS);
  occurrenceTimer = window.setInterval(occurrences, 250);
  return () => {
    stopped = true;
    window.clearTimeout(reconnectTimer);
    window.clearInterval(heartbeatTimer);
    window.clearInterval(snapshotTimer);
    window.clearInterval(occurrenceTimer);
    socket?.close();
  };
}
