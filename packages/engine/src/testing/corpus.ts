/**
 * Where the Node-side tests find content: the fetched corpus under
 * third-party/elements (absent until `npm run corpus:fetch`) and the engine's
 * own system elements, which ship with the client under content/system.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLibrary, type ElementLibrary } from "../content/library.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

export const CORPUS_ROOT = join(REPO_ROOT, "third-party", "elements");
export const SYSTEM_ROOT = join(REPO_ROOT, "apps", "client", "public", "content", "system");

/** The system elements plus every corpus file `includePath` admits. */
export function buildCorpusLibrary(includePath?: (relativePath: string) => boolean): Promise<ElementLibrary> {
  return buildLibrary(CORPUS_ROOT, includePath, SYSTEM_ROOT);
}
