/**
 * Loads a sheet template bundle from the client's public tree, the way the
 * render worker loads one over HTTP. Tests and the render benchmark share it,
 * so neither has to reach into the other.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CharacterSheetTemplateBundle } from "../sheet/pdf.js";
import { sheetFaces } from "../sheet/templates.js";
import {
  DEFAULT_SHEET_FONTS,
  DEFAULT_SHEET_TEMPLATE_SET,
  SHEET_TEMPLATE_CONTRACT,
  type SheetFonts,
  type SheetTemplateSet,
} from "../sheet/template-contract.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const SHEETS_ROOT = join(REPO_ROOT, "apps", "client", "public", "sheets");
const FONTS_DIR = join(SHEETS_ROOT, SHEET_TEMPLATE_CONTRACT.fontsDirectory);

/** Every template of `set`, drawn in the contract's default colours. */
export function localTemplateBundle(
  set: SheetTemplateSet = DEFAULT_SHEET_TEMPLATE_SET,
  fonts: SheetFonts = DEFAULT_SHEET_FONTS,
): CharacterSheetTemplateBundle {
  const dir = join(SHEETS_ROOT, set);
  const template = (name: string): Uint8Array => new Uint8Array(readFileSync(join(dir, name)));
  return {
    labels: JSON.parse(readFileSync(join(dir, SHEET_TEMPLATE_CONTRACT.labelsFile), "utf8")),
    faces: sheetFaces(fonts, (file) => new Uint8Array(readFileSync(join(FONTS_DIR, file)))),
    details: template(SHEET_TEMPLATE_CONTRACT.files.details),
    background: template(SHEET_TEMPLATE_CONTRACT.files.background),
    companion: template(SHEET_TEMPLATE_CONTRACT.files.companion),
    equipment: template(SHEET_TEMPLATE_CONTRACT.files.equipment),
    spellcastingHeader: template(SHEET_TEMPLATE_CONTRACT.files.spellcastingHeader),
    spellcastingSectionTops: Array.from({ length: 10 }, (_, level) =>
      template(SHEET_TEMPLATE_CONTRACT.spellcastingSectionTops[level]!)
    ),
    spellcastingSectionCenter: template(SHEET_TEMPLATE_CONTRACT.files.spellcastingSectionCenter),
    spellcastingSectionBottom: template(SHEET_TEMPLATE_CONTRACT.files.spellcastingSectionBottom),
    spellCard: template(SHEET_TEMPLATE_CONTRACT.files.spellCard),
    genericCard: template(SHEET_TEMPLATE_CONTRACT.files.genericCard),
  };
}
