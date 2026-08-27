/**
 * Character sheet template bundle: the template set's PDF files, served from
 * the deployment base and fetched once per set for the worker lifetime. Lives
 * outside the engine worker so the PDF render lane owns the fetch.
 */

import { engineError } from "../errors.js";
import type { StandardFonts } from "pdf-lib";
import type { CharacterSheetTemplateBundle, SheetFaceSource, SheetFaces } from "./pdf.js";
import {
  DEFAULT_SHEET_FONTS,
  DEFAULT_SHEET_TEMPLATE_SET,
  SHEET_FONT_FACES,
  SHEET_TEMPLATE_CONTRACT,
  isSheetTemplateSet,
  type SheetFontFace,
  type SheetFonts,
  type SheetTemplateLabels,
  type SheetTemplateSet,
} from "./template-contract.js";

type SheetTemplateLocation = { origin?: string };
type SheetAssetResult = { bytes: Uint8Array | null; failure?: string };

/** The relative path of a template file within a set's directory under the base. */
export function sheetTemplatePath(templateSet: SheetTemplateSet, name: string): string {
  return `${SHEET_TEMPLATE_CONTRACT.directory}/${templateSet}/${name}`;
}

/** Every file a complete template set consists of, in bundle order. */
export function sheetTemplateFiles(): readonly string[] {
  return [...Object.values(SHEET_TEMPLATE_CONTRACT.files), ...SHEET_TEMPLATE_CONTRACT.spellcastingSectionTops];
}

