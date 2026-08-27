/**
 * Byte-faithful .dnd5e document model.
 *
 * Every node keeps the exact source slice of its full region (open tag through
 * close tag), so serialize() re-emits the original text without reassembly.
 * The document-level raw string includes the UTF-8 BOM (Node keeps it when
 * reading utf8) and the exact EOF bytes. Attribute order is preserved; values
 * are kept raw and decoded on demand. Mutations (later phases) will replace
 * regions by offset.
 */

export type Attr = readonly [name: string, rawValue: string];

export interface Dnd5eNode {
  name: string;
  /** Attribute pairs in source order; values raw (undecoded). */
  attrs: Attr[];
  /** Element children in document order. Comments/CDATA/text live in the raw slice, not here. */
  children: Dnd5eNode[];
  /** Original empty form: `<x />` (true) vs `<x></x>` (false). The form is node-specific. */
  selfClosing: boolean;
  /** Exact source bytes of this node's full region. */
  raw: string;
  /** Byte offset of the open-tag `<`. */
  start: number;
  /** Byte offset just past the open-tag `>`. */
  openEnd: number;
  /** Byte offset of the close-tag `<`, or null when self-closing. */
  closeStart: number | null;
  /** Byte offset just past the close-tag `>`. */
  end: number;
}

export interface Dnd5eDocument {
  /** Full original text, BOM and all. */
  raw: string;
  /** Structured view for the character model. */
  root: CharacterRoot;
  /** Byte-identical to the source for unmutated documents. */
  serialize(): string;
}

export interface CharacterRoot {
  node: Dnd5eNode;
  version: string | null;
  preview: string | null;
  information: InformationView;
  displayProperties: DisplayPropertiesView;
  build: BuildView;
  sources: SourcesView;
  /** The <ruleset mode="..."> tag (absent when the file predates it). */
  rulesetMode(): string | null;
}

export interface InformationView {
  node: Dnd5eNode | null;
  group(): string | null;
  generationOption(): string | null;
}

export interface DisplayPropertiesView {
  node: Dnd5eNode | null;
  name(): string | null;
  race(): string | null;
  class(): string | null;
  archetype(): string | null;
  background(): string | null;
  level(): string | null;
  favorite(): string | null;
  portrait(): PortraitView | null;
}

export interface PortraitView {
  node: Dnd5eNode;
  companion(): string | null;
  local(): string | null;
  base64(): string | null;
}

export interface BuildView {
  node: Dnd5eNode | null;
  input: InputView | null;
  appearance: AppearanceView | null;
  abilities: AbilitiesView | null;
  elements: ElementsView | null;
  defenses: DefensesView | null;
  companion: CompanionView | null;
  equipment: EquipmentView | null;
  sum: SumView | null;
  magic: Dnd5eNode | null;
  spellcasting: SpellcastingView[];
}

export interface InputView {
  node: Dnd5eNode;
  name(): string | null;
  gender(): string | null;
  playerName(): string | null;
  experience(): string | null;
  attacks(): AttackView | null;
  backstory(): string | null;
  backgroundTrinket(): string | null;
  backgroundTraits(): string | null;
  backgroundIdeals(): string | null;
  backgroundBonds(): string | null;
  backgroundFlaws(): string | null;
  backgroundFeature(): BackgroundFeatureView | null;
  organization(): OrganizationView | null;
  additionalFeatures(): string | null;
  currency(): CurrencyView | null;
  notes(): NotesView | null;
  quest(): string | null;
}

export interface AttackView {
  node: Dnd5eNode;
  description(): string | null;
  /** `<attack>` nodes: identifier, name, range, attack, damage, displayed, ability attrs. */
  attacks(): Dnd5eNode[];
}

export interface BackgroundFeatureView {
  node: Dnd5eNode;
  name(): string | null;
  description(): string | null;
}

export interface OrganizationView {
  node: Dnd5eNode;
  name(): string | null;
  symbol(): string | null;
  allies(): string | null;
}

export interface CurrencyView {
  node: Dnd5eNode;
  copper(): string | null;
  silver(): string | null;
  electrum(): string | null;
  gold(): string | null;
  platinum(): string | null;
  equipment(): string | null;
  treasure(): string | null;
}

export interface NotesView {
  node: Dnd5eNode;
  notes(): { column: string | null; text: string }[];
}

export interface AppearanceView {
  node: Dnd5eNode;
  portrait(): string | null;
  age(): string | null;
  height(): string | null;
  weight(): string | null;
  eyes(): string | null;
  skin(): string | null;
  hair(): string | null;
}

