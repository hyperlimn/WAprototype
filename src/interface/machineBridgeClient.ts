import type { Universe } from "../simulation/universe";
import { SIMULATION_VERSION } from "../simulation/universe";
import { buildWorldSnapshot } from "./worldSnapshot";

export const MACHINE_INTERFACE_VERSION = "protouniverse-machine-interface/4";
export const HEARTBEAT_INTERVAL_MS = 1_000;
export const SNAPSHOT_INTERVAL_MS = 5_000;

export interface MachineBridgeStatus {
  connected: boolean;
  lastPublishAt: number | null;
  lastSnapshotDurationMs: number | null;
}

export function startMachineBridgeClient(
  getUniverse: () => Universe,
  onStatus: (status: MachineBridgeStatus) => void,
): () => void {
  let socket: WebSocket | null = null;
  let reconnectTimer = 0;
  let heartbeatTimer = 0;
  let snapshotTimer = 0;
  let occurrenceTimer = 0;
  let stopped = false;
  let lastSequence = -1;
  const status: MachineBridgeStatus = { connected: false, lastPublishAt: null, lastSnapshotDurationMs: null };
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
      seed: universe.seed, currentTick: universe.state.ticks, entityCount: universe.entities.length });
  };
  const snapshot = () => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    const started = performance.now();
    const value = buildWorldSnapshot(getUniverse());
    status.lastSnapshotDurationMs = performance.now() - started;
    send({ type: "snapshot", interfaceVersion: MACHINE_INTERFACE_VERSION, snapshot: value,
      serializationDurationMs: status.lastSnapshotDurationMs });
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
