/**
 * Pack health: the problems in a pack's content file, found by reading the file
 * against the loaded library without loading it. The editor shows each one with
 * the element that carries it and the fix that suits it, and the same checks
 * (for the kinds the library can see on its own) run when a file is ingested.
 *
 * - missing-grant: a grant, default or option that resolves to nothing;
 * - duplicate-id: an id defined twice in the pack, or already defined by another
 *   loaded file the pack was not meant to replace;
 * - unattachable: a Background Feature no Background grants or offers;
 * - append-target: an `<append>` whose target is not loaded;
 * - invalid-requirements: requirements the engine cannot read;
 * - overrides: a loaded element the pack replaces on purpose (not a fault).
 */

import type { PackFindingDto } from "@forge-cb/api";
import { isCharacterPackElement } from "./character-packs.js";
import type { ContentDiagnostic, ElementLibrary } from "./library.js";
import { missingGrantDiagnostics } from "./missing-grants.js";
import { parseAppendsFile, parseElementsFile, type ParsedElement } from "./parser.js";
import { requirementsSyntaxError } from "../selection/expr.js";
import { matchesSupports } from "../selection/selection.js";

export interface PackCheckRequest {
  path: string;
  xml: string;
  overrides?: readonly string[];
}

function eachElement(elements: readonly ParsedElement[], visit: (element: ParsedElement) => void): void {
  for (const element of elements) {
    visit(element);
    eachElement(element.children, visit);
  }
}

/** Every rule of an element, whatever kind, for the places a requirement can be written. */
function requirementTexts(element: ParsedElement): string[] {
  const texts: string[] = [];
  if (element.requirements !== undefined) texts.push(element.requirements);
  for (const rule of element.rules) {
    const text = (rule as { requirements?: string }).requirements;
    if (text !== undefined) texts.push(text);
  }
  return texts;
}

function describe(element: ParsedElement): string {
  return `${element.identity.name} (${element.identity.id})`;
}

/** Whether a Background Feature is reachable from a Background: granted by id, or offered by a select. */
function backgroundFeatureAttached(feature: ParsedElement, holders: readonly ParsedElement[]): boolean {
  const id = feature.identity.id;
  for (const holder of holders) {
    for (const rule of holder.rules) {
      if (rule.kind === "grant" && rule.id === id) return true;
      if (rule.kind === "select" && rule.type === "Background Feature") {
        if (rule.id === id) return true;
        if (rule.supports !== undefined && matchesSupports(rule.supports, feature)) return true;
      }
    }
  }
  return false;
}

/** The elements that can attach a Background Feature: backgrounds, their variants and other features. */
const FEATURE_HOLDER_TYPES = ["Background", "Background Variant", "Background Feature", "Feat", "Racial Trait", "Class Feature"];

function backgroundFeatureHolders(library: ElementLibrary, extra: readonly ParsedElement[], exclude: string | undefined): ParsedElement[] {
  const holders: ParsedElement[] = [...extra];
  for (const type of FEATURE_HOLDER_TYPES) {
    for (const element of library.byType.get(type) ?? []) {
      if (element.declaredBy !== exclude) holders.push(element);
    }
  }
  return holders;
}

function fromDiagnostic(diagnostic: ContentDiagnostic): PackFindingDto {
  return {
    kind: "missing-grant",
    message: diagnostic.message,
    ...(diagnostic.elementId === undefined ? {} : { elementId: diagnostic.elementId }),
    ...(diagnostic.elementName === undefined ? {} : { elementName: diagnostic.elementName }),
    ...(diagnostic.missingId === undefined ? {} : { missingId: diagnostic.missingId }),
    ...(diagnostic.missingType === undefined ? {} : { missingType: diagnostic.missingType }),
  };
}

