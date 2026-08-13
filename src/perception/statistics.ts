export const finiteValues = (values: Array<number | null | undefined>): number[] => values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
export const mean = (values: number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
export const median = (values: number[]): number | null => {
  if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
export const robustScore = (value: number | null | undefined, population: number[]): { score: number; median: number | null; mad: number | null } => {
  if (typeof value !== "number" || !Number.isFinite(value)) return { score: 0, median: median(population), mad: null };
  const center = median(population); if (center === null) return { score: 0, median: null, mad: null };
  const mad = median(population.map((item) => Math.abs(item - center)));
  if (!mad) {
    const range = Math.max(...population) - Math.min(...population);
    return { score: range ? Math.abs(value - center) / range : 0, median: center, mad };
  }
  return { score: Math.abs(value - center) / (1.4826 * mad), median: center, mad };
};
export const normalized = (value: number | null | undefined, values: number[]): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || !values.length) return 0;
  const min = Math.min(...values), max = Math.max(...values); return max === min ? 0 : (value - min) / (max - min);
};
export const round = (value: number): number => Number(value.toFixed(6));
