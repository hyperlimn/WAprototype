import { SAVE_STATE_SCHEMA_VERSION } from "../../src/simulation/saveState.js";
import type { Heartbeat } from "../types.js";

export function assertCompatibleSaveProtocol(heartbeat: Heartbeat | null): void {
  const actual = heartbeat?.saveStateSchemaVersion;
  if (actual !== SAVE_STATE_SCHEMA_VERSION) throw new Error(
    `Authoritative browser save schema ${actual ?? "unknown"} does not match Bridge/API schema ${SAVE_STATE_SCHEMA_VERSION}; restart the managed runtime to activate one coherent build`,
  );
}
