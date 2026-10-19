/**
 * A character's own custom content: the operations behind the custom-content
 * RPCs, written against a small host interface so `CharacterService` stays the
 * only owner of character state.
 *
 * The drafts live in the character's document (`pack.ts`); the compiled
 * elements live in the library for as long as the character is loaded
 * (`content/character-packs.ts`). Every operation keeps the two in step, and
 * installs the element before anything registers it, so the ids a grant or a
 * pick names always resolve.
 */

import type {
  ChoiceIdentityReportDto,
  CustomContentDto,
  CustomDiagnosticDto,
  CustomDraft,
  CustomDraftEntryDto,
  PromotedCustomElementDto,
} from "@forge-cb/api";
import {
  characterPackElements,
  characterPackOwners,
  installCharacterPack,
  removeCharacterPack,
  type CharacterPackReport,
} from "../content/character-packs.js";
import type { ElementLibrary } from "../content/library.js";
import { missingGrantDiagnostics } from "../content/missing-grants.js";
import type { CharacterState, RegisteredElement } from "../character/state.js";
import type { Dnd5eDocument } from "../dnd5e/document.js";
import { engineError } from "../errors.js";
import { pendingSelectionRules, type RawEdit } from "../selection/selection.js";
import { elementTypeFor } from "./catalogue.js";
import { compileCustomElement, compileCustomPack } from "./compile.js";
import { diffChoiceIdentity } from "./identity.js";
import { buildSectionOfType } from "./placement.js";
import { entriesWithDraft, entriesWithoutDraft, planCustomPackEdits, readCustomPack } from "./pack.js";
import { promoteCustomDraft } from "./promote.js";
import { readCustomDraft } from "./validate.js";

/** What the content operations need from the character service. */
export interface CustomContentHost {
  readonly library: ElementLibrary | undefined;
  snapshot(id: string): { state: CharacterState; document: Dnd5eDocument };
  characterIds(): string[];
  loadedState(id: string): CharacterState | undefined;
  applyRegionEdits(id: string, edits: RawEdit[]): CharacterState;
  addGrantedElement(id: string, request: { elementId: string }): CharacterState;
  removeGrantedElement(id: string, request: { elementId: string }): CharacterState;
  setSelection(id: string, ruleIdentifier: string, selectionId: string): CharacterState;
}

export interface SaveResult {
  entry: CustomDraftEntryDto;
  diagnostics: CustomDiagnosticDto[];
}

/** The tree node at a path, or undefined. */
function nodeAt(nodes: readonly RegisteredElement[], path: readonly number[]): RegisteredElement | undefined {
  let list = nodes;
  let node: RegisteredElement | undefined;
  for (const index of path) {
    node = list[index];
    if (node === undefined) return undefined;
    list = node.children;
  }
  return node;
}

/** Every node registering `ownerId`, at any depth. */
function ownerNodes(nodes: readonly RegisteredElement[], ownerId: string, into: RegisteredElement[] = []): RegisteredElement[] {
  for (const node of nodes) {
    if (node.id === ownerId) into.push(node);
    ownerNodes(node.children, ownerId, into);
  }
  return into;
}

/** The choice wrappers directly under a registered element. */
function choiceWrappers(owner: RegisteredElement): RegisteredElement[] {
  return owner.children.filter((node) => node.requiredLevel !== undefined && node.id === "");
}

const isTopLevelGranted = (state: CharacterState, elementId: string): boolean =>
  state.elements.some((node) => node.id === elementId);

export class CharacterCustomContent {
  constructor(private readonly host: CustomContentHost) {}

  private requireLibrary(): ElementLibrary {
    if (this.host.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for custom content");
    }
    return this.host.library;
  }

