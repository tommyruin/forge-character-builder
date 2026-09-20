import { describe, expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { startSheetRenderWorker, type SheetRenderWorkerScope } from "./sheet-render-worker.js";
import { DEFAULT_SHEET_FONTS, SHEET_TEMPLATE_CONTRACT } from "../sheet/template-contract.js";
import { sheetFaceFiles } from "../sheet/templates.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const SHEET_PUBLIC = join(ROOT, "apps", "client", "public");
const SHEET_BASE = "https://example.test/tools/character-builder/";
const SHEET_TEMPLATE_NAMES = [
  ...Object.values(SHEET_TEMPLATE_CONTRACT.files),
  ...SHEET_TEMPLATE_CONTRACT.spellcastingSectionTops,
].map((name) => `sheets/2014/${name}`);
const FONT_FILES = sheetFaceFiles(DEFAULT_SHEET_FONTS).size;

function sheetTemplateResponse(url: string): Response {
  const name = url.slice(SHEET_BASE.length);
  return new Response(readFileSync(join(SHEET_PUBLIC, name)), {
    status: 200,
    headers: { "content-type": "application/pdf" },
  });
}

function modelFor(characterId: string) {
  return {
    characterId,
    mode: "lite" as const,
    pageCount: 1,
    pages: [
      {
        page: 1,
        templateKind: "details" as const,
        sections: [{ title: "features", rows: [] }],
      },
    ],
    formValues: { details_character_name: characterId, details_build: "Level 1", details_str_score: "18", details_str_modifier: "+4" },
  };
}

function fakeScope() {
  const listeners = new Set<(event: { data: unknown }) => void>();
  const messages: Array<{ message: unknown; transfer?: readonly unknown[] }> = [];
  const scope = {
    addEventListener: (_type: "message", listener: (event: { data: unknown }) => void) => {
      listeners.add(listener);
    },
    postMessage: (message: unknown, transfer?: readonly ArrayBuffer[]) => {
      messages.push({ message, transfer });
    },
  } as unknown as SheetRenderWorkerScope;
  return {
    scope,
    listeners,
    messages,
    async request(payload: unknown) {
      for (const listener of listeners) listener({ data: payload });
      const wanted = (payload as { id: number }).id;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const found = messages.find(({ message }) =>
          (message as { id?: unknown } | null) !== null &&
          typeof message === "object" &&
          (message as { id?: unknown }).id === wanted,
        );
        if (found) return found.message;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error("render worker did not respond");
    },
  };
}

describe("sheet render worker", () => {
  it("renders a model to deterministic PDF bytes through the template bundle", async () => {
    const { scope, request } = fakeScope();
    const previousFetch = globalThis.fetch;
    const previousLocation = (globalThis as { location?: unknown }).location;
    vi.stubGlobal("location", {
      origin: "https://example.test",
      pathname: "/tools/character-builder/",
    });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      return url.startsWith(SHEET_BASE)
        ? sheetTemplateResponse(url)
        : new Response("not found", { status: 404 });
    }));
    try {
      startSheetRenderWorker(scope);
      const first = await request({ id: 1, model: modelFor("Ada"), templateBase: SHEET_BASE });
      const second = await request({ id: 2, model: modelFor("Ada"), templateBase: SHEET_BASE });
      expect(first).toMatchObject({ id: 1, ok: true });
      expect(second).toMatchObject({ id: 2, ok: true });
      const firstBytes = (first as { bytes: ArrayBuffer }).bytes;
      const secondBytes = (second as { bytes: ArrayBuffer }).bytes;
      expect(new TextDecoder().decode(new Uint8Array(firstBytes))).toMatch(/^%PDF-1\./);
      expect(secondBytes).toEqual(firstBytes);
      expect(firstBytes.byteLength).toBeGreaterThan(10_000);
      const emphasized = await request({ id: 3, model: modelFor("Ada"), templateBase: SHEET_BASE, emphasizeAbilityModifiers: true }) as { bytes: ArrayBuffer };
      const doc = await getDocument({ data: new Uint8Array(emphasized.bytes) }).promise;
      const content = await (await doc.getPage(1)).getTextContent();
      const items = content.items.filter((item) => "str" in item);
      expect(items.find((item) => item.str === "+4")!.height).toBeGreaterThan(items.find((item) => item.str === "18")!.height);
    } finally {
      vi.stubGlobal("fetch", previousFetch);
      vi.stubGlobal("location", previousLocation);
    }
  }, 120_000);

  it("retries the template bundle after a rejected fetch and caches the successful one", async () => {
    const { scope, request } = fakeScope();
    const previousFetch = globalThis.fetch;
    const previousLocation = (globalThis as { location?: unknown }).location;
    const requests: string[] = [];
    let healthy = false;
    vi.stubGlobal("location", {
      origin: "https://example.test",
      pathname: "/tools/character-builder/",
    });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      requests.push(url);
      return healthy
        ? sheetTemplateResponse(url)
        : new Response("not found", { status: 404 });
    }));
    try {
      startSheetRenderWorker(scope);
      const failed = await request({ id: 1, model: modelFor("Ada"), templateBase: SHEET_BASE });
      expect(failed).toMatchObject({ id: 1, ok: false });
      expect((failed as { error: string }).error).toContain("character sheet template");
      // Every template and the label sheet are fetched per bundle; font files
      // are shared across bundles and fetched once per worker module.
      const perBundle = SHEET_TEMPLATE_NAMES.length + 1;
      const assets = () => requests.filter((url) => !url.includes(`/${SHEET_TEMPLATE_CONTRACT.fontsDirectory}/`));
      expect(assets()).toHaveLength(perBundle);

      healthy = true;
      const ok = await request({ id: 2, model: modelFor("Ada"), templateBase: SHEET_BASE });
      expect(ok).toMatchObject({ id: 2, ok: true });
      expect(assets()).toHaveLength(perBundle * 2);

      const cached = await request({ id: 3, model: modelFor("Ada"), templateBase: SHEET_BASE });
      expect(cached).toMatchObject({ id: 3, ok: true });
      expect(assets()).toHaveLength(perBundle * 2);
      expect(new Set(requests.filter((url) => url.includes(`/${SHEET_TEMPLATE_CONTRACT.fontsDirectory}/`))).size).toBeLessThanOrEqual(FONT_FILES);
    } finally {
      vi.stubGlobal("fetch", previousFetch);
      vi.stubGlobal("location", previousLocation);
    }
  }, 120_000);

  it("falls back to the plain writer when no browser location is available", async () => {
    const { scope, request } = fakeScope();
    const previousFetch = globalThis.fetch;
    const previousLocation = (globalThis as { location?: unknown }).location;
    const fetchMock = vi.fn();
    vi.stubGlobal("location", undefined);
    vi.stubGlobal("fetch", fetchMock);
    try {
      startSheetRenderWorker(scope);
      const response = await request({ id: 1, model: modelFor("Ada"), templateBase: SHEET_BASE });
      expect(response).toMatchObject({ id: 1, ok: true });
      const bytes = (response as { bytes: ArrayBuffer }).bytes;
      expect(new TextDecoder().decode(new Uint8Array(bytes))).toMatch(/^%PDF-1\./);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal("fetch", previousFetch);
      vi.stubGlobal("location", previousLocation);
    }
  }, 120_000);
});