export const ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"] as const;
export type Ability = (typeof ABILITIES)[number];

export interface AbilitiesView {
  node: Dnd5eNode;
  availablePoints(): string | null;
  scores(): Record<Ability, string | null>;
}

export interface ElementsView {
  node: Dnd5eNode;
  levelCount(): number | null;
  registeredCount(): number | null;
  /** Direct `<element>` children (the Level wrapper at the top of the tree). */
  elements(): Dnd5eNode[];
}

export interface DefensesView {
  node: Dnd5eNode;
  conditional(): Dnd5eNode | null;
}

export interface CompanionView {
  node: Dnd5eNode;
  name(): string | null;
  attributeScores(): Record<Ability, string | null>;
  saves(): { ability: string | null; value: string }[];
  skills(): { name: string | null; value: string }[];
  portraitLocation(): string | null;
}

export interface EquipmentView {
  node: Dnd5eNode;
  storage(): Dnd5eNode[];
  items(): ItemView[];
}

export interface ItemView {
  node: Dnd5eNode;
  identifier(): string | null;
  name(): string | null;
  id(): string | null;
  /** Whether this item is rendered in the full-sheet item card section. */
  card(): string | null;
  /** Whether this item's details are rendered in the inventory sidebar. */
  sidebar(): string | null;
  equipped(): { location: string | null; value: string } | null;
  /** The `<storage><location>` text (the container name it is stowed in), or null when carried. */
  storage(): string | null;
  /** True when the item is attuned (fixture files carry `<attunement>true</attunement>`). */
  attuned(): boolean;
  adorners(): Dnd5eNode[];
  details(): ItemDetailsView | null;
}

export interface ItemDetailsView {
  node: Dnd5eNode;
  card(): string | null;
  name(): string | null;
  notes(): string | null;
}

export interface SumView {
  node: Dnd5eNode;
  elementCount(): number | null;
  /** Flat `<element>` list in file order. */
  elements(): { node: Dnd5eNode; type: string | null; id: string | null }[];
}

export interface SpellcastingView {
  node: Dnd5eNode;
  name(): string | null;
  ability(): string | null;
  attack(): string | null;
  dc(): string | null;
  source(): string | null;
  slots(): Record<string, string>;
  cantrips(): Dnd5eNode[];
  spells(): SpellView[];
}

export interface SpellView {
  node: Dnd5eNode;
  name: string | null;
  level: string | null;
  id: string | null;
  prepared: string | null;
  alwaysPrepared: string | null;
  known: string | null;
}

export interface SourcesView {
  node: Dnd5eNode | null;
  restricted(): RestrictedView | null;
}

export interface RestrictedView {
  node: Dnd5eNode;
  sources(): { id: string | null; name: string | null; node: Dnd5eNode }[];
  elements(): Dnd5eNode[];
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? match;
  });
}

const isWs = (code: number): boolean => code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;

/** Index just past the `>` of the open tag starting at `start`, quote-aware. */
function findOpenTagEnd(source: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i]!;
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i + 1;
    }
  }
  throw new Error(`unterminated tag at offset ${start}`);
}

function parseAttrs(inner: string, from: number): Attr[] {
  const attrs: Attr[] = [];
  let i = from;
  const n = inner.length;
  while (i < n) {
    while (i < n && isWs(inner.charCodeAt(i))) i++;
    if (i >= n) break;
    const nameStart = i;
    while (i < n && inner[i] !== "=" && !isWs(inner.charCodeAt(i))) i++;
    const name = inner.slice(nameStart, i);
    while (i < n && isWs(inner.charCodeAt(i))) i++;
    if (inner[i] !== "=") throw new Error(`malformed attribute '${name}': expected '='`);
    i++;
    while (i < n && isWs(inner.charCodeAt(i))) i++;
    const q = inner[i];
    if (q !== '"' && q !== "'") throw new Error(`malformed attribute '${name}': expected quoted value`);
    const valueEnd = inner.indexOf(q, i + 1);
    if (valueEnd < 0) throw new Error(`malformed attribute '${name}': unterminated value`);
    attrs.push([name, inner.slice(i + 1, valueEnd)]);
    i = valueEnd + 1;
  }
  return attrs;
}

const skipComment = (source: string, pos: number): number => {
  const end = source.indexOf("-->", pos + 4);
  if (end < 0) throw new Error(`unterminated comment at offset ${pos}`);
  return end + 3;
};