/** The findings for a pack's file, in the order a reader meets them. */
export function checkContentFile(library: ElementLibrary, request: PackCheckRequest): PackFindingDto[] {
  const { path } = request;
  const overrides = new Set(request.overrides ?? []);
  const elements = parseElementsFile(request.xml, path).filter((element) => element.identity.id !== "");
  const appends = parseAppendsFile(request.xml, path);
  const findings: PackFindingDto[] = [];

  // Ids defined twice in the file, and ids another loaded file already defines.
  const counts = new Map<string, number>();
  for (const element of elements) counts.set(element.identity.id, (counts.get(element.identity.id) ?? 0) + 1);
  const reportedDuplicates = new Set<string>();
  for (const element of elements) {
    const id = element.identity.id;
    if ((counts.get(id) ?? 0) > 1 && !reportedDuplicates.has(id)) {
      reportedDuplicates.add(id);
      findings.push({
        kind: "duplicate-id",
        elementId: id,
        elementName: element.identity.name,
        message: `${describe(element)} is defined twice in this pack; the later definition wins`,
      });
    }
    const loaded = library.byId.get(id);
    if (loaded === undefined || loaded.declaredBy === path || isCharacterPackElement(library, id)) continue;
    if (overrides.has(id)) {
      findings.push({
        kind: "overrides",
        elementId: id,
        elementName: element.identity.name,
        otherFile: loaded.declaredBy,
        message: `${describe(element)} replaces the loaded definition from ${loaded.declaredBy}`,
      });
    } else {
      findings.push({
        kind: "duplicate-id",
        elementId: id,
        elementName: element.identity.name,
        otherFile: loaded.declaredBy,
        message: `${describe(element)} is already defined by ${loaded.declaredBy}; the later definition wins`,
      });
    }
  }

  // Grants, defaults and options that resolve to nothing, in elements and in appends.
  const appendHosts: ParsedElement[] = appends.map((append) => {
    const target = library.byId.get(append.id) ?? elements.find((element) => element.identity.id === append.id);
    return {
      identity: { id: append.id, name: target?.identity.name ?? append.id, type: target?.identity.type ?? "", source: "" },
      setters: [],
      rules: append.rules,
      supports: [],
      compendiumHidden: false,
      sheets: [],
      children: [],
      declaredBy: path,
    };
  });
  for (const diagnostic of missingGrantDiagnostics(library, [...elements, ...appendHosts], { extra: elements, excludeFile: path })) {
    findings.push(fromDiagnostic(diagnostic));
  }

  // Appends to elements nothing defines.
  const packIds = new Set<string>();
  eachElement(elements, (element) => packIds.add(element.identity.id));
  const reportedAppends = new Set<string>();
  for (const append of appends) {
    const loaded = library.byId.get(append.id);
    const present = packIds.has(append.id) || (loaded !== undefined && loaded.declaredBy !== path);
    if (present || reportedAppends.has(append.id)) continue;
    reportedAppends.add(append.id);
    findings.push({
      kind: "append-target",
      targetId: append.id,
      message: `this pack adds to ${append.id}, which no loaded content defines; its rules are skipped`,
    });
  }

  // Background Features nothing can attach.
  const features = elements.filter((element) => element.identity.type === "Background Feature");
  if (features.length > 0) {
    const holders = backgroundFeatureHolders(library, elements, path);
    for (const feature of features) {
      if (backgroundFeatureAttached(feature, holders)) continue;
      findings.push({
        kind: "unattachable",
        elementId: feature.identity.id,
        elementName: feature.identity.name,
        message: `${describe(feature)} is a Background Feature no Background grants, so it cannot be added to anyone`,
      });
    }
  }

  // Requirements the engine cannot read.
  eachElement(elements, (element) => {
    for (const text of requirementTexts(element)) {
      const problem = requirementsSyntaxError(text);
      if (problem === null) continue;
      findings.push({
        kind: "invalid-requirements",
        elementId: element.identity.id,
        elementName: element.identity.name,
        message: `${describe(element)} has requirements the builder cannot read (${problem}): ${text.trim()}`,
      });
    }
  });
  return findings;
}

/**
 * The ingest-time form of the checks a library can make on its own, for the
 * files a user uploaded: Background Features nothing attaches and requirements
 * the engine cannot read. Bundled content is not examined.
 */
export function packReferenceDiagnostics(library: ElementLibrary): ContentDiagnostic[] {
  const out: ContentDiagnostic[] = [];
  const uploaded = [...library.byId.values()].filter((element) => element.declaredBy.startsWith("imports/"));
  const features = uploaded.filter((element) => element.identity.type === "Background Feature");
  if (features.length > 0) {
    const holders = backgroundFeatureHolders(library, [], undefined);
    for (const feature of features) {
      if (backgroundFeatureAttached(feature, holders)) continue;
      out.push({
        kind: "unattachable",
        file: feature.declaredBy,
        message: `${describe(feature)} is a Background Feature with no Background that grants it`,
        detail: "it cannot be added to anyone; add it as a custom feature instead",
        elementId: feature.identity.id,
        elementName: feature.identity.name,
      });
    }
  }
  eachElement(uploaded, (element) => {
    for (const text of requirementTexts(element)) {
      const problem = requirementsSyntaxError(text);
      if (problem === null) continue;
      out.push({
        kind: "invalid-requirements",
        file: element.declaredBy.split("#")[0] ?? element.declaredBy,
        message: `${describe(element)} has requirements the builder cannot read: ${text.trim()}`,
        detail: problem,
        elementId: element.identity.id,
        elementName: element.identity.name,
      });
    }
  });
  return out;
}
