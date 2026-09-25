/**
 * Spell-list pages fill the printed page before they continue: the model's
 * page budget is the geometry the writer draws with, so a level block that
 * physically fits is never carried onto another sheet of paper.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ElementLibrary } from "../content/library.js";
import { spellInfo } from "../magic/spelllist.js";
import { buildCharacter, ID, sharedLibrary } from "../testing/character-factory.js";
import { localTemplateBundle } from "../testing/sheet-bundle.js";
import { buildCharacterSheetModel } from "./model.js";
import { writeCharacterSheetPdfWithTemplateBundle } from "./pdf.js";

let library: ElementLibrary;

beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

describe("spell-list page filling", () => {
  it("keeps every level block on the page when the drawn page still has room", async () => {
    // The grants gather in one Additional Spells block with a section per
    // level. At this spread the sections together occupy 612pt of the 780pt
    // the page may hold, so the whole block draws on one page; a budget that
    // charged more than the writer draws moved the 9th-level section (and its
    // re-stamped header) to a second page.
    const { service, id } = buildCharacter(library, {
      id: "SpellPageFill",
      classId: ID.CLASS_FIGHTER,
      levels: 17,
    });
    const perLevel: Readonly<Record<number, number>> = { 0: 4, 1: 9, 2: 8, 3: 7, 4: 6, 5: 5, 6: 4, 7: 3, 8: 2, 9: 1 };
    const granted: Record<number, number> = {};
    const spellIds = (library.byType.get("Spell") ?? [])
      .map((element) => element.identity.id)
      .filter((spellId) => spellId.startsWith("ID_PHB_SPELL_"));
    for (const spellId of spellIds) {
      const level = spellInfo(library, spellId)?.level;
      if (level === undefined) continue;
      const target = perLevel[level] ?? 0;
      if ((granted[level] ?? 0) >= target) continue;
      try {
        service.addGrantedSpell(id, { spellId });
      } catch {
        continue; // already granted by the base build
      }
      granted[level] = (granted[level] ?? 0) + 1;
    }

    const model = buildCharacterSheetModel(service.getCharacter(id), library, {
      mode: "full",
      include: { background: false, notes: false, spellCards: false, itemCards: false },
    });
    const spellPages = model.pages.filter((page) => page.templateKind === "spell-list");
    expect(spellPages).toHaveLength(1);
    expect(
      spellPages[0]!.sections.filter((section) => section.title.startsWith("spells-")).map((section) => section.title),
    ).toEqual(["spells-1", "spells-2", "spells-3", "spells-4", "spells-5", "spells-6", "spells-7", "spells-8", "spells-9"]);

    const ninthLevel = (spellPages[0]!.spellcasting ?? [])
      .flatMap((caster) => caster.sections)
      .filter((section) => section.level === 9)
      .flatMap((section) => section.spells)
      .map((spell) => spell.name);
    expect(ninthLevel.length).toBeGreaterThan(0);
    const spellPage = model.pages.findIndex((page) => page.templateKind === "spell-list") + 1;

    for (const set of ["2014", "2024"] as const) {
      const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, localTemplateBundle(set));
      const browserPdf = await getDocument({ data: new Uint8Array(pdf.slice(0)) }).promise;
      expect(browserPdf.numPages).toBe(model.pageCount);
      const content = await (await browserPdf.getPage(spellPage)).getTextContent();
      const items = content.items.filter(
        (item): item is Extract<(typeof content.items)[number], { str: string }> => "str" in item,
      );
      for (const name of ninthLevel) {
        const drawn = items.find((item) => item.str === name);
        expect(drawn, `${set} ${name}`).toBeDefined();
        // The 9th-level block stays on the page, above the 12pt bottom margin.
        expect(drawn!.transform[5], `${set} ${name} above the margin`).toBeGreaterThanOrEqual(12);
      }
    }
  }, 180_000);

  it("prints every slot level's circles even with no spells chosen there", async () => {
    // A 17th-level wizard with no spells picked still has 4/3/3/3/2/1/1/1/1
    // slots to track; a level with slots but nothing chosen keeps its band.
    const { service, id } = buildCharacter(library, { id: "EmptySlotLevels", classId: ID.CLASS_WIZARD, levels: 17 });
    const model = buildCharacterSheetModel(service.getCharacter(id), library, {
      mode: "full",
      include: { background: false, notes: false, spellCards: false, itemCards: false },
    });
    const wizard = model.pages
      .filter((page) => page.templateKind === "spell-list")
      .flatMap((page) => page.spellcasting ?? [])
      .filter((caster) => caster.name === "Wizard");
    expect(wizard.flatMap((caster) => caster.sections).filter((section) => section.level > 0).map((section) => section.slots))
      .toEqual([4, 3, 3, 3, 2, 1, 1, 1, 1]);
    const spellPage = model.pages.findIndex((page) => page.templateKind === "spell-list") + 1;

    for (const set of ["2014", "2024"] as const) {
      const pdf = await writeCharacterSheetPdfWithTemplateBundle(model, localTemplateBundle(set));
      const browserPdf = await getDocument({ data: new Uint8Array(pdf.slice(0)) }).promise;
      const content = await (await browserPdf.getPage(spellPage)).getTextContent();
      const labels = content.items
        .filter((item): item is Extract<(typeof content.items)[number], { str: string }> => "str" in item)
        .map((item) => item.str)
        .filter((text) => /SPELL SLOT/.test(text));
      expect(labels, set).toEqual([
        "4 SPELL SLOTS", "3 SPELL SLOTS", "3 SPELL SLOTS", "3 SPELL SLOTS", "2 SPELL SLOTS",
        "1 SPELL SLOT", "1 SPELL SLOT", "1 SPELL SLOT", "1 SPELL SLOT",
      ]);
    }
  }, 180_000);
});
