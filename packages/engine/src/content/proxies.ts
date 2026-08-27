/**
 * Ingest-time proxy Item generation (the "Additional ..." items).
 *
 * The library contains Item proxies BEYOND the static corpus
 * (Item 14,309 vs corpus 766; Magic Item 2,370 vs 1,835 — the residual is
 * exactly the generated proxy set). The generation rule:
 *
 *   For every Spell element: one proxy per spellcasting name (Arcane
 *   Trickster, Artificer, Bard, Cleric, Druid, Eldritch Knight, Paladin,
 *   Ranger, Sorcerer, Warlock, Wizard) plus one unnamed ("Additional Spell").
 *   For every Language / Proficiency / Feat element: one proxy.
 *   For every "Ability Score Improvement" element with an ID_INTERNAL_* id:
 *   one proxy.
 *
 * Proxy ids embed the granted element's source slug, the grant (spellcasting
 * name slug or the element type token), and a kind derived from the granted
 * element's id:
 *
 *   ID_{SOURCE}_INTERNAL_ITEM_{GRANT}_SPELL_PROXY_{KIND}   (spells)
 *   ID_{SOURCE}_INTERNAL_ITEM_{TYPE}_PROXY_{KIND}          (lang/prof/feat)
 *   ID_{SOURCE}_INTERNAL_ITEM_PROXY_ASI_{ABILITY}          (ASI)
 *
 * KIND: the granted element id minus "ID_", truncated to the last occurrence
 * of the type token (SPELL/LANGUAGE/PROFICIENCY) or, for feats, minus the
 * leading source tokens and the FEAT token. The source slug is a per-source
 * name mapping ("Unearthed Arcana:*" sources derive
 * "UA" + the date token of their Source element id, e.g. UA20160606).
 *
 * The generated set is exactly 13,548 proxy ids.
 */

import type { ParsedElement, Rule } from "./parser.js";
import type { ElementLibrary } from "./library.js";

/** The granted types that generate proxies, with their id type tokens. */
const PROXY_TYPES: Array<{ type: string; token: string }> = [
  { type: "Spell", token: "SPELL" },
  { type: "Language", token: "LANGUAGE" },
  { type: "Proficiency", token: "PROFICIENCY" },
  { type: "Feat", token: "FEAT" },
  { type: "Ability Score Improvement", token: "ASI" },
];

/** Spellcasting names that get their own proxy variant per spell. */
const SPELLCASTINGS = [
  "ARCANE_TRICKSTER",
  "ARTIFICER",
  "BARD",
  "CLERIC",
  "DRUID",
  "ELDRITCH_KNIGHT",
  "PALADIN",
  "RANGER",
  "SORCERER",
  "WARLOCK",
  "WIZARD",
];

const SPELLCASTING_NAMES: Record<string, string> = {
  ARCANE_TRICKSTER: "Arcane Trickster",
  ARTIFICER: "Artificer",
  BARD: "Bard",
  CLERIC: "Cleric",
  DRUID: "Druid",
  ELDRITCH_KNIGHT: "Eldritch Knight",
  PALADIN: "Paladin",
  RANGER: "Ranger",
  SORCERER: "Sorcerer",
  WARLOCK: "Warlock",
  WIZARD: "Wizard",
};

/**
 * Source name -> proxy id slug (the slug is the granted element's source;
 * names not listed here generate nothing).
 */
const SOURCE_SLUGS: Record<string, string> = {
  "Acquisitions Incorporated": "ACQINC",
  "Adventurers League: State of Hillsfar": "ALSOH",
  "Astral Adventurer's Guide": "AAG",
  "Aurora Legacy Essentials": "ALE",
  "Bigby Presents: Glory of the Giants": "GOTG",
  "Dragon+ Magazine": "DPM",
  "Dragonlance: Shadow of the Dragon Queen": "DSDQ",
  "Dungeon Master’s Guide": "DMG",
  "Eberron: Rising from the Last War": "ERLW",
  "Explorer’s Guide to Wildemount": "EGTW",
  "Fizban's Treasury of Dragons": "FTOD",
  "Guildmasters’ Guide to Ravnica": "GGTR",
  "Icewind Dale: Rime of the Frostmaiden": "ROTF",
  "Lost Laboratory of Kwalish": "LLOK",
  "Monster Manual": "MM",
  "Monstrous Compendium Volume One: Spelljammer Creatures": "MCV1",
  "Monstrous Compendium Volume Three: Minecraft Creatures": "MCV3",
  "Mordenkainen’s Tome of Foes": "MTOF",
  "Mythic Odysseys of Theros": "MOOT",
  "One Grung Above": "OGA",
  "Plane Shift: Amonkhet": "PSA",
  "Plane Shift: Dominaria": "PSD",
  "Plane Shift: Ixalan": "PSIX",
  "Plane Shift: Kaladesh": "PSK",
  "Plane Shift: Zendikar": "PSZ",
  "Player’s Handbook": "PHB",
  "Player’s Handbook (2024)": "PHB24",
  "Princes of the Apocalypse": "POTA",
  "Sigil and the Outlands": "SATO",
  "Strixhaven: A Curriculum Of Chaos": "SCOC",
  "Sword Coast Adventurer’s Guide": "SCAG",
  "Tasha’s Cauldron of Everything": "TCOE",
  "The Book of Many Things": "BOMT",
  "Volo’s Guide to Monsters": "VGTM",
  "Xanathar’s Guide to Everything": "XGTE",
};