export function normalizeSheetTemplateBase(configuredBase: string, origin: string): URL {
  const base = configuredBase.trim() || "/";
  const url = new URL(base, `${origin}/`);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

export function resolveCharacterSheetTemplateUrl(name: string, configuredBase: string, origin: string): string {
  return new URL(name, normalizeSheetTemplateBase(configuredBase, origin)).toString();
}

/**
 * Fetches every template of a set; null when the host has no browser
 * location or fetch (Node tests), throwing a conflict error listing the
 * missing assets otherwise.
 */
export async function fetchCharacterSheetTemplateBundle(
  configuredBase: string,
  templateSet: SheetTemplateSet = DEFAULT_SHEET_TEMPLATE_SET,
  fonts: SheetFonts = DEFAULT_SHEET_FONTS,
): Promise<CharacterSheetTemplateBundle | null> {
  const location = (globalThis as { location?: SheetTemplateLocation }).location;
  const origin = location?.origin;
  if (origin === undefined || typeof fetch !== "function") return null;
  if (!isSheetTemplateSet(templateSet)) {
    throw engineError("conflict", `unknown character sheet template set '${String(templateSet)}'`);
  }

  let baseUrl: URL;
  try {
    baseUrl = normalizeSheetTemplateBase(configuredBase, origin);
  } catch (cause) {
    throw engineError(
      "conflict",
      `invalid character sheet template base '${configuredBase}': ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const fetchAsset = async (name: string): Promise<SheetAssetResult> => {
    const url = resolveCharacterSheetTemplateUrl(sheetTemplatePath(templateSet, name), configuredBase, origin);
    try {
      const response = await fetch(url);
      if (!response.ok) return { bytes: null, failure: `${name} (${response.status})` };
      return { bytes: new Uint8Array(await response.arrayBuffer()) };
    } catch (cause) {
      return { bytes: null, failure: `${name} (${cause instanceof Error ? cause.message : String(cause)})` };
    }
  };
  const entries = await Promise.all(
    Object.entries(SHEET_TEMPLATE_CONTRACT.files).map(async ([key, name]) => [key, await fetchAsset(name)] as const),
  );
  const spellcastingSectionTops = await Promise.all(
    SHEET_TEMPLATE_CONTRACT.spellcastingSectionTops.map((name) => fetchAsset(name)),
  );

  const labelsAsset = await fetchAsset(SHEET_TEMPLATE_CONTRACT.labelsFile);
  const fontFailures: string[] = [];
  const fontBytes = new Map<string, Uint8Array>();
  await Promise.all([...sheetFaceFiles(fonts)].map(async (file) => {
    const url = new URL(`${SHEET_TEMPLATE_CONTRACT.directory}/${SHEET_TEMPLATE_CONTRACT.fontsDirectory}/${file}`, baseUrl).toString();
    try {
      fontBytes.set(file, await fetchSheetFont(url));
    } catch (cause) {
      fontFailures.push(`${file} (${cause instanceof Error ? cause.message : String(cause)})`);
    }
  }));

  const failures = [
    ...entries.map(([, asset]) => asset.failure),
    ...spellcastingSectionTops.map((asset) => asset.failure),
    labelsAsset.failure,
    ...fontFailures,
  ].filter((failure): failure is string => failure !== undefined);
  if (failures.length > 0) {
    throw engineError(
      "conflict",
      `character sheet template assets unavailable under ${baseUrl.toString()}${SHEET_TEMPLATE_CONTRACT.directory}/${templateSet}/: ${failures.join(", ")}`,
      { baseUrl: baseUrl.toString(), templateSet, assets: failures },
    );
  }

  let labels: SheetTemplateLabels;
  try {
    labels = JSON.parse(new TextDecoder().decode(labelsAsset.bytes!)) as SheetTemplateLabels;
  } catch (cause) {
    throw engineError("conflict", `character sheet labels unreadable: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  return {
    ...Object.fromEntries(entries.map(([key, asset]) => [key, asset.bytes])),
    spellcastingSectionTops: spellcastingSectionTops.map((asset) => asset.bytes),
    labels,
    faces: sheetFaces(fonts, (file) => fontBytes.get(file)!),
  } as unknown as CharacterSheetTemplateBundle;
}

// Font files are shared across template sets and colour schemes, so they are
// fetched once per worker and reused by every bundle.
const fontPromises = new Map<string, Promise<Uint8Array>>();

async function fetchSheetFont(url: string): Promise<Uint8Array> {
  let pending = fontPromises.get(url);
  if (pending === undefined) {
    pending = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    })();
    fontPromises.set(url, pending);
    pending.catch(() => fontPromises.delete(url));
  }
  return pending;
}

type FaceStyle = "regular" | "bold" | "italic" | "boldItalic" | "caption";

/** The file a face uses for `style`, falling back through the styles it has. */
function faceFile(face: SheetFontFace, style: FaceStyle): string | undefined {
  const files = face.files;
  if (files === undefined) return undefined;
  if (style === "caption") return files.caption ?? files.bold ?? files.regular;
  if (style === "boldItalic") return files.boldItalic ?? files.bold ?? files.italic ?? files.regular;
  return files[style] ?? files.regular;
}

const STANDARD_STYLE: Record<Exclude<FaceStyle, "caption">, keyof NonNullable<SheetFontFace["standard"]>> = {
  regular: "regular",
  bold: "bold",
  italic: "italic",
  boldItalic: "boldItalic",
};

function faceSource(face: SheetFontFace, style: FaceStyle, read: (file: string) => Uint8Array): SheetFaceSource {
  const file = faceFile(face, style);
  if (file !== undefined) return { bytes: read(file) };
  const standard = face.standard!;
  const name = standard[STANDARD_STYLE[style === "caption" ? "bold" : style]];
  return { standard: name as StandardFonts };
}

/** The font files a choice of faces needs. */
export function sheetFaceFiles(fonts: SheetFonts): Set<string> {
  const files = new Set<string>();
  const add = (file: string | undefined) => {
    if (file !== undefined) files.add(file);
  };
  add(faceFile(SHEET_FONT_FACES[fonts.titles], "regular"));
  add(faceFile(SHEET_FONT_FACES[fonts.captions], "caption"));
  add(faceFile(SHEET_FONT_FACES[fonts.numbers], "bold"));
  for (const style of ["regular", "bold", "italic", "boldItalic"] as const) add(faceFile(SHEET_FONT_FACES[fonts.body], style));
  return files;
}

/** The faces a choice resolves to, reading each font file through `read`. */
export function sheetFaces(fonts: SheetFonts, read: (file: string) => Uint8Array): SheetFaces {
  const body = SHEET_FONT_FACES[fonts.body];
  return {
    titles: faceSource(SHEET_FONT_FACES[fonts.titles], "regular", read),
    captions: faceSource(SHEET_FONT_FACES[fonts.captions], "caption", read),
    numbers: faceSource(SHEET_FONT_FACES[fonts.numbers], "bold", read),
    body: {
      regular: faceSource(body, "regular", read),
      bold: faceSource(body, "bold", read),
      italic: faceSource(body, "italic", read),
      boldItalic: faceSource(body, "boldItalic", read),
    },
  };
}
