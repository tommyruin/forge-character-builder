/**
 * Minimal typed error surface for the engine package.
 *
 * Mirrors the shape and codes of `@forge-cb/api` (packages/api/src/errors.ts) because
 * the engine package does not depend on @forge-cb/api. Consolidated into the api
 * package once the engine gains that dependency.
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
