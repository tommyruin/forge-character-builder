import { engineError, type EngineError, type EngineErrorCode } from "./errors.js";
import {
  ENGINE_METHOD_NAMES,
  queueKindFor,
  type EngineClient,
  type EngineMethodHandlers,
  type EngineMethodName,
  type MethodArgs,
  type MethodResult,
} from "./methods.js";
import type {
  EngineProgressMessage,
  EngineQueueMessage,
  EngineRequest,
  EngineResponse,
  EngineWorkerMessage,
  QueueKind,
} from "./protocol.js";

const methodNames = new Set<string>(ENGINE_METHOD_NAMES);
const errorCodes = new Set<EngineErrorCode>([
  "not-found",
  "invalid-argument",
  "conflict",
  "content-invalid",
  "snapshot-rejected",
  "unsupported",
  "internal",
]);

interface QueuedRequest {
  request: EngineRequest;
  queueKind: QueueKind;
  resolve: (response: EngineResponse) => void;
}

export interface DispatcherOptions {
  onQueue?: (message: EngineQueueMessage) => void;
}

export interface EngineDispatcher {
  dispatch(request: unknown): Promise<EngineResponse>;
}

function isEngineError(value: unknown): value is EngineError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<EngineError>;
  return typeof candidate.code === "string" && errorCodes.has(candidate.code as EngineErrorCode) && typeof candidate.message === "string";
}

function invalidRequestId(value: unknown): number {
  if (typeof value !== "object" || value === null) return -1;
  const id = (value as { id?: unknown }).id;
  return typeof id === "number" && Number.isSafeInteger(id) ? id : -1;
}

function validateRequest(value: unknown): EngineRequest | EngineError {
  if (typeof value !== "object" || value === null) {
    return engineError("invalid-argument", "worker request must be an object");
  }
  const request = value as { id?: unknown; method?: unknown; args?: unknown };
  if (typeof request.id !== "number" || !Number.isSafeInteger(request.id) || request.id < 0) {
    return engineError("invalid-argument", "worker request id must be a non-negative safe integer");
  }
  if (typeof request.method !== "string" || !methodNames.has(request.method)) {
    return engineError("invalid-argument", `unknown engine method '${String(request.method)}'`);
  }
  if (!Array.isArray(request.args)) {
    return engineError("invalid-argument", "worker request args must be an array");
  }
  return request as EngineRequest;
}

function priority(kind: QueueKind): number {
  if (kind === "content-write" || kind === "character-write" || kind === "unknown-write") return 0;
  if (kind === "homebrew") return 1;
  return 2;
}

export function createEngineDispatcher(
  handlers: EngineMethodHandlers,
  options: DispatcherOptions = {},
): EngineDispatcher {
  const queue: QueuedRequest[] = [];
  let active = false;

  const run = async (): Promise<void> => {
    if (active) return;
    const item = queue.shift();
    if (item === undefined) return;
    active = true;
    options.onQueue?.({ type: "queue", id: item.request.id, queueKind: item.queueKind, phase: "updating" });

    const { id, method, args } = item.request;
    let response: EngineResponse;
    const handler = handlers[method] as ((...methodArgs: MethodArgs<typeof method>) => MethodResult<typeof method> | Promise<MethodResult<typeof method>>) | undefined;
    if (handler === undefined) {
      response = {
        id,
        ok: false,
        error: engineError("unsupported", `engine method '${method}' is not available`, { method }),
      };
    } else {
      try {
        response = { id, ok: true, result: await handler(...args) };
      } catch (cause) {
        response = {
          id,
          ok: false,
          error: isEngineError(cause)
            ? cause
            : engineError("internal", `engine method '${method}' failed`),
        };
      }
    }

    options.onQueue?.({ type: "queue", id, queueKind: item.queueKind, phase: "complete" });
    item.resolve(response);
    active = false;
    void run();
  };

  return {
    dispatch(value: unknown): Promise<EngineResponse> {
      const request = validateRequest(value);
      if (isEngineError(request)) {
        return Promise.resolve({ id: invalidRequestId(value), ok: false, error: request });
      }
      const queueKind = queueKindFor(request.method);
      return new Promise((resolve) => {
        const item = { request, queueKind, resolve };
        const insertion = queue.findIndex((queued) => priority(queued.queueKind) > priority(queueKind));
        if (insertion === -1) queue.push(item);
        else queue.splice(insertion, 0, item);
        options.onQueue?.({ type: "queue", id: request.id, queueKind, phase: "waiting" });
        void run();
      });
    },
  };
}

export type WorkerTransfer = ArrayBuffer;

