import { describe, expect, it } from "vitest";
import {
  ENGINE_METHOD_NAMES,
  METHOD_SUPPORT,
  createEngineClient,
  createEngineDispatcher,
  initializeEngineWorker,
  queueKindFor,
  startEngineWorker,
  type EngineRequest,
  type EngineWorkerMessage,
  type WorkerScope,
} from "./index.js";

describe("engine method contract", () => {
  it("classifies every declared method exactly once", () => {
    // 75: added setItemStorage (item-storage assignment).
    // 77: added setCompanionPortrait / removeCompanionPortrait.
    expect(ENGINE_METHOD_NAMES).toHaveLength(77);
    expect(new Set(ENGINE_METHOD_NAMES).size).toBe(ENGINE_METHOD_NAMES.length);
    expect(Object.keys(METHOD_SUPPORT).sort()).toEqual([...ENGINE_METHOD_NAMES].sort());

    for (const method of ENGINE_METHOD_NAMES) {
      expect(["implemented", "test-only"]).toContain(METHOD_SUPPORT[method].status);
      expect(queueKindFor(method)).not.toBe("unknown-write");
    }
  });

  it("classifies all seven snapshot methods as implemented", () => {
    const snapshotMethods = [
      "bootFromSnapshot",
      "prepareFastStartSnapshot",
      "getFastStartSnapshotBuffer",
      "importCharacterXmlWithSnapshot",
      "getCharacterLoadDiagnostics",
      "prepareCharacterLoadSnapshot",
      "getCharacterLoadSnapshotBuffer",
    ];
    for (const method of snapshotMethods) {
      expect(METHOD_SUPPORT[method as (typeof ENGINE_METHOD_NAMES)[number]]).toEqual({ status: "implemented" });
    }
  });
});

describe("engine dispatcher", () => {
  it("dispatches implemented handlers and returns stable unsupported errors", async () => {
    const dispatcher = createEngineDispatcher({
      createCharacter: async (name) => ({ id: name, name }),
    });

    await expect(
      dispatcher.dispatch({ id: 1, method: "createCharacter", args: ["Ada"] }),
    ).resolves.toEqual({ id: 1, ok: true, result: { id: "Ada", name: "Ada" } });
    await expect(
      dispatcher.dispatch({ id: 2, method: "equipmentCategories", args: [] }),
    ).resolves.toMatchObject({
      id: 2,
      ok: false,
      error: { code: "unsupported", details: { method: "equipmentCategories" } },
    });
  });

  it("validates requests and converts unexpected exceptions", async () => {
    const dispatcher = createEngineDispatcher({
      getCharacter: () => {
        throw new Error("database details must not cross the worker boundary");
      },
    });

    await expect(dispatcher.dispatch({ id: 3, method: "missing", args: [] })).resolves.toMatchObject({
      id: 3,
      ok: false,
      error: { code: "invalid-argument" },
    });
    await expect(
      dispatcher.dispatch({ id: 4, method: "getCharacter", args: ["Ada"] }),
    ).resolves.toEqual({
      id: 4,
      ok: false,
      error: { code: "internal", message: "engine method 'getCharacter' failed" },
    });
  });
});

class FakeWorkerScope implements WorkerScope {
  readonly messages: Array<{ message: EngineWorkerMessage; transfer: readonly ArrayBuffer[] }> = [];
  private listener: ((event: { data: unknown }) => void) | undefined;

  addEventListener(_type: "message", listener: (event: { data: unknown }) => void): void {
    this.listener = listener;
  }

  postMessage(message: EngineWorkerMessage, transfer: readonly ArrayBuffer[] = []): void {
    this.messages.push({ message, transfer });
  }

  send(data: unknown): void {
    this.listener?.({ data });
  }
}

describe("worker runtime", () => {
  it("reports initialization failures as fatal worker events", async () => {
    const scope = new FakeWorkerScope();
    const runtime = await initializeEngineWorker(scope, async () => {
      throw new Error("content failed to load");
    });

    expect(runtime).toBeNull();
    expect(scope.messages).toEqual([
      { message: { type: "fatal", error: "content failed to load" }, transfer: [] },
    ]);
  });

  it("serializes work, lets homebrew overtake queued reads, and transfers buffers", async () => {
    const scope = new FakeWorkerScope();
    const releases: Array<() => void> = [];
    const order: string[] = [];
    const block = (label: string) =>
      new Promise<Readonly<Record<string, unknown>>>((resolve) => {
        order.push(label);
        releases.push(() => resolve({ label }));
      });
    const buffer = new ArrayBuffer(4);

    startEngineWorker(scope, {
      getCharacter: (id) => block(`read:${id}`),
      patchHomebrew: ({ path }) => block(`homebrew:${path}`),
      getFastStartSnapshotBuffer: () => buffer,
    });

    scope.send({ id: 1, method: "getCharacter", args: ["one"] } satisfies EngineRequest<"getCharacter">);
    scope.send({ id: 2, method: "getCharacter", args: ["two"] } satisfies EngineRequest<"getCharacter">);
    scope.send({ id: 3, method: "patchHomebrew", args: [{ path: "rules.xml", base64: null }] } satisfies EngineRequest<"patchHomebrew">);
    await Promise.resolve();
    expect(order).toEqual(["read:one"]);

    releases.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["read:one", "homebrew:rules.xml"]);
    releases.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["read:one", "homebrew:rules.xml", "read:two"]);
    releases.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    scope.send({ id: 4, method: "getFastStartSnapshotBuffer", args: [] } satisfies EngineRequest<"getFastStartSnapshotBuffer">);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const binaryResponse = scope.messages.find(
      ({ message }) => "ok" in message && message.id === 4 && message.ok,
    );
    expect(binaryResponse?.transfer).toEqual([buffer]);

    const phases = scope.messages
      .map(({ message }) => message)
      .flatMap((message) =>
        "type" in message && message.type === "queue" && message.id === 1 ? [message.phase] : [],
      );
    expect(phases).toEqual(["waiting", "updating", "complete"]);
  });

  it("bounds progress percentages and coalesces duplicate events", () => {
    const scope = new FakeWorkerScope();
    const runtime = startEngineWorker(scope, {});
    const update = {
      scope: "content" as const,
      percentage: 125,
      message: "Loading",
      active: true,
      success: false,
    };

    runtime.progress(update);
    runtime.progress(update);

    expect(scope.messages.map(({ message }) => message)).toContainEqual({
      type: "progress",
      ...update,
      percentage: 100,
    });
    expect(scope.messages.filter(({ message }) => "type" in message && message.type === "progress")).toHaveLength(1);
  });
});

