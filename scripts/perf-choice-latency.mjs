#!/usr/bin/env node
// perf-choice-latency.mjs — browser gate for per-choice latency with the full
// split-view sheet preview enabled.
//
// Serves the built client (apps/client/dist), boots it with Split View forced
// on, imports a spell-heavy fixture (Donyo.dnd5e — 75+ spells, so every full
// sheet render takes seconds), then measures how long a mutation stays busy
// while the previous mutation's full-sheet render is actively in flight.
//
// The render must run on a detached lane: a choice issued mid-render resolves
// immediately instead of queuing behind the multi-second PDF generation.
// The render starts ~250ms after the mutation (preview debounce) and runs for
// seconds on the fixture, so a mutation issued 400ms after the previous one
// lands mid-render.

import http from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ROOT = resolve(
  process.env.FCB_CLIENT_DIST ?? join(ROOT, "apps", "client", "dist"),
);
const BASE_PATH = process.env.PUBLIC_BASE_PATH || "/";
const REPORT_DIR = process.env.PERF_ARTIFACT_DIR ?? "/tmp/fcb-perf-choice";
// The character to drive: export one from the app (or the engine's
// exportCharacterXml) and point PERF_FIXTURE at it. A spell-heavy caster
// exercises the slowest choice-recompute path.
const FIXTURE_PATH = process.env.PERF_FIXTURE;
if (FIXTURE_PATH === undefined) {
  console.error("[perf] set PERF_FIXTURE to a .dnd5e character file to benchmark");
  process.exit(2);
}
const FIXTURE = resolve(FIXTURE_PATH);
const SPLIT_VIEW_KEY = "fcb-split-view";
const READY_TIMEOUT_MS = Number(process.env.PERF_BOOT_TIMEOUT_MS ?? 90_000);
const MUTATION_LATENCY_LIMIT_MS = Number(
  process.env.PERF_MUTATION_LIMIT_MS ?? 1500,
);
const RENDER_SETTLE_TIMEOUT_MS = Number(
  process.env.PERF_RENDER_TIMEOUT_MS ?? 60_000,
);
// Headless chromium renders the template-art pages with software pdf.js
// (~700ms/page — the same cost the app pays on the main thread in a real browser), so
// the full choice->canvas-swap gate is deliberately generous; the worker-side
// latency is what this project controls and the mutation-under-render gate
// pins it.
const SHEET_UPDATE_LIMIT_MS = Number(
  process.env.PERF_SHEET_UPDATE_LIMIT_MS ?? 15000,
);
const SHEET_UPDATE_TIMEOUT_MS = Number(
  process.env.PERF_SHEET_UPDATE_TIMEOUT_MS ?? 30_000,
);

let browserType;
try {
  ({ chromium: browserType } = await import("playwright"));
} catch (error) {
  console.error("[perf:choice] Playwright is not installed — run `npx playwright install chromium`");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

if (!existsSync(DIST_ROOT) || !statSync(DIST_ROOT).isDirectory()) {
  console.error(`[perf:choice] app artifact is missing: ${DIST_ROOT}`);
  console.error("  Run `npm run client:build`, then rerun this gate.");
  process.exit(1);
}
if (!existsSync(FIXTURE)) {
  console.error(`[perf:choice] fixture is missing: ${FIXTURE}`);
  process.exit(1);
}

const mime = new Map([
  [".css", "text/css"],
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".mjs", "text/javascript"],
  [".json", "application/json"],
  [".map", "application/json"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".pdf", "application/pdf"],
]);
const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  if (requestUrl.pathname !== BASE_PATH && !requestUrl.pathname.startsWith(BASE_PATH)) {
    response.writeHead(404).end("not found");
    return;
  }
  let relative;
  try {
    relative = decodeURIComponent(requestUrl.pathname.slice(BASE_PATH.length));
  } catch {
    response.writeHead(400).end("bad request");
    return;
  }
  if (!relative || relative.endsWith("/")) relative += "index.html";
  const filename = resolve(DIST_ROOT, relative);
  if (!filename.startsWith(`${DIST_ROOT}/`) || !existsSync(filename) || !statSync(filename).isFile()) {
    response.writeHead(404).end("not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": mime.get(extname(filename)) ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  response.end(readFileSync(filename));
});

const failures = [];
const checks = [];
const runtimeErrors = [];
mkdirSync(REPORT_DIR, { recursive: true });