const skipCdata = (source: string, pos: number): number => {
  const end = source.indexOf("]]>", pos + 9);
  if (end < 0) throw new Error(`unterminated CDATA at offset ${pos}`);
  return end + 3;
};

const skipPi = (source: string, pos: number): number => {
  const end = source.indexOf("?>", pos + 2);
  if (end < 0) throw new Error(`unterminated processing instruction at offset ${pos}`);
  return end + 2;
};

function parseElement(source: string, start: number): Dnd5eNode {
  const openEnd = findOpenTagEnd(source, start);
  const inner = source.slice(start + 1, openEnd - 1);
  const selfClosing = inner.endsWith("/");
  const attrsInner = selfClosing ? inner.slice(0, -1) : inner;
  const nameEnd = attrsInner.search(/[\s/>]/);
  const name = nameEnd < 0 ? attrsInner : attrsInner.slice(0, nameEnd);
  const attrs = parseAttrs(attrsInner, nameEnd < 0 ? attrsInner.length : nameEnd + 1);

  const node: Dnd5eNode = {
    name,
    attrs,
    children: [],
    selfClosing,
    raw: "",
    start,
    openEnd,
    closeStart: null,
    end: openEnd,
  };
  if (selfClosing) {
    node.raw = source.slice(start, openEnd);
    return node;
  }

  let pos = openEnd;
  for (;;) {
    const lt = source.indexOf("<", pos);
    if (lt < 0) throw new Error(`unclosed element <${name}> starting at offset ${start}`);
    if (source.startsWith("</", lt)) {
      const closeEnd = source.indexOf(">", lt + 2);
      if (closeEnd < 0) throw new Error(`unterminated close tag for <${name}> at offset ${lt}`);
      const closeName = source.slice(lt + 2, closeEnd).split(/[\s>]/, 1)[0]!;
      if (closeName !== name) {
        throw new Error(`mismatched close tag </${closeName}> for <${name}> at offset ${lt}`);
      }
      node.closeStart = lt;
      node.end = closeEnd + 1;
      node.raw = source.slice(start, node.end);
      return node;
    }
    if (source.startsWith("<!--", lt)) {
      pos = skipComment(source, lt);
      continue;
    }
    if (source.startsWith("<![CDATA[", lt)) {
      pos = skipCdata(source, lt);
      continue;
    }
    if (source.startsWith("<?", lt)) {
      pos = skipPi(source, lt);
      continue;
    }
    const next = source[lt + 1];
    if (next === undefined || isWs(next.charCodeAt(0)) || next === "/" || next === "!" || next === "?" || next === ">") {
      pos = lt + 1;
      continue;
    }
    const child = parseElement(source, lt);
    node.children.push(child);
    pos = child.end;
  }
}

/** Text regions (absolute offsets) of a node, excluding its element children. */
function textRegions(node: Dnd5eNode): [number, number][] {
  const regions: [number, number][] = [];
  let pos = node.openEnd;
  for (const childNode of node.children) {
    const from = pos - node.start;
    const to = childNode.start - node.start;
    if (from < to) regions.push([from, to]);
    pos = childNode.end;
  }
  if (node.closeStart !== null) {
    const from = pos - node.start;
    const to = node.closeStart - node.start;
    if (from < to) regions.push([from, to]);
  }
  return regions;
}

/** CDATA sections kept literal, entities decoded, whitespace trimmed. */
function decodeText(raw: string): string {
  let out = "";
  let pos = 0;
  for (;;) {
    const cdataStart = raw.indexOf("<![CDATA[", pos);
    if (cdataStart < 0) {
      out += decodeEntities(raw.slice(pos));
      break;
    }
    out += decodeEntities(raw.slice(pos, cdataStart));
    const cdataEnd = raw.indexOf("]]>", cdataStart + 9);
    if (cdataEnd < 0) {
      out += raw.slice(cdataStart);
      break;
    }
    out += raw.slice(cdataStart + 9, cdataEnd);
    pos = cdataEnd + 3;
  }
  return out.trim();
}

/** Decoded text content of a node (CDATA kept literal, entities decoded, trimmed). */
export function textContent(node: Dnd5eNode): string {
  let out = "";
  for (const [from, to] of textRegions(node)) {
    out += decodeText(node.raw.slice(from, to));
  }
  return out.trim();
}