/** The proxy items' standard description body. */
const PROXY_DESCRIPTION =
  "<p><em>You can equip this item to \u201cenable\u201d it. It remains hidden from the inventory on your character sheet.</em></p>" +
  '<div class="reference">\n\t\t\t\t<div element="';

/**
 * Per-spell-level scroll metadata, mirroring the corpus's authored Spell
 * Scroll templates (rarity/cost setters and the DC/attack tiers of their
 * Spell Scroll table). Index = spell level, 0 for cantrips.
 */
const SCROLL_LEVELS: readonly { rarity: string; cost: string; dc: number; attack: number }[] = [
  { rarity: "Common", cost: "15", dc: 13, attack: 5 },
  { rarity: "Common", cost: "25", dc: 13, attack: 5 },
  { rarity: "Uncommon", cost: "250", dc: 13, attack: 5 },
  { rarity: "Uncommon", cost: "500", dc: 15, attack: 7 },
  { rarity: "Rare", cost: "2500", dc: 15, attack: 7 },
  { rarity: "Rare", cost: "5000", dc: 17, attack: 9 },
  { rarity: "Very Rare", cost: "15000", dc: 17, attack: 9 },
  { rarity: "Very Rare", cost: "25000", dc: 18, attack: 10 },
  { rarity: "Very Rare", cost: "50000", dc: 18, attack: 10 },
  { rarity: "Legendary", cost: "250000", dc: 19, attack: 11 },
];

/** The generated spell-scroll description body, with the level's DC/attack/rarity spliced in. */
function scrollDescription(level: { rarity: string; dc: number; attack: number }): string {
  return (
    "<p>A <em>spell scroll</em> bears the words of a single spell, written in a mystical cipher. If the spell is on your class\u2019s spell list, you can use an action to read the scroll and cast its spell without having to provide any of the spell\u2019s components. Otherwise, the scroll is unintelligible.</p>" +
    '<p class="indent">If the spell is on your class\u2019s spell list but of a higher level than you can normally cast, you must make an ability check using your spellcasting ability to determine whether you cast it successfully. The DC equals 10 + the spell\u2019s level. On a failed check, the spell disappears from the scroll with no other effect.</p>' +
    '<p class="indent">Once the spell is cast, the words on the scroll fade, and the scroll itself crumbles to dust.</p>' +
    `<p class="indent">The level of the spell on the scroll determines the spell\u2019s saving throw DC (${level.dc}) and attack bonus (+${level.attack}), as well as the scroll\u2019s rarity (${level.rarity}).</p>` +
    '<div class="reference"><div element="'
  );
}

/** The per-spell spell-scroll slug: the spell id minus source/type tokens. */
export function spellScrollSlug(spellId: string): string {
  const tokens = spellId.slice(3).split("_");
  const index = tokens.indexOf("SPELL");
  return index < 0 ? tokens.slice(1).join("_") : tokens.slice(index + 1).join("_");
}

/** The granted element's source slug for a proxy id. */
export function proxySourceSlug(
  source: string,
  sources: ElementLibrary["sources"],
): string | null {
  if (source.startsWith("Unearthed Arcana")) {
    const element = [...sources.values()].find((s) => s.identity.name === source);
    const last = element ? element.identity.id.split("_").pop() : null;
    if (last !== undefined && last !== null && /^\d+$/.test(last)) return `UA${last}`;
    return null;
  }
  return SOURCE_SLUGS[source] ?? null;
}

