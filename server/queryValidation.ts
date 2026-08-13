import { DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT } from "../src/query/queryTypes.js";

export class QueryValidationError extends Error {
  constructor(readonly parameter: string, readonly value: string | null, message: string) {
    super(message);
  }
}

export const optionalNumber = (url: URL, name: string, options: { integer?: boolean; min?: number; max?: number } = {}): number | undefined => {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  if (raw.trim() === "") throw new QueryValidationError(name, raw, "must be a number");
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new QueryValidationError(name, raw, "must be a finite number");
  if (options.integer && !Number.isInteger(value)) throw new QueryValidationError(name, raw, "must be an integer");
  if (options.min !== undefined && value < options.min) throw new QueryValidationError(name, raw, `must be at least ${options.min}`);
  if (options.max !== undefined && value > options.max) throw new QueryValidationError(name, raw, `must be at most ${options.max}`);
  return value;
};

export const requiredNumber = (url: URL, name: string, options: { integer?: boolean; min?: number; max?: number } = {}): number => {
  const value = optionalNumber(url, name, options);
  if (value === undefined) throw new QueryValidationError(name, null, "is required");
  return value;
};

export const optionalBoolean = (url: URL, name: string): boolean | undefined => {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new QueryValidationError(name, raw, "must be true or false");
};

export const optionalString = (url: URL, name: string): string | undefined => {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  const value = raw.trim();
  if (!value) throw new QueryValidationError(name, raw, "must not be empty");
  return value;
};

export const enumValue = <T extends string>(url: URL, name: string, values: readonly T[], fallback: T): T => {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  if ((values as readonly string[]).includes(raw)) return raw as T;
  throw new QueryValidationError(name, raw, `must be one of: ${values.join(", ")}`);
};

export const queryLimit = (url: URL, fallback = DEFAULT_QUERY_LIMIT): number =>
  optionalNumber(url, "limit", { integer: true, min: 1, max: MAX_QUERY_LIMIT }) ?? fallback;
