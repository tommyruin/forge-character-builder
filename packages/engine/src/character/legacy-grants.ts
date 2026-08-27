/**
 * Legacy DM-grant migration. Earlier releases persisted DM grants as a
 * `<dm-grants>` block before `</character>` plus synthesized registrations:
 * `Grants`-typed sum rows (`ID_DMGRANT_*`), one sum row per granted element,
 * a `Feat Feature` sum row for a granted feat's resolved choice, and caster
 * `<spell ... always-prepared="true">` rows for granted spells. None of those
 * carry a backing rule, so they cannot participate in the current grant model
 * (top-level granted nodes and `<magic><additional>` entries).
 *
 * `extractLegacyDmGrants` detects the block, strips every legacy artifact from
 * the XML, and reports the grants (in document order — ability-score carrier
 * ids are index-scoped) plus any recorded feat choices so the import path can
 * replay them through the current planners.
 */

export interface LegacySpellGrant {
  id: string;
  caster: string | null;
  prepared: boolean;
}

export interface LegacyDmGrants {
  cleanedXml: string;
  feats: string[];
  asis: string[];
  spells: LegacySpellGrant[];
  /** Granted feat id -> the feature element the user had chosen for it. */
  featChoices: Map<string, string>;
}

const BLOCK_PATTERN = /<dm-grants>[\s\S]*?<\/dm-grants>/;
const ENTRY_PATTERN = /<(spell|feat|asi)\s+([^>]*?)\/>/g;

function attr(attrs: string, name: string): string | null {
  const match = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return match?.[1] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Removes the first match of `pattern` (with surrounding indentation/newline). */
function stripFirst(xml: string, pattern: RegExp): { xml: string; match: RegExpExecArray | null } {
  const match = pattern.exec(xml);
  if (!match) return { xml, match: null };
  return { xml: xml.slice(0, match.index) + xml.slice(match.index + match[0].length), match };
}

function sumRowPattern(type: string, id: string): RegExp {
  return new RegExp(`[\\t ]*<element type="${escapeRegExp(type)}" id="${escapeRegExp(id)}" \\/>\\r?\\n`);
}

/** Recomputes the `<sum element-count>` attribute from its actual rows. */
function recountSum(xml: string): string {
  const open = xml.indexOf("<sum ");
  const close = xml.indexOf("</sum>");
  if (open < 0 || close < 0) return xml;
  const rows = xml.slice(open, close).split("<element ").length - 1;
  return (
    xml.slice(0, open) +
    xml.slice(open, close).replace(/element-count="\d+"/, `element-count="${rows}"`) +
    xml.slice(close)
  );
}

export function extractLegacyDmGrants(xmlText: string): LegacyDmGrants | null {
  const block = BLOCK_PATTERN.exec(xmlText);
  if (!block) return null;

  const feats: string[] = [];
  const asis: string[] = [];
  const spells: LegacySpellGrant[] = [];
  for (const entry of block[0].matchAll(ENTRY_PATTERN)) {
    const kind = entry[1]!;
    const attrs = entry[2]!;
    const id = attr(attrs, "id");
    if (id === null || id === "") continue;
    if (kind === "feat") feats.push(id);
    else if (kind === "asi") asis.push(id);
    else {
      const caster = attr(attrs, "caster");
      spells.push({
        id,
        caster: caster === "" ? null : caster,
        prepared: attr(attrs, "prepared")?.toLowerCase() !== "false",
      });
    }
  }

  let xml = xmlText.slice(0, block.index) + xmlText.slice(block.index + block[0].length);

  // The Grants marker rows.
  xml = xml.replace(/[\t ]*<element type="Grants" id="ID_DMGRANT_[^"]*" \/>\r?\n/g, "");

  // One sum row per granted element, the recorded feat choices (a Feat
  // Feature row named under the feat), and the caster rows of granted spells.
  const featChoices = new Map<string, string>();
  for (const featId of feats) {
    xml = stripFirst(xml, sumRowPattern("Feat", featId)).xml;
    const choicePattern = new RegExp(
      `[\\t ]*<element type="Feat Feature" id="(${escapeRegExp(featId)}_[A-Z_0-9]+)" \\/>\\r?\\n`,
    );
    const choice = stripFirst(xml, choicePattern);
    xml = choice.xml;
    if (choice.match) featChoices.set(featId, choice.match[1]!);
  }
  for (const asiId of asis) {
    xml = stripFirst(xml, sumRowPattern("Ability Score Improvement", asiId)).xml;
  }
  for (const spell of spells) {
    xml = stripFirst(xml, sumRowPattern("Spell", spell.id)).xml;
    xml = xml.replace(
      new RegExp(`[\\t ]*<spell [^>]*id="${escapeRegExp(spell.id)}"[^>]*\\/>\\r?\\n`),
      "",
    );
  }

  return { cleanedXml: recountSum(xml), feats, asis, spells, featChoices };
}
