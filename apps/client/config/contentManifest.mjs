import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { resolveContentProfile } from "./contentProfile.mjs";

const XML = /\.xml$/i;

function normalizeBasePath(basePath) {
  const withLeadingSlash = basePath.startsWith("/") ? basePath : `/${basePath}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

export async function collectCorpusXml(root, profile = "public-base") {
  const selectedProfile = resolveContentProfile(profile);
  const files = [];
  const walk = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile() && XML.test(entry.name)) {
        const path = relative(root, absolute).replaceAll("\\", "/");
        if (!selectedProfile.includes(path)) continue;
        const bytes = await readFile(absolute);
        files.push({
          path,
          bytes,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
    }
  };
  await walk(root);
  return files;
}

export function createContentManifest(files, basePath = "/", profile = "public-base") {
  const normalizedBase = normalizeBasePath(basePath);
  const selectedProfile = resolveContentProfile(profile);
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(file.path);
    digest.update("\0");
    digest.update(file.bytes);
    digest.update("\0");
  }
  return {
    version: 1,
    source: "apps/client/public/content",
    profile: selectedProfile.name,
    sourceCategories: selectedProfile.sourceCategories ?? [],
    digest: digest.digest("hex"),
    files: files.map(({ path, bytes, sha256 }) => ({
      path,
      url: `${normalizedBase}content/${path}`,
      sha256,
      bytes: bytes.byteLength,
    })),
  };
}

/** Collect the profile-selected files of the content root (the system elements live there too). */
export async function collectBundledFiles(corpusRoot, profile = "public-base") {
  return collectCorpusXml(corpusRoot, profile);
}

async function collectContentAssets(corpusRoot, basePath, profile) {
  const files = await collectBundledFiles(corpusRoot, profile);
  return {
    files,
    manifest: createContentManifest(files, basePath, profile),
  };
}

function manifestBytes(manifest) {
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
}

function contentRequestPath(pathname, basePath) {
  const normalizedBase = normalizeBasePath(basePath);
  const contentRoot = `${normalizedBase}content`.replace(/\/$/, "");
  const contentPrefix = `${contentRoot}/`;
  const rawPathIsContent = pathname === contentRoot || pathname.startsWith(contentPrefix);

  let decodedPathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return rawPathIsContent ? { invalid: true } : null;
  }

  const decodedPathIsContent =
    decodedPathname === contentRoot || decodedPathname.startsWith(contentPrefix);
  if (!rawPathIsContent && !decodedPathIsContent) return null;
  if (!decodedPathIsContent) return { invalid: true };

  const relativePath = decodedPathname.slice(contentPrefix.length);
  const segments = relativePath.split("/");
  if (
    !relativePath ||
    segments.some((segment) => segment === "." || segment === "..") ||
    relativePath.includes("\\") ||
    relativePath.includes("\0")
  ) {
    return { invalid: true };
  }
  return { relativePath };
}

function sendNotFound(response) {
  response.statusCode = 404;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end("Not found\n");
}

function devContentMiddleware({ corpusRoot, basePath, profile }) {
  let contentPromise;
  const loadContent = () => {
    contentPromise ??= collectContentAssets(corpusRoot, basePath, profile).then(({ files, manifest }) => ({
      filesByPath: new Map(files.map((file) => [file.path, file.bytes])),
      manifestBytes: manifestBytes(manifest),
    }));
    return contentPromise;
  };
  const middleware = async (request, response, next) => {
    if (!request.url || request.method !== "GET" && request.method !== "HEAD") return next();

    let url;
    try {
      url = new URL(request.url, "http://localhost");
    } catch {
      return next();
    }

    const rawPathname = request.url.startsWith("/")
      ? request.url.split(/[?#]/, 1)[0]
      : url.pathname;
    const route = contentRequestPath(rawPathname, basePath);
    if (!route) return next();
    if (route.invalid) return sendNotFound(response);

    let content;
    try {
      content = await loadContent();
    } catch (error) {
      return next(error);
    }

    const isManifest = route.relativePath === "manifest.json";
    const bytes = isManifest ? content.manifestBytes : content.filesByPath.get(route.relativePath);
    if (!bytes) return sendNotFound(response);

    response.statusCode = 200;
    response.setHeader(
      "Content-Type",
      isManifest ? "application/json; charset=utf-8" : "application/xml; charset=utf-8",
    );
    response.setHeader("Content-Length", bytes.byteLength);
    response.end(request.method === "HEAD" ? undefined : bytes);
  };
  middleware.warm = () => {
    // Start the corpus walk at server start so the first content request is
    // served from the in-memory manifest instead of paying the walk on first use.
    loadContent().catch(() => undefined);
  };
  return middleware;
}

export function corpusContentManifestPlugin({
  corpusRoot = resolve(process.cwd(), "public", "content"),
  basePath = process.env.PUBLIC_BASE_PATH || "/",
  profile = process.env.VITE_FCB_CONTENT_PROFILE ?? "public-base",
} = {}) {
  let publicDir = null;
  return {
    name: "fcb-corpus-content-manifest",
    configResolved(config) {
      publicDir = config.publicDir || null;
    },
    async generateBundle() {
      const { files, manifest } = await collectContentAssets(corpusRoot, basePath, profile);
      // Files that already live under public/content are copied by Vite; only
      // the rest (a corpus profile served from elsewhere) are emitted.
      const copiedByVite = publicDir !== null && resolve(corpusRoot) === resolve(publicDir, "content");
      for (const file of files) {
        if (copiedByVite && existsSync(join(corpusRoot, file.path))) continue;
        this.emitFile({ type: "asset", fileName: `content/${file.path}`, source: file.bytes });
      }
      this.emitFile({
        type: "asset",
        fileName: "content/manifest.json",
        source: manifestBytes(manifest),
      });
    },
    configureServer(server) {
      const middleware = devContentMiddleware({ corpusRoot, basePath, profile });
      middleware.warm();
      server.middlewares.use(middleware);
    },
  };
}