describe("typed client bridge", () => {
  it("correlates responses, forwards events, and transfers input buffers", async () => {
    let workerListener: ((event: { data: unknown }) => void) | undefined;
    let clientListener: ((event: { data: unknown }) => void) | undefined;
    const requests: Array<{ message: unknown; transfer: readonly ArrayBuffer[] }> = [];
    const events: EngineWorkerMessage[] = [];
    const workerScope: WorkerScope = {
      addEventListener: (_type, listener) => {
        workerListener = listener;
      },
      postMessage: (message) => clientListener?.({ data: message }),
    };
    const clientPort = {
      addEventListener: (_type: "message", listener: (event: { data: unknown }) => void) => {
        clientListener = listener;
      },
      postMessage: (message: unknown, transfer: readonly ArrayBuffer[] = []) => {
        requests.push({ message, transfer });
        workerListener?.({ data: message });
      },
    };
    const client = createEngineClient(clientPort, { onEvent: (message) => events.push(message) });
    startEngineWorker(workerScope, {
      createCharacter: (name) => ({ id: name, name }),
    });

    await expect(client.createCharacter("Ada")).resolves.toEqual({ id: "Ada", name: "Ada" });
    await expect(client.equipmentCategories()).rejects.toMatchObject({ code: "unsupported" });
    const body = new ArrayBuffer(8);
    await expect(
      client.importCharacterXmlWithSnapshot("Ada", "", { client: "dm-forge-character-load", schema: 1, codec: "gzip-json" }, body),
    ).rejects.toMatchObject({ code: "unsupported" });

    expect(requests.map(({ message }) => message)).toMatchObject([
      { id: 1, method: "createCharacter", queueKind: "character-write" },
      { id: 2, method: "equipmentCategories", queueKind: "read-only" },
      { id: 3, method: "importCharacterXmlWithSnapshot", queueKind: "character-write" },
    ]);
    expect(requests[2]?.transfer).toEqual([body]);
    // 75: added setItemStorage (item-storage assignment).
    // 77: added setCompanionPortrait / removeCompanionPortrait.
    expect(events).toContainEqual({ type: "ready", metrics: { methodCount: 77 } });
  });

  it("transfers snapshot buffers: nested request bodies and ArrayBuffer results", async () => {
    let workerListener: ((event: { data: unknown }) => void) | undefined;
    let clientListener: ((event: { data: unknown }) => void) | undefined;
    const requests: Array<{ message: unknown; transfer: readonly ArrayBuffer[] }> = [];
    const workerMessages: Array<{ message: unknown; transfer: readonly ArrayBuffer[] }> = [];
    const workerScope: WorkerScope = {
      addEventListener: (_type, listener) => {
        workerListener = listener;
      },
      postMessage: (message, transfer = []) => {
        workerMessages.push({ message, transfer });
        clientListener?.({ data: message });
      },
    };
    const clientPort = {
      addEventListener: (_type: "message", listener: (event: { data: unknown }) => void) => {
        clientListener = listener;
      },
      postMessage: (message: unknown, transfer: readonly ArrayBuffer[] = []) => {
        requests.push({ message, transfer });
        workerListener?.({ data: message });
      },
    };
    const client = createEngineClient(clientPort, { onEvent: () => undefined });
    const fastStartBody = new ArrayBuffer(16);
    const snapshotBody = new ArrayBuffer(8);
    startEngineWorker(workerScope, {
      getFastStartSnapshotBuffer: () => new ArrayBuffer(32),
      bootFromSnapshot: () => ({
        elementCount: 0,
        sourceCount: 0,
        fileCount: 0,
        typeCounts: {},
        hydrationMs: 0,
        validationMs: 0,
        totalMs: 0,
      }),
    });

    const result = await client.getFastStartSnapshotBuffer();
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBe(32);
    await expect(
      client.bootFromSnapshot({
        manifest: { client: "dm-forge-fast-start", schema: 2, codec: "gzip-json" },
        expectedIdentity: { client: "dm-forge-fast-start", schema: 2, codec: "gzip-json" },
        body: fastStartBody,
      }),
    ).resolves.toMatchObject({ elementCount: 0 });

    expect(requests.map(({ message }) => message)).toMatchObject([
      { id: 1, method: "getFastStartSnapshotBuffer", queueKind: "read-only" },
      { id: 2, method: "bootFromSnapshot", queueKind: "content-write" },
    ]);
    expect(requests[1]?.transfer).toEqual([fastStartBody]);
    const fastStartResponse = workerMessages.find(
      ({ message }) =>
        (message as { id?: number; ok?: boolean }).id === 1 && (message as { ok?: boolean }).ok === true,
    );
    expect(fastStartResponse?.transfer).toHaveLength(1);
    expect(fastStartResponse?.transfer[0]?.byteLength).toBe(32);
    void snapshotBody;
  });
});