  /**
   * Installs the character's pack from its document, or clears it when the
   * document carries none. Entries the compiler refuses are left out and
   * reported, never allowed to take the others down with them.
   */
  syncPack(id: string, document: Dnd5eDocument): { report: CharacterPackReport | undefined; failures: CustomDiagnosticDto[] } {
    const library = this.host.library;
    if (library === undefined) return { report: undefined, failures: [] };
    const read = readCustomPack(document);
    const failures: CustomDiagnosticDto[] = read.problems.map((problem) => ({ kind: "unreadable", message: problem.message }));
    const installable: CustomDraft[] = [];
    for (const draft of read.drafts) {
      try {
        compileCustomElement(draft);
        installable.push(draft);
      } catch (cause) {
        failures.push({ kind: "unreadable", elementId: draft.id, message: (cause as { message?: string }).message ?? "cannot compile" });
      }
    }
    if (installable.length === 0) {
      removeCharacterPack(library, id);
      return { report: undefined, failures };
    }
    return { report: installCharacterPack(library, { characterId: id, xml: compileCustomPack(installable) }), failures };
  }

  /** Takes a character's pack out of the library. */
  forget(id: string): void {
    if (this.host.library !== undefined) removeCharacterPack(this.host.library, id);
  }

  private entryFor(characterId: string, state: CharacterState, draft: CustomDraft): CustomDraftEntryDto {
    const type = elementTypeFor(draft.showsUnder);
    return {
      draft,
      elementId: draft.id,
      type,
      section: buildSectionOfType(type),
      granted: isTopLevelGranted(state, draft.id),
      installed:
        this.host.library === undefined ? false : characterPackOwners(this.host.library, draft.id)?.has(characterId) === true,
    };
  }

  list(id: string): CustomContentDto {
    this.requireLibrary();
    const { state, document } = this.host.snapshot(id);
    const read = readCustomPack(document);
    return {
      entries: read.drafts.map((draft) => this.entryFor(id, state, draft)),
      problems: read.problems.filter((problem) => problem.index >= 0),
    };
  }

  private diagnosticsFor(id: string, draftId: string, report: CharacterPackReport | undefined): CustomDiagnosticDto[] {
    const library = this.requireLibrary();
    const out: CustomDiagnosticDto[] = [];
    for (const skipped of report?.skipped ?? []) {
      if (skipped.id === draftId) out.push({ kind: "skipped", elementId: skipped.id, message: skipped.reason });
    }
    for (const finding of missingGrantDiagnostics(library, characterPackElements(library, id))) {
      if (finding.elementId !== draftId) continue;
      out.push({
        kind: "missing-grant",
        message: finding.message,
        ...(finding.elementId === undefined ? {} : { elementId: finding.elementId }),
        ...(finding.missingId === undefined ? {} : { missingId: finding.missingId }),
      });
    }
    return out;
  }

  /**
   * Creates or updates a draft. A new draft is granted (unless told not to). An
   * updated draft that is granted is taken off and put back on with its new
   * definition, and the picks whose choice identity is unchanged are made
   * again, so editing a description or a bonus never costs a player a choice.
   */
  save(id: string, request: { draft: unknown; grant?: boolean }): SaveResult {
    this.requireLibrary();
    const draft = readCustomDraft(request.draft);
    compileCustomElement(draft);
    const first = this.host.snapshot(id);
    const read = readCustomPack(first.document);
    const existing = read.drafts.find((candidate) => candidate.id === draft.id);
    const wasGranted = isTopLevelGranted(first.state, draft.id);
    const picks = new Map<string, string>();
    if (existing !== undefined && wasGranted) {
      for (const owner of ownerNodes(first.state.elements, draft.id)) {
        for (const wrapper of choiceWrappers(owner)) {
          if ((wrapper.checksum ?? "") !== "" && (wrapper.registered ?? "") !== "") picks.set(wrapper.checksum!, wrapper.registered!);
        }
      }
      // The old definition is still installed, so its registration comes off cleanly.
      this.host.removeGrantedElement(id, { elementId: draft.id });
    }
    const current = this.host.snapshot(id);
    this.host.applyRegionEdits(id, planCustomPackEdits(current.document, entriesWithDraft(read, draft)));
    const { report } = this.syncPack(id, this.host.snapshot(id).document);
    const grantNow = existing === undefined ? request.grant !== false : wasGranted;
    if (grantNow) {
      this.host.addGrantedElement(id, { elementId: draft.id });
      if (picks.size > 0) this.restorePicks(id, draft.id, picks);
    }
    const state = this.host.snapshot(id).state;
    return { entry: this.entryFor(id, state, draft), diagnostics: this.diagnosticsFor(id, draft.id, report) };
  }

