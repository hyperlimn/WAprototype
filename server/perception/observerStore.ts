import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ObserverBookmark { observer: string; lastOrientationTickBySeed: Record<string, number>; lastInspectedObjects: string[] }

const observerName = (value: string): string => {
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(value)) throw new Error("observer must contain 1-80 letters, numbers, dots, underscores, or hyphens");
  return value;
};

export class ObserverStore {
  constructor(readonly root: string) {}
  async get(observer: string): Promise<ObserverBookmark> {
    const name = observerName(observer);
    try {
      const value = JSON.parse(await readFile(path.join(this.root, `${name}.json`), "utf8")) as ObserverBookmark;
      return value.observer === name && value.lastOrientationTickBySeed && typeof value.lastOrientationTickBySeed === "object"
        ? value : { observer: name, lastOrientationTickBySeed: {}, lastInspectedObjects: [] };
    } catch { return { observer: name, lastOrientationTickBySeed: {}, lastInspectedObjects: [] }; }
  }
  async markObserved(observer: string, seed: string, tick: number): Promise<ObserverBookmark> {
    const value = await this.get(observer); value.lastOrientationTickBySeed[seed] = tick;
    await mkdir(this.root, { recursive: true });
    const file = path.join(this.root, `${value.observer}.json`), temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2), "utf8"); await rename(temporary, file); return value;
  }
}
