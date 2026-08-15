const bridge = process.env.PROTOUNIVERSE_BRIDGE_URL ?? "http://127.0.0.1:8787";
try {
  const response = await fetch(new URL("/api/save-state", bridge), { method: "POST", signal: AbortSignal.timeout(30_000) });
  const result = await response.json(); if (!response.ok) throw new Error(result.message ?? result.error ?? `HTTP ${response.status}`);
  process.stdout.write(`Saved ${result.universe} at tick ${result.tick}\nID: ${result.id}\nPath: ${result.path}\nSHA-256: ${result.checksum.value}\n`);
} catch (error) { process.stderr.write(`Universe save failed: ${error instanceof Error ? error.message : error}\n`); process.exitCode = 1; }
