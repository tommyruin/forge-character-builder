// Shared by the homebrew tests that drive generated XML through the real engine: the shipped
// content baseline plus a draft collection, built into one library.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createEmptyLibrary, replaceLibraryFiles } from '@forge-cb/engine';
import { PUBLIC_BASE_PATHS } from '../../../../config/contentProfile.mjs';
import { buildCollectionXml } from '../xmlBuilder.js';

const PUBLIC_ROOT = fileURLToPath(new URL('../../../../public/content/', import.meta.url));

let baseFiles;

// The shipped baseline files, read once per process.
export async function baselineFiles() {
  if (baseFiles) return baseFiles;
  const files = new Map();
  for (const name of PUBLIC_BASE_PATHS) files.set(name, await readFile(join(PUBLIC_ROOT, name), 'utf8'));
  for (const name of ['system-proxies.xml', 'system-unarmed-riders.xml']) {
    files.set(`system/${name}`, await readFile(join(PUBLIC_ROOT, 'system', name), 'utf8'));
  }
  baseFiles = files;
  return files;
}

// Every element id the shipped baseline defines.
export async function baselineIds() {
  const ids = new Set();
  for (const text of (await baselineFiles()).values()) {
    for (const match of text.matchAll(/\bid="(ID_[A-Z0-9_]+)"/g)) ids.add(match[1]);
  }
  return ids;
}

// A library of the baseline with each draft collection's generated XML on top.
export async function libraryWithHomebrew(...collections) {
  const files = new Map(await baselineFiles());
  for (const collection of collections) files.set(`homebrew/${collection.slug}.xml`, buildCollectionXml(collection));
  const library = createEmptyLibrary();
  replaceLibraryFiles(library, files);
  return library;
}
