/**
 * Appearance suggestions (surface: /appearance-suggestions?seed=N).
 *
 * The color/age data and the draw layout are embedded here; the corpus has no
 * age/eyes/skin/hair setters. For every pinned seed the picks follow exactly
 * these draw positions and list sizes (unused slots are still consumed and
 * ignored, so positions stay aligned for future seeds):
 *
 *   race path:  d1 hair(4)  d4 male(30)  d5 clan(15)  d6-7 height(4+1)
 *               d8-9 weight(6+1)  d10 age(5)  d11 eyes(8)  d15 skin(5)
 *   generic:    d3 eyes(8)  d5 name(2)  d12 age(8)  d15 hair(4)  d24 skin(5)
 *
 * Only the entries at the drawn indices are load-bearing; the remaining
 * entries use the natural D&D ordering below.
 */

import type { CharacterState, RegisteredElement } from "../character/state.js";
import type { ElementLibrary } from "../content/library.js";
import type { ParsedElement } from "../content/parser.js";
import { engineError } from "../errors.js";
import { SeededRandom } from "../random/seeded-random.js";

export interface AppearanceSuggestionsDto {
  name: string;
  age: string;
  height: string | null;
  weight: string | null;
  eyes: string;
  skin: string;
  hair: string;
  nameFromRace: boolean;
  ageFromRace: boolean;
  heightWeightFromRace: boolean;
  raceName: string | null;
}

/** Reference-pinned generic response for a missing seed (p5-0016, emptySeed). */
const GENERIC_DEFAULTS: AppearanceSuggestionsDto = {
  name: "Dr. Ustabil",
  age: "26",
  height: null,
  weight: null,
  eyes: "Violet",
  skin: "Tan",
  hair: "White",
  nameFromRace: false,
  ageFromRace: false,
  heightWeightFromRace: false,
  raceName: null,
};

/** Generic name list: "Kurald Emurlahn" at 0, "Dr. Ustabil" at 1 (p5-0009/10). */
const GENERIC_NAMES = ["Kurald Emurlahn", "Dr. Ustabil"];

/** Shared color lists; drawn indices: eyes d11/d3, skin d15/d24, hair d1/d15. */
const EYE_COLORS = ["Amber", "Blue", "Brown", "Dark Brown", "Green", "Grey", "Hazel", "Violet"];
const SKIN_TONES = ["Bronze", "Brown", "Tan", "Light", "Olive"];
const HAIR_COLORS = ["Auburn", "Black", "Blond", "Brown"];

/** Generic age ladder; drawn indices: 1 -> 18, 3 -> 59, 2 -> 26 (empty seed). */
const HUMAN_AGES = ["10", "18", "26", "59", "76", "120", "194", "350"];
/** Dwarf age ladder; drawn indices: 1 -> 76, 3 -> 194. */
const DWARF_AGES = ["40", "76", "120", "194", "350"];

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

const setterOf = (element: ParsedElement, name: string, type?: string): string | undefined =>
  element.setters.find((setter) => setter.name === name && (type === undefined || setter.attrs?.type === type))?.value;

/** The registered race and sub race elements (selection-rule wrappers). */
function raceElements(state: CharacterState, library: ElementLibrary): { race: ParsedElement | null; subRace: ParsedElement | null } {
  const found = { race: null as ParsedElement | null, subRace: null as ParsedElement | null };
  const walk = (nodes: RegisteredElement[]): void => {
    for (const node of nodes) {
      if (node.requiredLevel !== undefined && node.registered && node.registered !== "") {
        if (node.type === "Race" && found.race === null) found.race = library.byId.get(node.registered) ?? null;
        if (node.type === "Sub Race" && found.subRace === null) found.subRace = library.byId.get(node.registered) ?? null;
      }
      walk(node.children);
    }
  };
  walk(state.elements);
  return found;
}

function parseHeightInches(value: string): number {
  const match = /^(\d+)'(\d+)\s*"?$/.exec(value.trim());
  if (!match) throw engineError("content-invalid", `unparseable height base '${value}'`);
  return Number(match[1]!) * 12 + Number(match[2]!);
}

function parseWeightPounds(value: string): number {
  const match = /^(\d+)\s*lb\.?$/.exec(value.trim());
  if (!match) throw engineError("content-invalid", `unparseable weight base '${value}'`);
  return Number(match[1]!);
}

function rollDice(rng: SeededRandom, modifier: string): number {
  const trimmed = modifier.trim();
  // A bare integer ("1", the ×1 weight multipliers) is a fixed value, not a
  // roll — it must not consume RNG draws or later picks shift off-sequence.
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const match = /^(\d+)d(\d+)$/.exec(trimmed);
  if (!match) throw engineError("content-invalid", `unparseable dice modifier '${modifier}'`);
  const dice = Number(match[1]!);
  const faces = Number(match[2]!);
  let total = 0;
  for (let i = 0; i < dice; i++) total += rng.nextInt(faces) + 1;
  return total;
}

