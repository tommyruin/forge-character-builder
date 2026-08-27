import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { corpusContentManifestPlugin } from "./config/contentManifest.mjs";
import { pdfStandardFontsPlugin } from "./config/pdfStandardFonts.mjs";
import { precompressedAssets } from "./config/precompressedAssets.js";
import { assetOverlayPlugin } from "./config/assetOverlay.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const contentProfile = process.env.VITE_FCB_CONTENT_PROFILE ?? "public-base";
// Vite transpiles this config into a temp bundle, so import.meta.url is not
// stable here; cwd is the client package root during builds.
// The shipped baseline is the bundled content in apps/client/public.
// The local test/inspection profiles still walk the full content corpus.
const contentRoot =
  contentProfile === "public-base"
    ? resolve(process.cwd(), "public", "content")
    : resolve(process.cwd(), "../../third-party/elements");

/**
 * Fingerprint of the engine sources, stamped into the bundle so Fast Start
 * snapshots are keyed on the code that produced them: any engine change
 * (after a build or dev-server restart) orphans stored snapshots without a
 * manual version bump. Test files are excluded — they cannot change output.
 */
function engineSourceFingerprint(): string {
  const hash = createHash("sha256");
  const roots = [
    resolve(process.cwd(), "../../packages/engine/src"),
    resolve(process.cwd(), "../../packages/api/src"),
  ];
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) files.push(full);
    }
  };
  for (const root of roots) walk(root);
  for (const file of files.sort()) {
    hash.update(file);
    hash.update("\0");
    hash.update(readFileSync(file));
  }
  return hash.digest("hex").slice(0, 16);
}

/**
 * The host shell: a directory exporting the shape described in
 * src/shell/contract.d.ts. Defaults to the neutral shell shipped here; a host
 * site points FCB_HOST_SHELL_DIR at its own module to brand the builder.
 */
function resolveHostShellDir(): string {
  const configured = process.env.FCB_HOST_SHELL_DIR;
  if (!configured) return resolve(root, "src/shell/default");
  const dir = resolve(configured);
  if (!existsSync(join(dir, "index.jsx"))) {
    throw new Error(`FCB_HOST_SHELL_DIR must contain an index.jsx: ${dir}`);
  }
  return dir;
}

/** The nearest package root above a directory, so its imports stay readable by the dev server. */
function packageRootOf(dir: string): string {
  let current = dir;
  while (!existsSync(join(current, "package.json"))) {
    const parent = dirname(current);
    if (parent === current) return dir;
    current = parent;
  }
  return current;
}

const hostShellDir = resolveHostShellDir();
const clientPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { version: string };
const basePath = process.env.PUBLIC_BASE_PATH || "/";
const hostProxyOrigin = process.env.FCB_HOST_PROXY_ORIGIN;

// Exported as real VITE_ env vars (not dotted defines) so the runtime
// import.meta.env object carries them through aliased access in both dev and
// production builds, and so index.html can interpolate them.
process.env.VITE_FCB_ENGINE_FINGERPRINT = engineSourceFingerprint();
process.env.VITE_FCB_VERSION = clientPackage.version;
process.env.VITE_FCB_APP_TITLE ??= "Forge Character Builder";
process.env.VITE_FCB_APP_DESCRIPTION ??= "Build and manage D&D 5e characters locally in your browser.";
process.env.VITE_FCB_THEME_COLOR ??= "#0b0f17";
process.env.VITE_FCB_DEFAULT_THEME ??= "dark";

export default defineConfig({
  base: basePath,
  // In a hosted deployment this server can front the whole site in
  // development: it owns the builder and forwards everything else to the host
  // at FCB_HOST_PROXY_ORIGIN. Vite proxies verbatim, so its own query suffixes
  // (?url, ?worker, ?raw) survive; a host-side rewrite would not preserve them.
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: [resolve(process.cwd(), "../.."), packageRootOf(hostShellDir)],
    },
    proxy: hostProxyOrigin
      ? {
          [`^(?!${basePath.replace(/\/$/, "")})`]: {
            target: hostProxyOrigin,
            changeOrigin: true,
            ws: true,
          },
        }
      : undefined,
  },
  plugins: [
    precompressedAssets(),
    pdfStandardFontsPlugin(),
    corpusContentManifestPlugin({
      corpusRoot: contentRoot,
      profile: contentProfile,
      basePath,
    }),
    react(),
    assetOverlayPlugin(),
  ],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      { find: /^@shell$/, replacement: join(hostShellDir, "index.jsx") },
      { find: /^@shell\/(.*)$/, replacement: join(hostShellDir, "$1") },
      { find: "@forge-cb/api", replacement: fileURLToPath(new URL("../../packages/api/src/index.ts", import.meta.url)) },
      { find: "@forge-cb/engine/browser", replacement: fileURLToPath(new URL("../../packages/engine/src/browser.ts", import.meta.url)) },
      { find: "@forge-cb/engine/sheet-contract", replacement: fileURLToPath(new URL("../../packages/engine/src/sheet/template-contract.ts", import.meta.url)) },
      { find: "@forge-cb/engine", replacement: fileURLToPath(new URL("../../packages/engine/src/index.ts", import.meta.url)) },
    ],
  },
  root,
  build: { outDir: "dist", emptyOutDir: true },
});
