#!/usr/bin/env node
/**
 * Browser smoke gate over the built client (apps/client/dist).
 *
 * Serves the production artifact at its real base path, waits for the engine
 * worker to reach interactive, creates a character, reloads the page, and
 * requires the character to survive in browser storage. Run
 * `npm run client:build` (or the root prepare script) first.
 */

import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE_PATH = process.env.PUBLIC_BASE_PATH || "/";
const DIST = resolve(process.cwd(), "apps/client/dist");
const CHARACTER_NAME = `Smoke Test ${process.pid}`;

if (!existsSync(DIST)) {
  console.error(
    `[verify:browser] FAIL dist not found at ${DIST} — run npm run client:build first`
  );
  process.exit(1);
}

const mime = new Map([
  [".css", "text/css"],
  [".html", "text/html"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript"],
  [".json", "application/json"],
  [".mjs", "text/javascript"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml"],
]);

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  if (!pathname.startsWith(BASE_PATH)) {
    response.writeHead(404).end();
    return;
  }
  let relative = pathname.slice(BASE_PATH.length);
  if (relative === "" || relative.endsWith("/")) relative += "index.html";
  let filename = join(DIST, relative);
  if (!existsSync(filename) || statSync(filename).isDirectory()) {
    const asIndex = join(DIST, relative, "index.html");
    if (existsSync(asIndex)) filename = asIndex;
    else {
      response.writeHead(404).end();
      return;
    }
  }
  response.writeHead(200, {
    "Content-Type": mime.get(extname(filename)) ?? "application/octet-stream",
  });
  response.end(readFileSync(filename));
});

await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const origin = `http://127.0.0.1:${server.address().port}`;
const url = `${origin}${BASE_PATH}`;

let failure = null;
const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page
    .locator('[data-fcb-engine-ready="true"]')
    .waitFor({ state: "attached", timeout: 120_000 });

  // A first visit announces the release notes; dismiss them like a user would.
  const closeNotes = page.getByRole("button", { name: "Close patch notes" });
  if (await closeNotes.isVisible().catch(() => false)) {
    await closeNotes.click();
    await page
      .locator(".dmf-release-overlay")
      .waitFor({ state: "detached", timeout: 10_000 });
  }

  await page.locator(".fcb-character-create-form .fcb-input").fill(CHARACTER_NAME);
  await page.locator('.fcb-character-create-form button[type="submit"]').click();
  await page
    .getByText(CHARACTER_NAME, { exact: false })
    .first()
    .waitFor({ timeout: 60_000 });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .locator('[data-fcb-engine-ready="true"]')
    .waitFor({ state: "attached", timeout: 120_000 });
  await page
    .getByText(CHARACTER_NAME, { exact: false })
    .first()
    .waitFor({ timeout: 60_000 });

  if (pageErrors.length) {
    throw new Error(`page errors during smoke run:\n${pageErrors.join("\n")}`);
  }
} catch (error) {
  failure = error;
} finally {
  await browser.close();
  server.close();
}

if (failure) {
  console.error(`[verify:browser] FAIL ${failure.message}`);
  process.exit(1);
}
console.log(
  "[verify:browser] PASS engine interactive, character created, and persisted across reload"
);
