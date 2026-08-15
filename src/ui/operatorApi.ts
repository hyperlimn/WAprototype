export type OperatorApiKind = "bridge" | "supervisor";

export async function requestOperatorJson<T = any>(base: string, pathname: string, kind: OperatorApiKind, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${pathname}`, init);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${kind === "supervisor" ? "Supervisor" : "Bridge/API"} transport unavailable: ${detail}`);
  }
  let value: any;
  try { value = await response.json(); }
  catch { throw new Error(`${kind === "supervisor" ? "Supervisor" : "Bridge/API"} returned an invalid HTTP ${response.status} response`); }
  if (!response.ok) {
    const reason = value?.message ?? value?.error ?? `HTTP ${response.status}`;
    throw new Error(`${kind === "supervisor" ? "Supervisor" : "Bridge/API"} ${response.status}: ${reason}`);
  }
  return value as T;
}
