/**
 * Legacy DM-grant migration: characters saved by earlier releases carry a
 * <dm-grants> block plus synthesized registrations (Grants sum rows, granted
 * element rows, a Feat Feature row for the resolved feat choice, and caster
 * spell rows flagged always-prepared). Import must migrate them into the
 * current grant model: removable grants, always-ready granted spells that do
 * not count against preparation, and the feat's recorded choice preserved.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { buildWizard4 } from "../testing/character-factory.js";
import { computeStatistics } from "../statistics/calculator.js";
import { buildCorpusLibrary } from "../testing/corpus.js";


const FEAT = "ID_PHB_FEAT_RESILIENT";
const FEAT_CHOICE = "ID_PHB_FEAT_RESILIENT_CONSTITUTION";
const SPELL = "ID_PHB_SPELL_INVISIBILITY";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
}, 120_000);

/** A wizard export rewritten into the legacy granted shape. */
function legacyWizardXml(): string {
  const { service, id } = buildWizard4(library, "LegacyGrants");
  let xml = service.exportCharacterXml(id);

  // The synthesized sum rows of the legacy engine, appended at the end.
  const sumClose = xml.indexOf("</sum>");
  const rows = [
    `\t\t\t<element type="Grants" id="ID_DMGRANT_FEAT_0_${FEAT}" />`,
    `\t\t\t<element type="Feat" id="${FEAT}" />`,
    `\t\t\t<element type="Grants" id="ID_DMGRANT_SPELL_1_${SPELL}" />`,
    `\t\t\t<element type="Spell" id="${SPELL}" />`,
    `\t\t\t<element type="Feat Feature" id="${FEAT_CHOICE}" />`,
    `\t\t\t<element type="Proficiency" id="ID_PROFICIENCY_SAVINGTHROW_CONSTITUTION" />`,
  ].join("\r\n");
  xml = `${xml.slice(0, sumClose)}${rows}\r\n\t\t${xml.slice(sumClose)}`;

  // The granted spell as the legacy engine recorded it in the caster list.
  const casterRow = `\t\t\t\t\t<spell name="Invisibility" level="2" id="${SPELL}" prepared="true" always-prepared="true" known="true" />`;
  const spellsClose = xml.indexOf("</spells>");
  if (spellsClose >= 0) {
    xml = `${xml.slice(0, spellsClose)}${casterRow}\r\n\t\t\t\t${xml.slice(spellsClose)}`;
  } else {
    const empty = xml.indexOf("<spells />");
    expect(empty).toBeGreaterThan(-1);
    xml =
      xml.slice(0, empty) +
      `<spells>\n${casterRow}\n\t\t\t\t</spells>` +
      xml.slice(empty + "<spells />".length);
  }

  // The <dm-grants> block, injected before </character> like the old writer.
  const close = xml.lastIndexOf("</character>");
  const block = `<dm-grants><feat id="${FEAT}" /><spell id="${SPELL}" caster="Wizard" prepared="true" /></dm-grants>`;
  return `${xml.slice(0, close)}${block}${xml.slice(close)}`;
}

describe("legacy dm-grants migration", () => {
  it("migrates the grants into the current model on import", () => {
    const service = new CharacterService(undefined, library);
    const { id } = { id: service.importCharacterXml("legacy-import", legacyWizardXml()).id };

    const grants = service.getDmGrants(id);
    expect(grants.some((grant) => grant.kind === "feat" && grant.id === FEAT)).toBe(true);
    expect(grants.some((grant) => grant.kind === "spell" && grant.id === SPELL)).toBe(true);

    // The migrated document carries no legacy artifacts.
    const exported = service.exportCharacterXml(id);
    expect(exported).not.toContain("dm-grants");
    expect(exported).not.toContain("ID_DMGRANT");
  });

  it("keeps the granted spell always-ready and out of the prepared count", () => {
    const baseline = buildWizard4(library, "LegacyGrantsBaseline");
    const baselineCaster = baseline.service
      .getSpellcasting(baseline.id)
      .find((caster) => caster.name === "Wizard");
    expect(baselineCaster).toBeDefined();

    const service = new CharacterService(undefined, library);
    const { id } = service.importCharacterXml("legacy-prepared", legacyWizardXml());
    const caster = service.getSpellcasting(id).find((candidate) => candidate.name === "Wizard");
    expect(caster).toBeDefined();
    // The granted spell must not count against preparation; it surfaces as an
    // always-ready DM grant instead (the client renders it from getDmGrants).
    expect(caster!.currentPreparedCount).toBe(baselineCaster!.currentPreparedCount);
    expect(
      service.getDmGrants(id).some((grant) => grant.kind === "spell" && grant.id === SPELL),
    ).toBe(true);
  });

  it("surfaces the granted spell as an always-ready row and removes it on request", () => {
    const service = new CharacterService(undefined, library);
    const { id } = service.importCharacterXml("legacy-spell-row", legacyWizardXml());

    const casterOf = () =>
      service.getSpellcasting(id).find((candidate) => candidate.name === "Wizard")!;
    const granted = casterOf().knownSpells.find((spell) => spell.id === SPELL);
    expect(granted).toBeDefined();
    expect(granted!.isAlwaysPrepared).toBe(true);
    // Always-ready means it never consumes a preparation slot.
    expect(granted!.isPrepared).toBe(false);

    service.removeGrantedSpell(id, { spellId: SPELL });
    expect(
      service.getDmGrants(id).some((grant) => grant.kind === "spell" && grant.id === SPELL),
    ).toBe(false);
    expect(casterOf().knownSpells.some((spell) => spell.id === SPELL)).toBe(false);
  });

  it("preserves the recorded feat choice and keeps the grant removable", () => {
    const service = new CharacterService(undefined, library);
    const { id } = service.importCharacterXml("legacy-feat", legacyWizardXml());

    const state = service.getCharacter(id);
    const values = computeStatistics(state, library);
    // Resilient (Constitution): save proficiency conveyed by the chosen feature.
    expect(values["constitution:save:proficiency"] ?? 0).toBeGreaterThan(0);

    service.removeGrantedFeat(id, { featId: FEAT });
    const after = service.getDmGrants(id);
    expect(after.some((grant) => grant.kind === "feat" && grant.id === FEAT)).toBe(false);
  });
});
