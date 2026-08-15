import { SeededRandom } from "./seededRandom";
import { deriveIntrinsicOscillation, type IntrinsicOscillation } from "./oscillation";

export interface FingerprintTraits extends IntrinsicOscillation {
  readonly fingerprint: string;
  readonly alpha: number;
  readonly beta: number;
  readonly gamma: number;
}

const normalizedSegment = (segment: string): number => parseInt(segment, 16) / 0xffff;

export function decodeFingerprint(fingerprint: string): FingerprintTraits {
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error("Fingerprint must be 64 lowercase hexadecimal characters");
  return Object.freeze({
    fingerprint,
    alpha: normalizedSegment(fingerprint.slice(0, 4)),
    beta: normalizedSegment(fingerprint.slice(4, 8)),
    gamma: normalizedSegment(fingerprint.slice(8, 12)),
    ...deriveIntrinsicOscillation(fingerprint),
  });
}

export function createFingerprint(random: SeededRandom): FingerprintTraits {
  return decodeFingerprint(random.hex(64));
}
