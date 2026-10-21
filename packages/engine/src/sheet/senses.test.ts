/**
 * Senses on the character page. A sense (Darkvision and the like) prints once,
 * with its range, in the page's own senses field — the 2014 Speed, Senses &
 * Conditions box, the 2024 Senses box, the Hybrid's Senses line — and never in
 * a features box, where a split layout would head it "Class Features".
 */

import { beforeAll, describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ElementLibrary } from "../content/library.js";
import { freshService, ID, select, sharedLibrary, STANDARD_ARRAY } from "../testing/character-factory.js";
import { localTemplateBundle } from "../testing/sheet-bundle.js";
import { buildCharacterSheetModel, type CharacterSheetModel } from "./model.js";
import { writeCharacterSheetPdfWithTemplateBundle } from "./pdf.js";
import type { SheetTemplateSet } from "./template-contract.js";

const SETS: readonly SheetTemplateSet[] = ["2014", "2024", "2024-hybrid"];

let library: ElementLibrary;
beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

function character(ruleset: "2014" | "2024"): CharacterSheetModel {
  const service = freshService(library);
  const id = `Senses${ruleset}`;
  service.createCharacter(id);
  service.setAbilities(id, STANDARD_ARRAY);
  if (ruleset === "2024") {
    service.setRulesetMode(id, "2024");
    select(service, id, "Race", "ID_WOTC_PHB24_RACE_AASIMAR");
    select(service, id, "Class", "ID_WOTC_PHB24_CLASS_FIGHTER");
  } else {
    select(service, id, "Race", ID.RACE_DWARF);
    select(service, id, "Sub Race", ID.SUB_RACE_HILL_DWARF);
    select(service, id, "Class", ID.CLASS_FIGHTER);
  }
  return buildCharacterSheetModel(service.getCharacter(id), library, {
    mode: "full",
    include: { background: false, notes: false, spellCards: false, itemCards: false },
  });
}

function featureRows(model: CharacterSheetModel): string[] {
  const details = model.pages.find((page) => page.templateKind === "details")!;
  const features = details.sections.find((section) => section.title === "features")!;
  return [...Object.values(details.featureGroups ?? {}).flat(), ...features.rows, ...(features.renderRows ?? [])]
    .flatMap((row) => row.kind === "lines" ? [...row.lines] : [row.tokens.join(" ")]);
}

async function texts(model: CharacterSheetModel, set: SheetTemplateSet): Promise<string[]> {
  const bytes = new Uint8Array(await writeCharacterSheetPdfWithTemplateBundle(model, localTemplateBundle(set)));
  const doc = await getDocument({ data: bytes }).promise;
  const out: string[] = [];
  for (let index = 1; index <= doc.numPages; index++) {
    for (const item of (await (await doc.getPage(index)).getTextContent()).items) if ("str" in item) out.push(item.str);
  }
  return out;
}

describe("senses", () => {
  it.each(["2014", "2024"] as const)("are never feature rows, and the senses field names each with its range (%s rules)", (ruleset) => {
    const model = character(ruleset);
    expect(featureRows(model).filter((text) => /^(Superior Darkvision|Darkvision|Blindsight|Truesight|Tremorsense)\b/.test(text))).toEqual([]);
    expect(model.formValues?.details_vision).toBe("Darkvision 60 ft.");
  });

  it.each(SETS)("print once on the %s page, in its senses field", async (set) => {
    for (const ruleset of ["2014", "2024"] as const) {
      const mentions = (await texts(character(ruleset), set)).filter((text) => text.includes("Darkvision"));
      expect(mentions, ruleset).toEqual(["Darkvision 60 ft."]);
    }
  }, 60_000);
});