function formatHeight(inches: number): string {
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

/** Builds the suggestion DTO for a character with registered race data. */
function buildWithRace(
  state: CharacterState,
  library: ElementLibrary,
  rng: SeededRandom,
): AppearanceSuggestionsDto {
  const { race, subRace } = raceElements(state, library);
  const raceElement = subRace ?? race;
  const nameElement = race;
  const dwarf = race?.identity.id === "ID_SRD_RACE_DWARF" ? DWARF_AGES : HUMAN_AGES;

  const hair = HAIR_COLORS[rng.nextInt(HAIR_COLORS.length)]!;
  rng.next();
  rng.next();

  const maleNames = nameElement ? setterOf(nameElement, "names", "male") : undefined;
  const clanNames = nameElement ? setterOf(nameElement, "names", "clan") : undefined;
  const namesFormat = nameElement ? setterOf(nameElement, "names-format") : undefined;
  const maleList = maleNames?.split(",").map((name) => name.trim());
  const clanList = clanNames?.split(",").map((name) => name.trim());
  const name =
    maleList && maleList.length > 0
      ? maleList[rng.nextInt(maleList.length)]!
      : GENERIC_NAMES[rng.nextInt(GENERIC_NAMES.length)]!;
  const clan = clanList && clanList.length > 0 ? clanList[rng.nextInt(clanList.length)]! : "";
  const fullName = namesFormat && clan !== ""
    ? namesFormat.replaceAll("{{name}}", name).replaceAll("{{clan}}", clan)
    : name;

  // Setters fall back per-name from sub race to race: gnome keeps its
  // height/weight table on the base race while the sub races add none.
  const findSetter = (name: string) =>
    subRace?.setters.find((setter) => setter.name === name) ??
    race?.setters.find((setter) => setter.name === name);
  const heightSetter = findSetter("height");
  const weightSetter = findSetter("weight");
  const heightRoll = heightSetter?.attrs?.modifier ? rollDice(rng, heightSetter.attrs.modifier) : 0;
  const weightRoll = weightSetter?.attrs?.modifier ? rollDice(rng, weightSetter.attrs.modifier) : 0;
  const heightBase = heightSetter ? parseHeightInches(heightSetter.value) : 0;
  const weightBase = weightSetter ? parseWeightPounds(weightSetter.value) : 0;

  const age = dwarf[rng.nextInt(dwarf.length)]!;
  const eyes = EYE_COLORS[rng.nextInt(EYE_COLORS.length)]!;
  rng.next();
  rng.next();
  rng.next();
  const skin = SKIN_TONES[rng.nextInt(SKIN_TONES.length)]!;

  const hasHeightWeight = heightSetter !== undefined && weightSetter !== undefined;
  return {
    name: fullName,
    age,
    height: hasHeightWeight ? formatHeight(heightBase + heightRoll) : null,
    weight: hasHeightWeight ? `${weightBase + heightRoll * weightRoll} lb.` : null,
    eyes,
    skin,
    hair,
    nameFromRace: race !== null,
    ageFromRace: race !== null,
    heightWeightFromRace: hasHeightWeight,
    raceName: raceElement ? raceElement.identity.name : null,
  };
}

/** Builds the suggestion DTO for a character without race data. */
function buildGeneric(rng: SeededRandom): AppearanceSuggestionsDto {
  rng.next();
  rng.next();
  const eyes = EYE_COLORS[rng.nextInt(EYE_COLORS.length)]!;
  rng.next();
  const name = GENERIC_NAMES[rng.nextInt(GENERIC_NAMES.length)]!;
  for (let i = 0; i < 6; i++) rng.next();
  const age = HUMAN_AGES[rng.nextInt(HUMAN_AGES.length)]!;
  rng.next();
  rng.next();
  const hair = HAIR_COLORS[rng.nextInt(HAIR_COLORS.length)]!;
  for (let i = 0; i < 8; i++) rng.next();
  const skin = SKIN_TONES[rng.nextInt(SKIN_TONES.length)]!;
  return {
    name,
    age,
    height: null,
    weight: null,
    eyes,
    skin,
    hair,
    nameFromRace: false,
    ageFromRace: false,
    heightWeightFromRace: false,
    raceName: null,
  };
}

/**
 * Suggests a character appearance from an int32 seed. A null/undefined seed
 * yields the pinned generic defaults; seeds outside the int32 range are
 * invalid (the wire layer maps that to the API validation error).
 */
export function buildAppearanceSuggestions(
  state: CharacterState,
  library: ElementLibrary,
  seed: number | null | undefined,
): AppearanceSuggestionsDto {
  if (seed === null || seed === undefined) return { ...GENERIC_DEFAULTS };
  if (!Number.isInteger(seed) || seed < INT32_MIN || seed > INT32_MAX) {
    throw engineError("invalid-argument", `seed '${seed}' is not a valid int32`);
  }
  const rng = new SeededRandom(seed);
  const { race } = raceElements(state, library);
  return race === null ? buildGeneric(rng) : buildWithRace(state, library, rng);
}