const record = (label, pass, detail = undefined) => {
  checks.push({ label, pass, detail });
  console.log(`[perf:choice] ${pass ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};

function canvasRenderedScript() {
  const container = document.querySelector('[data-testid="sheet-canvas"]');
  if (!container) return false;
  const canvas = container.querySelector("canvas.fcb-pdf-page");
  if (!canvas) return false;
  const context = canvas.getContext("2d");
  if (!context) return false;
  const { width, height } = canvas;
  if (!width || !height) return false;
  const sample = context.getImageData(
    0,
    0,
    Math.min(width, 64),
    Math.min(height, 64),
  ).data;
  for (let index = 0; index < sample.length; index += 1) {
    if (sample[index] !== 0) return true;
  }
  return false;
}

// Fills the character name field (its text renders on the sheet header), clicks
// Save Details, and returns the millisecond latency until the mutation's busy
// state clears (the name input re-enables only after the mutation response and
// workspace snapshot have landed).
async function saveDetailsLatency(page, value, nameLocator) {
  await nameLocator.fill(value);
  const saveButton = page.getByRole("button", { name: "Save Details" }).first();
  const started = Date.now();
  await saveButton.click();
  try {
    await page.waitForFunction(
      (selector) => {
        const element = document.querySelector(selector);
        return element !== null && !element.disabled;
      },
      "input.fcb-input",
      { timeout: MUTATION_LATENCY_LIMIT_MS },
    );
  } catch {
    // Latency exceeded the limit; the caller records the failure.
  }
  return Date.now() - started;
}

await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
const address = server.address();
const siteOrigin = `http://127.0.0.1:${address.port}`;
const site = `${siteOrigin}${BASE_PATH}`;

let browser;
let mutationUnderRenderMs = null;
let sheetUpdateMs = null;
try {
  browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  context.on("page", (page) => {
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      // Benign harness noise: the init script touches localStorage on the
      // pre-navigation about:blank document, and resource-load messages are
      // informational for this gate.
      if (/localStorage|ERR_INVALID_URL|Failed to load resource/.test(text)) return;
      runtimeErrors.push(text);
    });
    page.on("pageerror", (error) => runtimeErrors.push(String(error)));
  });
  await context.addInitScript((key) => {
    try {
      localStorage.setItem(key, "1");
    } catch {
      // Pre-navigation about:blank documents deny storage access.
    }
  }, SPLIT_VIEW_KEY);
  const page = await context.newPage();

  await page.goto(site, { waitUntil: "domcontentloaded" });
  await page
    .locator('input[placeholder="New character name"]')
    .waitFor({ state: "visible", timeout: READY_TIMEOUT_MS });
  record("app boots to the character list", true);

  await page.locator('input[type="file"]').setInputFiles(FIXTURE);
  await page.locator('[data-testid="sheet-canvas"]').waitFor({
    state: "visible",
    timeout: READY_TIMEOUT_MS,
  });
  await page.waitForFunction(canvasRenderedScript, { timeout: RENDER_SETTLE_TIMEOUT_MS });
  record("spell-heavy fixture imports, workspace opens, initial full render completes", true);

  await page.locator('[data-testid="section-manage"]').first().click();
  const nameField = page
    .locator('label:has-text("Character Name") input.fcb-input')
    .first();
  await nameField.waitFor({ state: "visible" });

  const firstLatency = await saveDetailsLatency(page, `Perf Probe ${Date.now()}`, nameField);
  record("mutation 1 resolves", firstLatency < MUTATION_LATENCY_LIMIT_MS, `${firstLatency}ms`);

  // Land the second choice inside mutation 1's render window: the preview
  // debounce is 100ms and the render worker generates for hundreds of ms, so a
  // choice ~150ms after the first resolves mid-generation.
  await page.waitForTimeout(150);
  mutationUnderRenderMs = await saveDetailsLatency(
    page,
    `Perf Probe Second ${Date.now()}`,
    nameField,
  );
  record(
    "mutation resolves while the full sheet render is in flight",
    mutationUnderRenderMs < MUTATION_LATENCY_LIMIT_MS,
    `${mutationUnderRenderMs}ms (limit ${MUTATION_LATENCY_LIMIT_MS}ms)`,
  );
  if (mutationUnderRenderMs >= MUTATION_LATENCY_LIMIT_MS) {
    failures.push(
      `mutation-under-render latency ${mutationUnderRenderMs}ms exceeded the ${MUTATION_LATENCY_LIMIT_MS}ms limit`,
    );
  }

  // The full preview must still catch up in the background (behavior kept).
  const canvasBefore = await page.evaluate(canvasRenderedScript);
  await page
    .waitForFunction(canvasRenderedScript, { timeout: RENDER_SETTLE_TIMEOUT_MS })
    .catch(() => undefined);
  const canvasAfter = await page.evaluate(canvasRenderedScript);
  record(
    "full sheet preview catches up in the background",
    canvasBefore && canvasAfter,
    "",
  );

  // Choice -> sheet-updated latency: the user-visible metric. Wait for the
  // previous render's canvas to land and the sheet to settle, then measure a
  // fresh choice until the preview pixels change (debounce + worker render +
  // pdf.js canvas swap).
  const HASH = () => {
    // Downscale each full page into a 16x16 grid so changes anywhere on the
    // sheet (not just the top-left corner) flip the hash.
    const canvases = document.querySelectorAll(
      '[data-testid="sheet-canvas"] canvas.fcb-pdf-page',
    );
    let hash = 0;
    for (const canvas of canvases) {
      const small = document.createElement("canvas");
      small.width = 16;
      small.height = 16;
      const smallContext = small.getContext("2d");
      smallContext.drawImage(canvas, 0, 0, 16, 16);
      const data = smallContext.getImageData(0, 0, 16, 16).data;
      for (let index = 0; index < data.length; index += 1) {
        hash = (hash * 31 + data[index]) | 0;
      }
    }
    return hash;
  };
  await page.waitForTimeout(500);
  const settleHash = await page.evaluate(HASH);
  await nameField.fill(`Perf Probe Third ${Date.now()}`);
  const updateStarted = Date.now();
  await page.getByRole("button", { name: "Save Details" }).first().click();
  await page
    .waitForFunction(
      (previous) => {
        const canvases = document.querySelectorAll(
          '[data-testid="sheet-canvas"] canvas.fcb-pdf-page',
        );
        let hash = 0;
        for (const canvas of canvases) {
          const small = document.createElement("canvas");
          small.width = 16;
          small.height = 16;
          const smallContext = small.getContext("2d");
          smallContext.drawImage(canvas, 0, 0, 16, 16);
          const data = smallContext.getImageData(0, 0, 16, 16).data;
          for (let index = 0; index < data.length; index += 1) {
            hash = (hash * 31 + data[index]) | 0;
          }
        }
        return hash !== previous;
      },
      settleHash,
      { timeout: SHEET_UPDATE_TIMEOUT_MS },
    )
    .catch(() => undefined);
  sheetUpdateMs = Date.now() - updateStarted;
  record(
    "sheet preview updates after a choice",
    sheetUpdateMs < SHEET_UPDATE_LIMIT_MS,
    `${sheetUpdateMs}ms (limit ${SHEET_UPDATE_LIMIT_MS}ms)`,
  );
  if (sheetUpdateMs >= SHEET_UPDATE_LIMIT_MS) {
    failures.push(
      `choice->sheet-updated latency ${sheetUpdateMs}ms exceeded the ${SHEET_UPDATE_LIMIT_MS}ms limit`,
    );
  }
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
  console.error(`[perf:choice] ${error instanceof Error ? error.stack : String(error)}`);
} finally {
  if (browser) await browser.close();
  server.close();
}

for (const error of runtimeErrors) {
  failures.push(`runtime error: ${error}`);
}

const report = {
  basePath: BASE_PATH,
  fixture: FIXTURE,
  mutationLatencyLimitMs: MUTATION_LATENCY_LIMIT_MS,
  mutationUnderRenderMs,
  sheetUpdateMs,
  checks,
  failures,
  passed: failures.length === 0,
};
writeFileSync(
  join(REPORT_DIR, "perf-choice-latency.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);

console.log(
  `[perf:choice] ${failures.length === 0 ? "PASS" : "FAIL"} — mutation-under-render ${mutationUnderRenderMs ?? "n/a"}ms, ` +
    `report: ${join(REPORT_DIR, "perf-choice-latency.json")}`,
);
process.exit(failures.length === 0 ? 0 : 1);