  /** Makes the picks again that still belong to a choice of the re-registered element. */
  private restorePicks(id: string, ownerId: string, picks: ReadonlyMap<string, string>): void {
    const tried = new Set<string>();
    for (let guard = 0; guard < 100; guard++) {
      const state = this.host.snapshot(id).state;
      const rule = pendingSelectionRules(state).find((candidate) => {
        const wrapper = nodeAt(state.elements, candidate.path);
        const owner = nodeAt(state.elements, candidate.path.slice(0, -1));
        const checksum = wrapper?.checksum ?? "";
        return owner?.id === ownerId && checksum !== "" && picks.has(checksum) && !tried.has(checksum);
      });
      if (rule === undefined) return;
      const checksum = nodeAt(state.elements, rule.path)!.checksum!;
      tried.add(checksum);
      try {
        this.host.setSelection(id, rule.identifier, picks.get(checksum)!);
      } catch {
        // The pick no longer fits (the choice's filter changed); the player picks again.
      }
    }
  }

  /** Takes a draft off the character: ungrants it, drops its stored copy, uninstalls it. */
  remove(id: string, request: { draftId: string }): void {
    this.requireLibrary();
    const { state, document } = this.host.snapshot(id);
    const read = readCustomPack(document);
    if (!read.entries.some((entry) => (entry as { id?: unknown } | null)?.id === request.draftId)) {
      throw engineError("not-found", `custom content '${request.draftId}' not found`);
    }
    if (isTopLevelGranted(state, request.draftId)) {
      this.host.removeGrantedElement(id, { elementId: request.draftId });
    }
    const current = this.host.snapshot(id);
    this.host.applyRegionEdits(id, planCustomPackEdits(current.document, entriesWithoutDraft(read, request.draftId)));
    this.syncPack(id, this.host.snapshot(id).document);
  }

  promote(id: string, request: { draftId: string; source: string }): PromotedCustomElementDto {
    const source = request.source.trim();
    if (source === "") throw engineError("invalid-argument", "name the collection the element is promoted into");
    const { document } = this.host.snapshot(id);
    const draft = readCustomPack(document).drafts.find((candidate) => candidate.id === request.draftId);
    if (draft === undefined) throw engineError("not-found", `custom content '${request.draftId}' not found`);
    return promoteCustomDraft(draft, source);
  }

  /** Which choices of the proposed draft change identity, and which loaded characters have picks under them. */
  impact(id: string, request: { draft: unknown }): ChoiceIdentityReportDto {
    const proposed = readCustomDraft(request.draft);
    const { document } = this.host.snapshot(id);
    const stored = readCustomPack(document).drafts.find((candidate) => candidate.id === proposed.id);
    if (stored === undefined) return { changes: [], hasPicks: false };
    const library = this.host.library;
    const changes = diffChoiceIdentity(stored, proposed).map((change) => {
      const picks: ChoiceIdentityReportDto["changes"][number]["picks"] = [];
      for (const characterId of this.host.characterIds()) {
        const state = this.host.loadedState(characterId);
        if (state === undefined) continue;
        for (const owner of ownerNodes(state.elements, stored.id)) {
          for (const wrapper of choiceWrappers(owner)) {
            const slot = change.orphanedChecksums.indexOf(wrapper.checksum ?? "");
            if (slot < 0 || (wrapper.registered ?? "") === "") continue;
            const elementId = wrapper.registered!;
            picks.push({
              characterId,
              slot: change.orphanedSlots[slot]!,
              elementId,
              elementName: wrapper.listText ?? library?.byId.get(elementId)?.identity.name ?? elementId,
            });
          }
        }
      }
      const { orphanedChecksums: _checksums, ...rest } = change;
      return { ...rest, picks };
    });
    return { changes, hasPicks: changes.some((change) => change.picks.length > 0) };
  }
}
