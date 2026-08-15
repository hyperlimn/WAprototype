export const MIN_NATURAL_FREQUENCY = 0.25;
export const MAX_NATURAL_FREQUENCY = 2;
export const OSCILLATION_TICKS_PER_CYCLE = 1_000;
const TWO_PI = Math.PI * 2;

const segmentUnit = (fingerprint: string, start: number): number =>
  Number.parseInt(fingerprint.slice(start, start + 8), 16) / 0xffff_ffff;

export interface IntrinsicOscillation {
  naturalFrequency: number;
  phase: number;
}

/** Maps independent 32-bit fingerprint segments to intrinsic oscillator properties. */
export function deriveIntrinsicOscillation(fingerprint: string): IntrinsicOscillation {
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error("Fingerprint must be 64 lowercase hexadecimal characters");
  return Object.freeze({
    naturalFrequency: MIN_NATURAL_FREQUENCY
      + segmentUnit(fingerprint, 12) * (MAX_NATURAL_FREQUENCY - MIN_NATURAL_FREQUENCY),
    phase: segmentUnit(fingerprint, 20) * TWO_PI,
  });
}

/** Authoritative observation at a simulation tick; never uses wall-clock time. */
export function oscillationAtTick(oscillator: IntrinsicOscillation, tick: number): number {
  return Math.sin(oscillator.phase + TWO_PI * oscillator.naturalFrequency * tick / OSCILLATION_TICKS_PER_CYCLE);
}