/** The kind segment of a proxy id, derived from the granted element's id. */
export function proxyKindSlug(id: string, typeToken: string): string {
  const tokens = id.slice(3).split("_");
  if (typeToken === "FEAT") {
    let i = tokens[0] === "WOTC" ? 2 : 1;
    if (tokens[i] === "FEAT") i++;
    return tokens.slice(i).join("_");
  }
  const last = tokens.lastIndexOf(typeToken);
  if (last < 0) return "";
  return tokens.slice(last).join("_");
}

/** Builds the ingest-generated proxy items for a library. */
export function generateItemProxies(library: {
  byType: ElementLibrary["byType"];
  sources: ElementLibrary["sources"];
}): ParsedElement[] {
  const out: ParsedElement[] = [];
  for (const { type, token } of PROXY_TYPES) {
    const elements = library.byType.get(type) ?? [];
    for (const element of elements) {
      if (
        type === "Ability Score Improvement" &&
        !/^ID_INTERNAL_ASI_(STRENGTH|DEXTERITY|CONSTITUTION|INTELLIGENCE|WISDOM|CHARISMA)$/.test(
          element.identity.id,
        )
      ) {
        continue;
      }
      const slug = proxySourceSlug(element.identity.source, library.sources);
      if (slug === null) continue;
      const kind = proxyKindSlug(element.identity.id, token);
      if (kind === "") continue;
      const grantedId = element.identity.id;
      const description = `${PROXY_DESCRIPTION}${grantedId}" />\n\t\t\t</div>`;
      const grantType = type === "Ability Score Improvement" ? "Ability Score Improvement" : type;
      const rule: Rule = { kind: "grant", type: grantType, id: grantedId };
      if (type === "Spell") {
        for (const casting of [...SPELLCASTINGS, ""]) {
          const name =
            casting === ""
              ? `Additional Spell, ${element.identity.name}`
              : `Additional ${SPELLCASTING_NAMES[casting]} Spell, ${element.identity.name}`;
          out.push({
            identity: {
              id: `ID_${slug}_INTERNAL_ITEM_${casting}_SPELL_PROXY_${kind}`,
              name,
              type: "Item",
              source: element.identity.source,
            },
            descriptionXml: description,
            setters: [],
            rules: [rule],
            supports: [],
            compendiumHidden: false,
            sheets: [],
            children: [],
            declaredBy: "",
          });
        }
      } else if (type === "Ability Score Improvement") {
        out.push({
          identity: {
            id: `ID_${slug}_INTERNAL_ITEM_PROXY_${kind}`,
            name: `Additional Ability Score Improvement, ${element.identity.name}`,
            type: "Item",
            source: element.identity.source,
          },
          descriptionXml: description,
          setters: [],
          rules: [rule],
          supports: [],
          compendiumHidden: false,
          sheets: [],
          children: [],
          declaredBy: "",
        });
      } else {
        out.push({
          identity: {
            id: `ID_${slug}_INTERNAL_ITEM_${token}_PROXY_${kind}`,
            name: `Additional ${token[0]!}${token.slice(1).toLowerCase()}, ${element.identity.name}`,
            type: "Item",
            source: element.identity.source,
          },
          descriptionXml: description,
          setters: [],
          rules: [rule],
          supports: [],
          compendiumHidden: false,
          sheets: [],
          children: [],
          declaredBy: "",
        });
      }
    }
  }
  for (const spell of library.byType.get("Spell") ?? []) {
    const slug = spellScrollSlug(spell.identity.id);
    if (slug === "") continue;
    const spellLevel = Number.parseInt(spell.setters.find((s) => s.name === "level")?.value ?? "0", 10);
    const level = SCROLL_LEVELS[Math.min(Math.max(Number.isFinite(spellLevel) ? spellLevel : 0, 0), 9)]!;
    out.push({
      identity: {
        id: `ID_INTERNAL_MAGIC_ITEM_SPELL_SCROLL_${slug}`,
        name: `Spell Scroll, ${spell.identity.name}`,
        type: "Magic Item",
        source: spell.identity.source,
      },
      descriptionXml: `${scrollDescription(level)}${spell.identity.id}" /></div>`,
      setters: [
        { name: "category", value: "Scrolls" },
        { name: "cost", value: level.cost, attrs: { currency: "gp" } },
        { name: "weight", value: "0 lb.", attrs: { lb: "0" } },
        { name: "type", value: "Scroll" },
        { name: "rarity", value: level.rarity },
        { name: "stackable", value: "true" },
      ],
      rules: [],
      supports: [],
      compendiumHidden: false,
      sheets: [],
      children: [],
      declaredBy: "",
    });
  }
  return out;
}
