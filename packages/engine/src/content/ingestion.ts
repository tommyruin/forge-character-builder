import { engineError } from "../errors.js";
import { decodeBase64 } from "../platform.js";
import { replaceLibraryFiles, type ContentDiagnostic, type ElementLibrary } from "./library.js";

export interface ContentInputFile {
  path: string;
  base64: string;
}

const textDecoder = new TextDecoder();

function normalizePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized === "" || normalized.startsWith("/") || normalized.split("/").some((part) => part === "..")) {
    throw engineError("invalid-argument", `invalid content path '${path}'`);
  }
  return normalized;
}

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "function") {
    throw engineError("content-invalid", "deflate-compressed content is unavailable in this host");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Read the local-file records of a ZIP archive (stored and deflate entries). */
async function unzip(bytes: Uint8Array): Promise<Array<{ path: string; bytes: Uint8Array }>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files: Array<{ path: string; bytes: Uint8Array }> = [];
  let offset = 0;
  while (offset + 4 <= bytes.byteLength && u32(view, offset) === 0x04034b50) {
    if (offset + 30 > bytes.byteLength) throw engineError("content-invalid", "truncated ZIP local header");
    const flags = u16(view, offset + 6);
    const method = u16(view, offset + 8);
    const compressedSize = u32(view, offset + 18);
    const nameLength = u16(view, offset + 26);
    const extraLength = u16(view, offset + 28);
    if ((flags & 0x08) !== 0) {
      throw engineError("content-invalid", "ZIP data descriptors are not supported");
    }
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.byteLength) throw engineError("content-invalid", "truncated ZIP entry");
    const path = normalizePath(textDecoder.decode(bytes.subarray(nameStart, nameStart + nameLength)));
    const compressed = bytes.subarray(dataStart, dataEnd);
    const body = method === 0 ? new Uint8Array(compressed) : method === 8 ? await inflateRaw(compressed) : undefined;
    if (body === undefined) throw engineError("content-invalid", `unsupported ZIP compression method ${method}`);
    if (!path.endsWith("/") && path.toLowerCase().endsWith(".xml")) files.push({ path, bytes: body });
    offset = dataEnd;
  }
  if (files.length === 0) throw engineError("content-invalid", "ZIP bundle contains no XML files");
  return files;
}

/** Decode an uploaded XML or ZIP payload into normalized XML file records. */
export async function decodeContentFile(file: ContentInputFile): Promise<Array<{ path: string; text: string }>> {
  const path = normalizePath(file.path);
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(file.base64);
  } catch (cause) {
    throw engineError("content-invalid", `invalid base64 content for '${path}': ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    const entries = await unzip(bytes);
    return entries.map((entry) => ({ path: normalizePath(entry.path), text: textDecoder.decode(entry.bytes).replace(/^\uFEFF/, "") }));
  }
  return [{ path, text: textDecoder.decode(bytes).replace(/^\uFEFF/, "") }];
}

/**
 * The installed raw files, required by every incremental file operation.
 * A snapshot-booted library holds elements but none of the raw XML they came
 * from (the snapshot stores only the finalized library), so incrementally
 * editing it would silently rebuild from the new files alone; callers must
 * run a full content rebuild instead. An EMPTY library without raw files is
 * fine — building it from the incoming files alone is exactly right.
 */
function requireRawFiles(library: ElementLibrary): Map<string, string> {
  if (library.fileContents === undefined && library.elementCount > 0) {
    throw engineError(
      "conflict",
      "the installed content has no raw files (snapshot boot); a full content rebuild is required before incremental changes",
    );
  }
  return library.fileContents ?? new Map();
}

/** Install uploaded content in one atomic rebuild; duplicate paths replace. */
export async function ingestContentFiles(library: ElementLibrary, files: readonly ContentInputFile[]): Promise<ReturnType<typeof contentStatus> & { diagnostics: ContentDiagnostic[] }> {
  const next = new Map(requireRawFiles(library));
  const ingestedPaths = new Set<string>();
  for (const file of files) {
    const decoded = await decodeContentFile(file);
    for (const entry of decoded) {
      // ".index" files are updater manifests (file listings), not element
      // content; storing them yields zero elements while inflating the file
      // count, so they are skipped rather than parsed.
      if (entry.path.toLowerCase().endsWith(".index")) continue;
      next.set(entry.path, entry.text);
      ingestedPaths.add(entry.path);
    }
  }
  try {
    replaceLibraryFiles(library, next);
  } catch (cause) {
    throw engineError("content-invalid", `content ingestion failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  // Only findings about the files in THIS ingest surface to the caller —
  // longstanding corpus findings would otherwise repeat on every upload.
  const diagnostics = (library.diagnostics ?? []).filter((diagnostic) => ingestedPaths.has(diagnostic.file));
  return { ...contentStatus(library), diagnostics };
}

/**
 * Replaces the installed content with exactly `files` in one atomic rebuild —
 * the boot path's single authoritative pass (bundled + uploaded together),
 * with no residue from whatever was installed before.
 */
export async function replaceContentSet(library: ElementLibrary, files: readonly ContentInputFile[]): Promise<ReturnType<typeof contentStatus> & { diagnostics: ContentDiagnostic[] }> {
  const next = new Map<string, string>();
  const ingestedPaths = new Set<string>();
  for (const file of files) {
    const decoded = await decodeContentFile(file);
    for (const entry of decoded) {
      if (entry.path.toLowerCase().endsWith(".index")) continue;
      next.set(entry.path, entry.text);
      ingestedPaths.add(entry.path);
    }
  }
  try {
    replaceLibraryFiles(library, next);
  } catch (cause) {
    throw engineError("content-invalid", `content ingestion failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const diagnostics = (library.diagnostics ?? []).filter((diagnostic) => ingestedPaths.has(diagnostic.file));
  return { ...contentStatus(library), diagnostics };
}

export function removeContentFiles(library: ElementLibrary, paths: readonly string[]): ReturnType<typeof contentStatus> {
  const next = new Map(requireRawFiles(library));
  for (const path of paths) next.delete(normalizePath(path));
  replaceLibraryFiles(library, next);
  return contentStatus(library);
}

export async function patchContentFile(library: ElementLibrary, path: string, base64: string | null): Promise<ReturnType<typeof contentStatus>> {
  if (base64 === null) return removeContentFiles(library, [path]);
  return ingestContentFiles(library, [{ path, base64 }]);
}

export function contentStatus(library: ElementLibrary): {
  elementCount: number;
  sourceCount: number;
  fileCount: number;
  revision: number;
  typeCounts: Record<string, number>;
} {
  return {
    elementCount: library.elementCount,
    sourceCount: library.sources.size,
    fileCount: library.fileOrder.length,
    revision: library.revision ?? 0,
    typeCounts: { ...library.typeCounts },
  };
}

