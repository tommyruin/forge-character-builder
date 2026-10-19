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
  CustomDraftEntryDto,
  CustomEntryDraft,
  CustomItemDraft,
  CustomSpellDraft,
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
import { isCustomItemDraft, isCustomSpellDraft } from "./schema.js";
import { readCustomEntry } from "./validate.js";
import type { AddItemOptions, ItemDetails } from "../inventory/inventory.js";

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
  addItem(id: string, options: AddItemOptions): unknown;
  removeItem(id: string, identifier: string, amount?: number): unknown;
  setItemDetails(id: string, identifier: string, details: ItemDetails): unknown;
  /**
   * Brings the records of an edited custom item up to date: their stored names,
   * the registrations the old definition left behind, and attack rows that
   * still carry the old generated name.
   */
  refreshItemRecords(id: string, elementId: string, previousName: string): void;
  addGrantedSpell(id: string, request: { spellId: string; caster?: string | null }): CharacterState;
  removeGrantedSpell(id: string, request: { spellId: string }): CharacterState;
  /** Takes back every pick of the spell made through a spell selection rule. */
  clearSpellPicks(id: string, spellId: string): void;
  /** Brings the stored name and level of the spell's magic-region entries up to date. */
  refreshSpellEntries(id: string, spellId: string): void;
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

/**
 * Whether the character has the spell: granted (DM or caster) or picked through
 * a spell selection. A spell merely on a full-list caster's projected list does
 * not count, since the player has not taken it.
 */
const isSpellKnown = (state: CharacterState, spellId: string): boolean =>
  (state.magic?.additional ?? []).some((spell) => spell.id === spellId) ||
  state.sum.elements.some((entry) => entry.type === "Spell" && entry.id === spellId);

