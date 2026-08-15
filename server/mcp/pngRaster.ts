import { deflateSync } from "node:zlib";
import type { SceneCommand } from "./humanViewScene.js";

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (data: Buffer): number => { let c = 0xffffffff; for (const byte of data) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (name: string, data: Buffer): Buffer => { const type = Buffer.from(name); const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); type.copy(result, 4); data.copy(result, 8); result.writeUInt32BE(crc32(Buffer.concat([type, data])), data.length + 8); return result; };

export function rasterizePng(width: number, height: number, commands: readonly SceneCommand[]): Buffer {
  const pixels = new Uint8Array(width * height * 4); for (let i = 0; i < pixels.length; i += 4) { pixels[i] = 5; pixels[i + 1] = 12; pixels[i + 2] = 14; pixels[i + 3] = 255; }
  const blend = (x: number, y: number, color: readonly [number, number, number], alpha: number) => {
    x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= width || y >= height) return; const p = (y * width + x) * 4, a = Math.max(0, Math.min(1, alpha));
    pixels[p] = Math.round(pixels[p] * (1 - a) + color[0] * a); pixels[p + 1] = Math.round(pixels[p + 1] * (1 - a) + color[1] * a); pixels[p + 2] = Math.round(pixels[p + 2] * (1 - a) + color[2] * a);
  };
  for (const command of commands) if (command.kind === "circle") {
    const r = Math.max(1, command.radius), minX = Math.floor(command.x - r), maxX = Math.ceil(command.x + r), minY = Math.floor(command.y - r), maxY = Math.ceil(command.y + r);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) if ((x - command.x) ** 2 + (y - command.y) ** 2 <= r * r) blend(x, y, command.color, command.alpha);
  } else {
    const steps = Math.max(1, Math.ceil(Math.hypot(command.x2 - command.x1, command.y2 - command.y1) * 1.5));
    for (let i = 0; i <= steps; i++) { const t = i / steps, x = command.x1 + (command.x2 - command.x1) * t, y = command.y1 + (command.y2 - command.y1) * t, r = Math.max(0, command.width / 2);
      for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) blend(x + ox, y + oy, command.color, command.alpha); }
  }
  const raw = Buffer.alloc((width * 4 + 1) * height); for (let y = 0; y < height; y++) { const row = y * (width * 4 + 1); raw[row] = 0; Buffer.from(pixels.buffer, y * width * 4, width * 4).copy(raw, row + 1); }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