/** Comment texts appearing directly inside a node (banner lines between its children). */
export function comments(node: Dnd5eNode): string[] {
  const out: string[] = [];
  for (const [from, to] of textRegions(node)) {
    const raw = node.raw.slice(from, to);
    let pos = 0;
    for (;;) {
      const start = raw.indexOf("<!--", pos);
      if (start < 0) break;
      const end = raw.indexOf("-->", start + 4);
      if (end < 0) break;
      out.push(raw.slice(start + 4, end).trim());
      pos = end + 3;
    }
  }
  return out;
}

/** Decoded attribute value, or null when the attribute is absent. */
export function getAttr(node: Dnd5eNode, name: string): string | null {
  for (const [n, rawValue] of node.attrs) {
    if (n === name) return decodeEntities(rawValue);
  }
  return null;
}

/** Raw (undecoded) attribute value, or null when the attribute is absent. */
export function getAttrRaw(node: Dnd5eNode, name: string): string | null {
  for (const [n, rawValue] of node.attrs) {
    if (n === name) return rawValue;
  }
  return null;
}

/** First direct child element with the given name, or null. */
export function child(node: Dnd5eNode, name: string): Dnd5eNode | null {
  for (const childNode of node.children) {
    if (childNode.name === name) return childNode;
  }
  return null;
}

/** Direct child elements, optionally filtered by name, in document order. */
export function childElements(node: Dnd5eNode, name?: string): Dnd5eNode[] {
  const out: Dnd5eNode[] = [];
  for (const childNode of node.children) {
    if (name === undefined || childNode.name === name) out.push(childNode);
  }
  return out;
}

/** All elements in the subtree, in document order, optionally filtered by name. */
export function descendants(node: Dnd5eNode, name?: string): Dnd5eNode[] {
  const out: Dnd5eNode[] = [];
  for (const childNode of node.children) {
    out.push(childNode, ...descendants(childNode));
  }
  return name === undefined ? out : out.filter((n) => n.name === name);
}

const textOf = (node: Dnd5eNode, name: string): string | null => {
  const c = child(node, name);
  return c ? textContent(c) : null;
};

const attrRecord = (node: Dnd5eNode): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [n, rawValue] of node.attrs) out[n] = decodeEntities(rawValue);
  return out;
};

function createInformationView(node: Dnd5eNode | null): InformationView {
  return {
    node,
    group: () => (node ? textOf(node, "group") : null),
    generationOption: () => (node ? textOf(node, "generationOption") : null),
  };
}

function createDisplayPropertiesView(node: Dnd5eNode | null): DisplayPropertiesView {
  return {
    node,
    name: () => (node ? textOf(node, "name") : null),
    race: () => (node ? textOf(node, "race") : null),
    class: () => (node ? textOf(node, "class") : null),
    archetype: () => (node ? textOf(node, "archetype") : null),
    background: () => (node ? textOf(node, "background") : null),
    level: () => (node ? textOf(node, "level") : null),
    favorite: () => (node ? getAttr(node, "favorite") : null),
    portrait: () => {
      const p = node ? child(node, "portrait") : null;
      if (!p) return null;
      return {
        node: p,
        companion: () => textOf(p, "companion"),
        local: () => textOf(p, "local"),
        base64: () => textOf(p, "base64"),
      };
    },
  };
}

function createInputView(node: Dnd5eNode | null): InputView | null {
  if (!node) return null;
  return {
    node,
    name: () => textOf(node, "name"),
    gender: () => textOf(node, "gender"),
    playerName: () => textOf(node, "player-name"),
    experience: () => textOf(node, "experience"),
    attacks: () => {
      const a = child(node, "attacks");
      if (!a) return null;
      return {
        node: a,
        description: () => textOf(a, "description"),
        attacks: () => childElements(a, "attack"),
      };
    },
    backstory: () => textOf(node, "backstory"),
    backgroundTrinket: () => textOf(node, "background-trinket"),
    backgroundTraits: () => textOf(node, "background-traits"),
    backgroundIdeals: () => textOf(node, "background-ideals"),
    backgroundBonds: () => textOf(node, "background-bonds"),
    backgroundFlaws: () => textOf(node, "background-flaws"),
    backgroundFeature: () => {
      const bg = child(node, "background");
      const feature = bg ? child(bg, "feature") : null;
      if (!feature) return null;
      return {
        node: feature,
        name: () => getAttr(feature, "name"),
        description: () => textOf(feature, "description"),
      };
    },
    organization: () => {
      const org = child(node, "organization");
      if (!org) return null;
      return {
        node: org,
        name: () => textOf(org, "name"),
        symbol: () => textOf(org, "symbol"),
        allies: () => textOf(org, "allies"),
      };
    },
    additionalFeatures: () => textOf(node, "additional-features"),
    currency: () => {
      const c = child(node, "currency");
      if (!c) return null;
      return {
        node: c,
        copper: () => textOf(c, "copper"),
        silver: () => textOf(c, "silver"),
        electrum: () => textOf(c, "electrum"),
        gold: () => textOf(c, "gold"),
        platinum: () => textOf(c, "platinum"),
        equipment: () => textOf(c, "equipment"),
        treasure: () => textOf(c, "treasure"),
      };
    },
    notes: () => {
      const n = child(node, "notes");
      if (!n) return null;
      return {
        node: n,
        notes: () =>
          childElements(n, "note").map((note) => ({
            column: getAttr(note, "column"),
            text: textContent(note),
          })),
      };
    },
    quest: () => textOf(node, "quest"),
  };
}