/** The inventory records built on a custom item: it is the record's element or its adorner. */
const recordsOf = (state: CharacterState, elementId: string): CharacterState["items"] =>
  state.items.filter((item) => item.itemId === elementId || item.adorners.includes(elementId));

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
    const installable: CustomEntryDraft[] = [];
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

  private entryFor(characterId: string, state: CharacterState, draft: CustomEntryDraft): CustomDraftEntryDto {
    const installed =
      this.host.library === undefined ? false : characterPackOwners(this.host.library, draft.id)?.has(characterId) === true;
    if (isCustomSpellDraft(draft)) {
      return {
        kind: "spell",
        draft,
        elementId: draft.id,
        type: "Spell",
        section: "other",
        granted: isSpellKnown(state, draft.id),
        installed,
      };
    }
    if (isCustomItemDraft(draft)) {
      return {
        kind: "item",
        draft,
        elementId: draft.id,
        type: draft.template === "gear" ? "Item" : "Magic Item",
        section: "other",
        granted: recordsOf(state, draft.id).length > 0,
        installed,
      };
    }
    const type = elementTypeFor(draft.showsUnder);
    return {
      kind: "feature",
      draft,
      elementId: draft.id,
      type,
      section: buildSectionOfType(type),
      granted: isTopLevelGranted(state, draft.id),
      installed,
    };
  }

  /**
   * Edits rebuild the block from what it holds; a block that cannot be read at
   * all (not JSON, not a list) is refused rather than overwritten, since
   * rewriting it would destroy whatever it still says.
   */
  private requireReadableBlock(read: ReturnType<typeof readCustomPack>): void {
    const broken = read.problems.find((problem) => problem.index < 0);
    if (broken !== undefined) throw engineError("conflict", `${broken.message}; it was not changed`);
  }

  list(id: string): CustomContentDto {
    this.requireLibrary();
    const { state, document } = this.host.snapshot(id);
    const read = readCustomPack(document);
    return {
      entries: read.drafts.map((draft) => this.entryFor(id, state, draft)),
      problems: read.problems,
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
  save(id: string, request: { draft: unknown; grant?: boolean; amount?: number; notes?: string; caster?: string }): SaveResult {
    this.requireLibrary();
    const draft = readCustomEntry(request.draft);
    compileCustomElement(draft);
    if (isCustomSpellDraft(draft)) return this.saveSpell(id, draft, request);
    if (isCustomItemDraft(draft)) return this.saveItem(id, draft, request);
    const first = this.host.snapshot(id);
    const read = readCustomPack(first.document);
    this.requireReadableBlock(read);
    const existing = read.drafts.find((candidate) => candidate.id === draft.id);
    if (existing !== undefined && isCustomItemDraft(existing)) {
      throw engineError("conflict", `'${draft.name}' is an item; its id cannot be reused for a feature`);
    }
    if (existing !== undefined && isCustomSpellDraft(existing)) {
      throw engineError("conflict", `'${draft.name}' is a spell; its id cannot be reused for a feature`);
    }
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
    const grantNow = wasGranted || request.grant === true || (existing === undefined && request.grant !== false);
    if (grantNow) {
      this.host.addGrantedElement(id, { elementId: draft.id });
      if (picks.size > 0) this.restorePicks(id, draft.id, picks);
    }
    const state = this.host.snapshot(id).state;
    return { entry: this.entryFor(id, state, draft), diagnostics: this.diagnosticsFor(id, draft.id, report) };
  }

  /**
   * Creates or updates a custom item. A new item is stored, installed and added
   * to the inventory through the ordinary add path (`grant: false` keeps it in
   * the pack alone). Editing one that is carried keeps its records: they are
   * brought up to date in place, so equipped and attuned state survive.
   */
  private saveItem(
    id: string,
    draft: CustomItemDraft,
    request: { grant?: boolean; amount?: number; notes?: string },
  ): SaveResult {
    const first = this.host.snapshot(id);
    const read = readCustomPack(first.document);
    this.requireReadableBlock(read);
    const existing = read.drafts.find((candidate) => candidate.id === draft.id);
    if (existing !== undefined) {
      if (!isCustomItemDraft(existing)) {
        throw engineError(
          "conflict",
          `'${draft.name}' is ${isCustomSpellDraft(existing) ? "a spell" : "a feature"}; its id cannot be reused for an item`,
        );
      }
      if (existing.template !== draft.template) {
        throw engineError("conflict", `'${existing.name}' is a ${existing.template} item; a different template needs a new item`);
      }
    }
    const carried = recordsOf(first.state, draft.id);
    if (existing !== undefined && carried.length > 0 && (existing.base?.id ?? "") !== (draft.base?.id ?? "")) {
      throw engineError(
        "conflict",
        `'${existing.name}' is carried on ${existing.base?.name ?? "its base"}; remove it from the inventory before changing its base`,
      );
    }
    const current = this.host.snapshot(id);
    this.host.applyRegionEdits(id, planCustomPackEdits(current.document, entriesWithDraft(read, draft)));
    const { report } = this.syncPack(id, this.host.snapshot(id).document);
    if (existing !== undefined && carried.length > 0) this.host.refreshItemRecords(id, draft.id, existing.name);

    const addNow = existing === undefined ? request.grant !== false : request.grant === true && carried.length === 0;
    if (addNow) {
      const before = new Set(this.host.snapshot(id).state.items.map((item) => item.identifier));
      this.host.addItem(id, {
        itemId: draft.id,
        amount: Math.max(1, Math.trunc(request.amount ?? 1)),
        baseElementId: draft.base?.id ?? null,
      });
      const created = this.host.snapshot(id).state.items.find((item) => !before.has(item.identifier));
      const notes = request.notes?.trim() ?? "";
      if (created !== undefined && notes !== "") this.host.setItemDetails(id, created.identifier, { notes });
    }
    const state = this.host.snapshot(id).state;
    return { entry: this.entryFor(id, state, draft), diagnostics: this.diagnosticsFor(id, draft.id, report) };
  }

  /**
   * Creates or updates a custom spell. A new spell is stored, installed and
   * granted to the named class caster (or gathered under "Additional Spells"
   * without one); `grant: false` keeps it in the pack alone, for a spell that
   * is only on a class list. Editing one keeps whoever knows it knowing it: the
   * element is replaced in the library and the name and level stored beside the
   * character's spells follow the edit.
   */
  private saveSpell(
    id: string,
    draft: CustomSpellDraft,
    request: { grant?: boolean; caster?: string },
  ): SaveResult {
    const first = this.host.snapshot(id);
    const read = readCustomPack(first.document);
    this.requireReadableBlock(read);
    const existing = read.drafts.find((candidate) => candidate.id === draft.id);
    if (existing !== undefined && !isCustomSpellDraft(existing)) {
      throw engineError("conflict", `'${existing.name}' is not a spell; its id cannot be reused for a spell`);
    }
    const caster = request.caster === undefined || request.caster === "" ? null : request.caster;
    // Checked before anything is stored, so a refused caster leaves the pack as it was.
    if (caster !== null && !(first.state.magic?.casters ?? []).some((block) => block.name === caster)) {
      throw engineError("invalid-argument", `This character has no '${caster}' spellcasting to cast the spell with.`);
    }
    this.host.applyRegionEdits(id, planCustomPackEdits(first.document, entriesWithDraft(read, draft)));
    const { report } = this.syncPack(id, this.host.snapshot(id).document);
    if (existing !== undefined) this.host.refreshSpellEntries(id, draft.id);
    const known = isSpellKnown(this.host.snapshot(id).state, draft.id);
    if (!known && (existing === undefined ? request.grant !== false : request.grant === true)) {
      this.host.addGrantedSpell(id, { spellId: draft.id, caster });
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
    this.requireReadableBlock(read);
    if (!read.entries.some((entry) => (entry as { id?: unknown } | null)?.id === request.draftId)) {
      throw engineError("not-found", `custom content '${request.draftId}' not found`);
    }
    const stored = read.drafts.find((candidate) => candidate.id === request.draftId);
    if (stored !== undefined && isCustomSpellDraft(stored)) {
      // Picks first, while the element still resolves; then a DM or caster grant.
      this.host.clearSpellPicks(id, request.draftId);
      if ((this.host.snapshot(id).state.magic?.additional ?? []).some((spell) => spell.id === request.draftId)) {
        this.host.removeGrantedSpell(id, { spellId: request.draftId });
      }
    } else if (stored !== undefined && isCustomItemDraft(stored)) {
      // An item is carried, not granted: every record of it leaves the inventory.
      // (A worn item's registration also sits in the element tree, which is not a grant.)
      for (const record of recordsOf(this.host.snapshot(id).state, request.draftId)) {
        this.host.removeItem(id, record.identifier);
      }
    } else if (isTopLevelGranted(state, request.draftId)) {
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
    const proposed = readCustomEntry(request.draft);
    const { document } = this.host.snapshot(id);
    const stored = readCustomPack(document).drafts.find((candidate) => candidate.id === proposed.id);
    // An item or a spell offers no choices, so changing one never costs a pick.
    if (
      stored === undefined ||
      isCustomItemDraft(stored) || isCustomSpellDraft(stored) ||
      isCustomItemDraft(proposed) || isCustomSpellDraft(proposed)
    ) {
      return { changes: [], hasPicks: false };
    }
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
