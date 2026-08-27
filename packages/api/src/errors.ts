/**
 * Typed error surface for the engine worker.
 *
 * Every engine failure crosses the worker boundary as an EngineError with a stable
 * machine-readable code, a human message, and optional structured details. The
 * adapted client transport maps these to UI states (loading/loaded/empty/error +
 * Retry) exactly like the current transport maps HTTP-like status codes.
 */

export type EngineErrorCode =
  | "not-found"
  | "invalid-argument"
  | "conflict"
  | "content-invalid"
  | "snapshot-rejected"
  | "unsupported"
  | "internal";

export interface EngineError {
  code: EngineErrorCode;
  message: string;
  details?: unknown;
}

export function engineError(
  code: EngineErrorCode,
  message: string,
  details?: unknown,
): EngineError {
  return details === undefined ? { code, message } : { code, message, details };
}