export interface WorkerScope {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: EngineWorkerMessage, transfer?: readonly WorkerTransfer[]): void;
}

export interface EngineWorkerRuntime {
  progress(message: Omit<EngineProgressMessage, "type">): void;
}

function responseTransfer(response: EngineResponse): readonly WorkerTransfer[] {
  return response.ok && response.result instanceof ArrayBuffer ? [response.result] : [];
}

export function startEngineWorker(
  scope: WorkerScope,
  handlers: EngineMethodHandlers,
  options: { readyMetrics?: Record<string, unknown> } = {},
): EngineWorkerRuntime {
  let lastProgress: EngineProgressMessage | undefined;
  const dispatcher = createEngineDispatcher(handlers, {
    onQueue: (message) => scope.postMessage(message),
  });
  scope.addEventListener("message", (event) => {
    void dispatcher.dispatch(event.data).then((response) => {
      scope.postMessage(response, responseTransfer(response));
    });
  });
  scope.postMessage({ type: "ready", metrics: { methodCount: ENGINE_METHOD_NAMES.length, ...options.readyMetrics } });
  return {
    progress(message): void {
      const percentage =
        message.percentage === null || !Number.isFinite(message.percentage)
          ? null
          : Math.max(0, Math.min(100, message.percentage));
      const next: EngineProgressMessage = { type: "progress", ...message, percentage };
      if (
        lastProgress?.scope === next.scope &&
        lastProgress.percentage === next.percentage &&
        lastProgress.message === next.message &&
        lastProgress.active === next.active &&
        lastProgress.success === next.success
      ) {
        return;
      }
      lastProgress = next;
      scope.postMessage(next);
    },
  };
}

export async function initializeEngineWorker(
  scope: WorkerScope,
  initialize: () => EngineMethodHandlers | Promise<EngineMethodHandlers>,
): Promise<EngineWorkerRuntime | null> {
  try {
    return startEngineWorker(scope, await initialize());
  } catch (cause) {
    scope.postMessage({
      type: "fatal",
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return null;
  }
}

export interface ClientWorkerPort {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown, transfer?: readonly WorkerTransfer[]): void;
}

export interface EngineClientOptions {
  onEvent?: (message: EngineWorkerMessage) => void;
}

interface PendingClientRequest {
  resolve: (value: unknown) => void;
  reject: (reason: EngineError) => void;
}

function isResponse(value: unknown): value is EngineResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { id?: unknown; ok?: unknown };
  return typeof candidate.id === "number" && typeof candidate.ok === "boolean";
}

function collectTransfers(value: unknown, transfers: Set<ArrayBuffer>, visited: Set<object>): void {
  if (value instanceof ArrayBuffer) {
    transfers.add(value);
    return;
  }
  if (typeof value !== "object" || value === null || visited.has(value)) return;
  visited.add(value);
  if (ArrayBuffer.isView(value)) {
    if (value.buffer instanceof ArrayBuffer) transfers.add(value.buffer);
    return;
  }
  for (const nested of Array.isArray(value) ? value : Object.values(value)) {
    collectTransfers(nested, transfers, visited);
  }
}

export function createEngineClient(port: ClientWorkerPort, options: EngineClientOptions = {}): EngineClient {
  const pending = new Map<number, PendingClientRequest>();
  let nextId = 1;
  port.addEventListener("message", ({ data }) => {
    if (!isResponse(data)) {
      if (typeof data === "object" && data !== null && "type" in data) {
        options.onEvent?.(data as EngineWorkerMessage);
      }
      return;
    }
    const request = pending.get(data.id);
    if (request === undefined) return;
    pending.delete(data.id);
    if (data.ok) request.resolve(data.result);
    else request.reject(data.error);
  });

  const invoke = <M extends EngineMethodName>(method: M, args: MethodArgs<M>): Promise<MethodResult<M>> => {
    const id = nextId++;
    const transferSet = new Set<ArrayBuffer>();
    collectTransfers(args, transferSet, new Set());
    return new Promise<MethodResult<M>>((resolve, reject) => {
      pending.set(id, {
        resolve: (value) => resolve(value as MethodResult<M>),
        reject,
      });
      port.postMessage(
        { id, method, args, queueKind: queueKindFor(method), sentAt: Date.now() } satisfies EngineRequest<M>,
        [...transferSet],
      );
    });
  };

  return new Proxy({} as EngineClient, {
    get(_target, property): unknown {
      if (typeof property !== "string" || !methodNames.has(property)) return undefined;
      return (...args: MethodArgs<EngineMethodName>) => invoke(property as EngineMethodName, args);
    },
  });
}
