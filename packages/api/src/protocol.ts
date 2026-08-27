/**
 * Worker wire protocol between the React client transport and the engine worker.
 *
 * The protocol is defined here and nowhere else (see docs/contract.md). It uses
 * standard worker mechanics — request/response correlation, progress/queue/fatal
 * events, transferable buffers — with the method surface, argument shapes, and
 * result types all specified in this package.
 *
 * Message flow:
 *   main -> worker : { id, method, args }            invoke EngineMethod[method](...args)
 *   worker -> main : { id, ok: true,  result }       method returned (JSON value or ArrayBuffer)
 *                    { id, ok: false, error }         method threw (EngineError)
 *                    { type: "ready", metrics }       engine initialized (once)
 *                    { type: "progress", ... }        content/character progress
 *                    { type: "queue", ... }           serialized queue phase
 *                    { type: "fatal", error }         engine failed to load
 */

import type { EngineError } from "./errors.js";
import type { EngineMethodName, MethodArgs, MethodResult } from "./methods.js";

/** Monotonic request id, correlated by the bridge. */
export interface EngineRequest<M extends EngineMethodName = EngineMethodName> {
  id: number;
  method: M;
  args: MethodArgs<M>;
  /** Queue discipline hint (see queueKindFor). */
  queueKind?: QueueKind;
  sentAt?: number;
}

export interface EngineResponseOk<M extends EngineMethodName = EngineMethodName> {
  id: number;
  ok: true;
  /** JSON value, or an ArrayBuffer/Uint8Array for binary results (sheet bytes). */
  result: MethodResult<M>;
  metrics?: Record<string, unknown>;
}

export interface EngineResponseError {
  id: number;
  ok: false;
  error: EngineError;
  metrics?: Record<string, unknown>;
}

export type EngineResponse<M extends EngineMethodName = EngineMethodName> = EngineResponseOk<M> | EngineResponseError;

export interface EngineReadyMessage {
  type: "ready";
  metrics: Record<string, unknown>;
}

export interface EngineFatalMessage {
  type: "fatal";
  error: string;
}

export interface EngineProgressMessage {
  type: "progress";
  scope: "content" | "character";
  percentage: number | null;
  message: string;
  active: boolean;
  success: boolean;
}

export interface EngineQueueMessage {
  type: "queue";
  id: number;
  queueKind: QueueKind;
  phase: "waiting" | "updating" | "complete";
}

export type EngineWorkerMessage =
  | EngineResponse
  | EngineReadyMessage
  | EngineFatalMessage
  | EngineProgressMessage
  | EngineQueueMessage;

export type QueueKind =
  | "content-write"
  | "character-write"
  | "homebrew"
  | "read-only"
  | "unknown-write";
