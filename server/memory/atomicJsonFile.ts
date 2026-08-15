import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";

export interface AtomicJsonFileSystem {
  writeAndSync(file: string, contents: string): Promise<void>;
  replace(source: string, destination: string): Promise<void>;
  remove(file: string): Promise<void>;
  delay(ms: number): Promise<void>;
}

const nodeFileSystem: AtomicJsonFileSystem = {
  async writeAndSync(file, contents) {
    const handle = await open(file, "wx");
    try { await handle.writeFile(contents, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
  },
  replace: rename,
  remove: (file) => rm(file, { force: true }),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const queues = new Map<string, Promise<void>>();
const transient = new Set(["EPERM", "EBUSY", "EACCES"]);
export interface AtomicWriteResult { attempts: number; retries: number }

export function atomicJsonFile(file: string, value: unknown, fileSystem: AtomicJsonFileSystem = nodeFileSystem): Promise<AtomicWriteResult> {
  const previous = queues.get(file) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(async () => {
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    let attempts = 0;
    try {
      await fileSystem.writeAndSync(temporary, JSON.stringify(value, null, 2));
      for (;;) {
        attempts++;
        try { await fileSystem.replace(temporary, file); return { attempts, retries: attempts - 1 }; }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (!transient.has(code ?? "") || attempts >= 6) throw error;
          await fileSystem.delay(10 * attempts);
        }
      }
    } finally { await fileSystem.remove(temporary).catch(() => undefined); }
  });
  const tail = operation.then(() => undefined, () => undefined);
  queues.set(file, tail); void tail.finally(() => { if (queues.get(file) === tail) queues.delete(file); });
  return operation;
}