function createAppearanceView(node: Dnd5eNode | null): AppearanceView | null {
  if (!node) return null;
  return {
    node,
    portrait: () => textOf(node, "portrait"),
    age: () => textOf(node, "age"),
    height: () => textOf(node, "height"),
    weight: () => textOf(node, "weight"),
    eyes: () => textOf(node, "eyes"),
    skin: () => textOf(node, "skin"),
    hair: () => textOf(node, "hair"),
  };
}

function createAbilitiesView(node: Dnd5eNode | null): AbilitiesView | null {
  if (!node) return null;
  return {
    node,
    availablePoints: () => getAttr(node, "available-points"),
    scores: () => {
      const scores = {} as Record<Ability, string | null>;
      for (const ability of ABILITIES) scores[ability] = textOf(node, ability);
      return scores;
    },
  };
}

function createElementsView(node: Dnd5eNode | null): ElementsView | null {
  if (!node) return null;
  return {
    node,
    levelCount: () => {
      const v = getAttr(node, "level-count");
      return v === null ? null : Number.parseInt(v, 10);
    },
    registeredCount: () => {
      const v = getAttr(node, "registered-count");
      return v === null ? null : Number.parseInt(v, 10);
    },
    elements: () => childElements(node, "element"),
  };
}

function createDefensesView(node: Dnd5eNode | null): DefensesView | null {
  if (!node) return null;
  return {
    node,
    conditional: () => child(node, "conditional"),
  };
}

function createCompanionView(node: Dnd5eNode | null): CompanionView | null {
  if (!node) return null;
  return {
    node,
    name: () => getAttr(node, "name"),
    attributeScores: () => {
      const attributes = child(node, "attributes");
      const scores = {} as Record<Ability, string | null>;
      for (const ability of ABILITIES) scores[ability] = attributes ? textOf(attributes, ability) : null;
      return scores;
    },
    saves: () => {
      const saves = child(node, "saves");
      if (!saves) return [];
      return childElements(saves, "save").map((save) => ({
        ability: getAttr(save, "ability"),
        value: textContent(save),
      }));
    },
    skills: () => {
      const skills = child(node, "skills");
      if (!skills) return [];
      return childElements(skills, "skill").map((skill) => ({
        name: getAttr(skill, "name"),
        value: textContent(skill),
      }));
    },
    portraitLocation: () => {
      const portrait = child(node, "portrait");
      return portrait ? getAttr(portrait, "location") : null;
    },
  };
}

function createEquipmentView(node: Dnd5eNode | null): EquipmentView | null {
  if (!node) return null;
  return {
    node,
    storage: () => childElements(node, "storage"),
    items: () =>
      childElements(node, "item").map((item) => ({
        node: item,
        identifier: () => getAttr(item, "identifier"),
        name: () => getAttr(item, "name"),
        id: () => getAttr(item, "id"),
        card: () => {
          const details = child(item, "details");
          return details ? getAttr(details, "card") : null;
        },
        sidebar: () => getAttr(item, "sidebar"),
        equipped: () => {
          const equipped = child(item, "equipped");
          if (!equipped) return null;
          return { location: getAttr(equipped, "location"), value: textContent(equipped) };
        },
        storage: () => {
          const storage = child(item, "storage");
          if (!storage) return null;
          const location = child(storage, "location");
          if (!location) return null;
          const text = textContent(location);
          return text === "" ? null : text;
        },
        attuned: () => {
          const attunement = child(item, "attunement");
          return attunement !== null && textContent(attunement) === "true";
        },
        adorners: () => {
          const items = child(item, "items");
          return items ? childElements(items, "adorner") : [];
        },
        details: () => {
          const details = child(item, "details");
          if (!details) return null;
          return {
            node: details,
            card: () => getAttr(details, "card"),
            name: () => textOf(details, "name"),
            notes: () => textOf(details, "notes"),
          };
        },
      })),
  };
}

