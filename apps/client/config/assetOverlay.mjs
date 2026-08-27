/**
 * Optional host asset overlay.
 *
 * A host build may set `FCB_ASSET_OVERLAY_DIR` to a directory whose files are
 * served ahead of `public/` in development and copied over the build output
 * afterwards, so a host can swap the favicon or a legal page without the
 * repository carrying host-specific files. The default build never sets it and
 * must be complete on its own.
 */

import { cpSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const MIME = new Map([
  [".css", "text/css"],
  [".html", "text/html"],
  [".json", "application/json"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".xml", "application/xml"],
]);

export function overlayFiles(dir) {
  const files = [];
  const walk = (current, prefix) => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      const relativePath = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, relativePath);
      else files.push(relativePath);
    }
  };
  walk(dir, "");
  return files;
}

export function assetOverlayPlugin({ dir = process.env.FCB_ASSET_OVERLAY_DIR } = {}) {
  if (!dir) return { name: "asset-overlay", apply: () => false };
  const overlayRoot = resolve(dir);
  if (!existsSync(overlayRoot)) {
    throw new Error(`asset overlay directory does not exist: ${overlayRoot}`);
  }
  let base = "/";
  let outDir = "dist";
  return {
    name: "asset-overlay",
    configResolved(config) {
      base = config.base;
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith(base)) return next();
        const relativePath = decodeURIComponent(url.pathname.slice(base.length));
        const candidate = join(overlayRoot, relativePath);
        if (!candidate.startsWith(overlayRoot) || !existsSync(candidate) || statSync(candidate).isDirectory()) {
          return next();
        }
        response.setHeader("Content-Type", MIME.get(extname(candidate)) ?? "application/octet-stream");
        response.end(readFileSync(candidate));
      });
    },
    closeBundle() {
      cpSync(overlayRoot, resolve(outDir), { recursive: true, force: true });
    },
  };
}
