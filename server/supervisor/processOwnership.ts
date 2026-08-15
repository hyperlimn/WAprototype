import { spawn } from "node:child_process";
import path from "node:path";

export interface RuntimeProcess { pid: number; parentPid: number; commandLine: string; startTime?: string }
export type ProtoUniverseProcessKind = "frontend" | "bridge-api" | "supervisor" | "operator-child";
export interface VerifiedRuntimeProcess extends RuntimeProcess { kind: ProtoUniverseProcessKind; normalizedCommandLine: string }

const normalized = (value: string): string => value.replaceAll("/", "\\").toLowerCase();
const marker = (command: string): ProtoUniverseProcessKind | null => {
  if (/server\\supervisor\\supervisorindex\.ts(?:\s|"|$)/.test(command)) return "supervisor";
  if (/server\\index\.ts(?:\s|"|$)/.test(command)) return "bridge-api";
  if (/node_modules\\vite\\(?:bin\\vite\.js|dist\\node\\cli\.js)/.test(command)) return "frontend";
  if (/scripts\\(?:observer-loop|lab-once|lab-reveal|universe-save)\.(?:mjs|js)(?:\s|"|$)/.test(command)) return "operator-child";
  return null;
};

export function verifyRepoProcess(root: string, process: RuntimeProcess): VerifiedRuntimeProcess | null {
  if (!Number.isInteger(process.pid) || process.pid <= 0 || /(?:^|[\\\s])codex(?:\.exe)?(?:\s|$)/i.test(process.commandLine)) return null;
  const command = normalized(process.commandLine), repo = `${normalized(path.resolve(root))}\\`;
  const kind = command.includes(repo) ? marker(command) : null;
  return kind ? { ...process, kind, normalizedCommandLine: command } : null;
}

export function staleRepoProcesses(root: string, processes: readonly RuntimeProcess[], keepPids: ReadonlySet<number>): VerifiedRuntimeProcess[] {
  const verified: VerifiedRuntimeProcess[] = [];
  for (const process of processes) { const item = verifyRepoProcess(root, process); if (item && !keepPids.has(item.pid)) verified.push(item); }
  return verified;
}

export interface ProtectedProcessModel { supervisorPid: number; protectedPids: ReadonlySet<number> }

export function protectSupervisorAncestry(supervisorPid: number, processes: readonly RuntimeProcess[]): ProtectedProcessModel {
  const byPid = new Map(processes.map((item) => [item.pid, item]));
  const protectedPids = new Set<number>([supervisorPid]);
  let current = byPid.get(supervisorPid);
  const visited = new Set<number>();
  while (current && current.parentPid > 0 && !visited.has(current.parentPid)) {
    visited.add(current.parentPid); protectedPids.add(current.parentPid); current = byPid.get(current.parentPid);
  }
  return { supervisorPid, protectedPids };
}

export function processTreePids(rootPid: number, processes: readonly RuntimeProcess[]): Set<number> {
  const result = new Set<number>([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of processes) if (result.has(item.parentPid) && !result.has(item.pid)) { result.add(item.pid); changed = true; }
  }
  return result;
}

export function assertTreeTerminationSafe(rootPid: number, processes: readonly RuntimeProcess[], protection: ProtectedProcessModel): Set<number> {
  const tree = processTreePids(rootPid, processes);
  const protectedHit = [...tree].find((pid) => protection.protectedPids.has(pid));
  if (protectedHit !== undefined)
    throw new Error(`candidate process tree contains active supervisor control plane PID ${protectedHit}; termination refused`);
  return tree;
}

export function reverifyRepoProcess(root: string, expected: VerifiedRuntimeProcess, current: RuntimeProcess | undefined): VerifiedRuntimeProcess | null {
  const verified = current && verifyRepoProcess(root, current);
  return verified && verified.pid === expected.pid && verified.kind === expected.kind
    && verified.normalizedCommandLine === expected.normalizedCommandLine
    && (!expected.startTime || !verified.startTime || expected.startTime === verified.startTime) ? verified : null;
}

export async function listWindowsProcesses(): Promise<RuntimeProcess[]> {
  if (process.platform !== "win32") return [];
  const executable = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const script = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,CreationDate | ConvertTo-Json -Compress";
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = ""; child.stdout.on("data", (value) => stdout += value); child.stderr.on("data", (value) => stderr += value);
    child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve(stdout) : reject(new Error(`Process discovery failed: ${stderr.trim() || `exit ${code}`}`)));
  });
  const values = JSON.parse(output || "[]") as any; const records = Array.isArray(values) ? values : [values];
  return records.filter((item) => typeof item?.CommandLine === "string").map((item) => ({ pid: Number(item.ProcessId), parentPid: Number(item.ParentProcessId), commandLine: item.CommandLine,
    startTime: typeof item.CreationDate === "string" ? item.CreationDate : undefined }));
}

export async function terminateWindowsProcessTree(pid: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    child.once("error", reject); child.once("exit", (code) => code === 0 || code === 128 ? resolve() : reject(new Error(`taskkill exited ${code}`)));
  });
}

export async function requestWindowsProcessTreeStop(pid: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("taskkill.exe", ["/pid", String(pid), "/t"], { windowsHide: true, stdio: "ignore" });
    child.once("error", reject); child.once("exit", (code) => code === 0 || code === 128 ? resolve() : reject(new Error(`graceful taskkill exited ${code}`)));
  });
}