function createSumView(node: Dnd5eNode | null): SumView | null {
  if (!node) return null;
  return {
    node,
    elementCount: () => {
      const v = getAttr(node, "element-count");
      return v === null ? null : Number.parseInt(v, 10);
    },
    elements: () =>
      childElements(node, "element").map((element) => ({
        node: element,
        type: getAttr(element, "type"),
        id: getAttr(element, "id"),
      })),
  };
}

function createSpellcastingViews(magic: Dnd5eNode | null): SpellcastingView[] {
  if (!magic) return [];
  return childElements(magic, "spellcasting").map((casting) => ({
    node: casting,
    name: () => getAttr(casting, "name"),
    ability: () => getAttr(casting, "ability"),
    attack: () => getAttr(casting, "attack"),
    dc: () => getAttr(casting, "dc"),
    source: () => getAttr(casting, "source"),
    slots: () => {
      const slots = child(casting, "slots");
      return slots ? attrRecord(slots) : {};
    },
    cantrips: () => {
      const cantrips = child(casting, "cantrips");
      return cantrips ? childElements(cantrips, "spell") : [];
    },
    spells: () => {
      const spells = child(casting, "spells");
      if (!spells) return [];
      return childElements(spells, "spell").map((spell) => ({
        node: spell,
        name: getAttr(spell, "name"),
        level: getAttr(spell, "level"),
        id: getAttr(spell, "id"),
        prepared: getAttr(spell, "prepared"),
        alwaysPrepared: getAttr(spell, "always-prepared"),
        known: getAttr(spell, "known"),
      }));
    },
  }));
}

function createBuildView(node: Dnd5eNode | null): BuildView {
  const magic = node ? child(node, "magic") : null;
  return {
    node,
    input: createInputView(node ? child(node, "input") : null),
    appearance: createAppearanceView(node ? child(node, "appearance") : null),
    abilities: createAbilitiesView(node ? child(node, "abilities") : null),
    elements: createElementsView(node ? child(node, "elements") : null),
    defenses: createDefensesView(node ? child(node, "defenses") : null),
    companion: createCompanionView(node ? child(node, "companion") : null),
    equipment: createEquipmentView(node ? child(node, "equipment") : null),
    sum: createSumView(node ? child(node, "sum") : null),
    magic,
    spellcasting: createSpellcastingViews(magic),
  };
}

function createSourcesView(node: Dnd5eNode | null): SourcesView {
  return {
    node,
    restricted: () => {
      const restricted = node ? child(node, "restricted") : null;
      if (!restricted) return null;
      return {
        node: restricted,
        sources: () =>
          childElements(restricted, "source").map((source) => ({
            id: getAttr(source, "id"),
            name: textContent(source),
            node: source,
          })),
        elements: () => childElements(restricted, "element"),
      };
    },
  };
}

function createCharacterRoot(node: Dnd5eNode): CharacterRoot {
  const rulesetNode = child(node, "ruleset");
  return {
    node,
    version: getAttr(node, "version"),
    preview: getAttr(node, "preview"),
    information: createInformationView(child(node, "information")),
    displayProperties: createDisplayPropertiesView(child(node, "display-properties")),
    build: createBuildView(child(node, "build")),
    sources: createSourcesView(child(node, "sources")),
    rulesetMode: () => (rulesetNode ? getAttr(rulesetNode, "mode") : null),
  };
}

export function parseDnd5e(source: string): Dnd5eDocument {
  let pos = 0;
  if (source.charCodeAt(0) === 0xfeff) pos = 1;
  for (;;) {
    if (source.startsWith("<?", pos)) {
      pos = skipPi(source, pos);
      continue;
    }
    const code = source.charCodeAt(pos);
    if (Number.isNaN(code) || isWs(code)) {
      pos++;
      continue;
    }
    break;
  }
  if (!source.startsWith("<", pos)) throw new Error("no root element found");
  const rootNode = parseElement(source, pos);
  const root = createCharacterRoot(rootNode);
  return {
    raw: source,
    root,
    serialize: () => source,
  };
}
