import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { compileCustomPack } from "@forge-cb/engine/custom";
import { api } from "../../api";
import { localStore } from "../../transport/localStore";
import ContentRenderer from "../ContentRenderer";
import ContentLoadingProgress from "../ContentLoadingProgress";
import CustomFeatureModal from "../custom/CustomFeatureModal";
import CustomItemModal from "../custom/CustomItemModal";
import CustomSpellModal from "../custom/CustomSpellModal";
import { MY_HOMEBREW_NAME, makeCustomServices, writePromotedElement } from "../custom/customServices";
import { spellDraftFromMissing } from "../custom/draftModel";
import CharacterPackView, { characterEntryMeta } from "./CharacterPackView";
import ElementEditor from "./ElementEditor";
import NewElementDialog from "./NewElementDialog";
import PackDetails from "./PackDetails";
import PackHealthCard from "./PackHealthCard";
import PackImportPanel from "./PackImportPanel";
import PromoteDialog from "./PromoteDialog";
import usePackImport from "./usePackImport";
import { buildHomebrewPreviewElement } from "./homebrewPreview";
import { buildPackFile } from "./packFile";
import { checkPackHealth, problemsIn } from "./packHealth";
import { planPromotion, promoteToPack, refsOfDraft, refsOfElement } from "./promotion";
import { CHARACTER_PACK_PREFIX, convertToFeature, elementForDraft, elementIdOf, elementMeta, loadedPack, migratePack } from "./packModel";
import { makePackFormServices } from "./packServices";
import Icon from "../Icon";
import Disclosure from "../Disclosure";
import { ToastStack, useToasts } from "../Toasts";
import {
  buildCollectionXml,
  buildElementXml,
  collectionFileName,
  createCollection,
  deriveAbbreviation,
  fileSlug,
  validateDraft,
} from "./xmlBuilder";
import { consolidateStrayCopies, removeCollection, saveCollection } from "./homebrewStorage";

let strayCopiesChecked = false;

// In-app homebrew pack editor. Packs are structured drafts stored in IndexedDB (localStore.homebrew,
// the name the earlier collections used); Update builder generates compatible XML and uploads it
// under one stable stored path per pack, so re-saving edits in place.
const HomebrewEditor = forwardRef(function HomebrewEditor(
  {
    beforeLibraryMutation,
    libraryPhase = "content",
    libraryProgress,
    libraryRevision = 0,
    onLibraryChanged,
    onLibraryMutationFinished,
    characterId = null,
    onOpenContent,
    onCharacterChanged,
  },
  ref,
) {
  const [packs, setPacks] = useState(null);
  const [draft, setDraft] = useState(null);
  const [characterView, setCharacterView] = useState(false);
  const [characterContent, setCharacterContent] = useState(null);
  const [characterNotice, setCharacterNotice] = useState(null);
  const [selectedElementId, setSelectedElementId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ingestResult, setIngestResult] = useState(null);
  const [inspectorView, setInspectorView] = useState("xml");
  const [xmlScope, setXmlScope] = useState("collection");
  const [elementSearch, setElementSearch] = useState("");
  const [draftSaveState, setDraftSaveState] = useState("saved");
  const [copyResult, setCopyResult] = useState(null);
  const [mobilePane, setMobilePane] = useState("library");
  const [newElementOpen, setNewElementOpen] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [health, setHealth] = useState({ status: "idle", findings: [] });
  const [identityReport, setIdentityReport] = useState(null);
  const [riskPrompt, setRiskPrompt] = useState(null);
  const [spellFix, setSpellFix] = useState(null);
  const [characterEdit, setCharacterEdit] = useState(null);
  const [promotion, setPromotion] = useState(null);
  const [rawStart, setRawStart] = useState(false);
  const toastState = useToasts();
  const { notify } = toastState;
  const importInput = useRef(null);
  const draftRef = useRef(draft);
  const persistTimerRef = useRef(null);
  const packRequestRef = useRef(0);
  const observedLibraryRevision = useRef(libraryRevision);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const refreshList = useCallback(() => {
    localStore
      .listHomebrew()
      .then((records) =>
        setPacks(
          records
            .map(migratePack)
            .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
        ),
      )
      .catch(() => setPacks([]));
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  // The open character's own pack, for the packs list.
  const refreshCharacterPack = useCallback(() => {
    if (!characterId) {
      setCharacterContent(null);
      return Promise.resolve();
    }
    return Promise.resolve(api.characters.customContent?.(characterId))
      .then((content) => setCharacterContent(content ?? { entries: [], problems: [] }))
      .catch(() => setCharacterContent(null));
  }, [characterId]);

  useEffect(() => {
    void refreshCharacterPack();
  }, [refreshCharacterPack, libraryRevision]);

  useEffect(() => {
    if (!characterId) setCharacterView(false);
  }, [characterId]);

  // Earlier versions stored a new copy of a collection on every save. Fold any such copies into
  // each pack's single stored file, once per page load.
  useEffect(() => {
    if (strayCopiesChecked) return;
    strayCopiesChecked = true;
    (async () => {
      const records = await localStore.listHomebrew();
      const removed = await consolidateStrayCopies(api, records);
      if (removed > 0) {
        api.content.clearCache();
        await onLibraryChanged?.({ source: "homebrew", result: {} });
      }
    })().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a one-time check; later handler identities do not matter
  }, []);

  const flushPendingDraft = useCallback(async () => {
    window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = null;
    const currentDraft = draftRef.current;
    if (!currentDraft) return;
    setDraftSaveState("saving");
    try {
      await localStore.putHomebrew(currentDraft);
      setDraftSaveState("saved");
      refreshList();
    } catch (error) {
      setDraftSaveState("error");
      throw error;
    }
  }, [refreshList]);

  useImperativeHandle(ref, () => ({ flushPendingDraft }), [flushPendingDraft]);

  // Saves only when an edit is waiting out the debounce, for the moments an author leaves the
  // editor: a field losing focus, another element opening, the page unloading, the editor closing.
  const flushIfPending = useCallback(() => {
    if (persistTimerRef.current === null) return;
    void flushPendingDraft().catch(() => {});
  }, [flushPendingDraft]);

  // The debounce effect below cancels its timer in its cleanup, and that cleanup also runs when the
  // editor unmounts, so without this a rename made just before the tab closed was never stored.
  useEffect(() => {
    window.addEventListener("beforeunload", flushIfPending);
    return () => {
      window.removeEventListener("beforeunload", flushIfPending);
      flushIfPending();
    };
  }, [flushIfPending]);

  // Every way of opening another element (or the pack's own page) goes through the selection.
  useEffect(() => {
    flushIfPending();
  }, [selectedElementId, flushIfPending]);

  // Debounce-persist the working draft so edits survive tab switches without an
  // explicit save (Update builder additionally regenerates + uploads the XML).
  useEffect(() => {
    if (!draft) return undefined;
    window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      void flushPendingDraft().catch(() => {});
    }, 600);
    // Left set, not nulled: the unmount flush above reads it to know an edit is still waiting.
    return () => window.clearTimeout(persistTimerRef.current);
  }, [draft, flushPendingDraft]);

  useEffect(() => {
    if (observedLibraryRevision.current === libraryRevision) return;
    observedLibraryRevision.current = libraryRevision;
    refreshList();
  }, [libraryRevision, refreshList]);

  const selectedElement = draft?.elements.find((el) => el.localId === selectedElementId) ?? null;
  const canRemoveContent = typeof api.content.remove === "function";

  const collectionXml = useMemo(() => (draft ? buildCollectionXml(draft) : ""), [draft]);

  const elementXml = useMemo(
    () => (selectedElement && draft ? buildElementXml(selectedElement, draft) : ""),
    [draft, selectedElement],
  );

  const previewElement = useMemo(
    () => (selectedElement && draft ? buildHomebrewPreviewElement(selectedElement, draft) : null),
    [draft, selectedElement],
  );

  const characterXml = useMemo(() => {
    const drafts = (characterContent?.entries ?? []).map((entry) => entry.draft);
    if (drafts.length === 0) return "";
    try {
      return compileCustomPack(drafts, { source: `${characterId}'s pack` });
    } catch {
      return "";
    }
  }, [characterContent, characterId]);

  const inspectorXml = characterView
    ? characterXml
    : xmlScope === "element" && selectedElement
      ? elementXml
      : collectionXml;
  const copyStatus = copyResult?.xml === inspectorXml ? copyResult.status : null;

  const updateDraft = useCallback((updater) => {
    setDraft((previous) => {
      if (!previous) return previous;
      const next = typeof updater === "function" ? updater(previous) : updater;
      if (!next || next === previous) return next;
      // A change is what makes this copy of the pack newer than a shared one, so it moves the version.
      return { ...next, hasUnloadedChanges: Boolean(previous.ingestedAt), version: Date.now() };
    });
    setDraftSaveState("saving");
  }, []);

  // Pack health, found by the engine from the pack's own file. It waits for the author to pause and
  // ignores an answer for a pack that has changed since.
  useEffect(() => {
    if (!draft) {
      setHealth({ status: "idle", findings: [] });
      return undefined;
    }
    let alive = true;
    setHealth((current) => ({ ...current, status: "checking" }));
    const handle = window.setTimeout(() => {
      checkPackHealth(api, draft)
        .then((findings) => alive && setHealth({ status: "ready", findings }))
        .catch(() => alive && setHealth({ status: "error", findings: [] }));
    }, 700);
    return () => {
      alive = false;
      window.clearTimeout(handle);
    };
  }, [draft, libraryRevision]);

  // Picks characters made under the selected element's choices that an edit would clear.
  const selectedDraft = selectedElement?.customDraft;
  const selectedLoaded = selectedElement?.loadedDraft;
  useEffect(() => {
    if (!selectedDraft || !selectedLoaded || typeof api.content.packChoiceImpact !== "function") {
      setIdentityReport(null);
      return undefined;
    }
    let alive = true;
    const handle = window.setTimeout(() => {
      api.content
        .packChoiceImpact(selectedLoaded, selectedDraft)
        .then((report) => alive && setIdentityReport(report))
        .catch(() => alive && setIdentityReport(null));
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(handle);
    };
  }, [selectedDraft, selectedLoaded]);

  const resetSelection = () => {
    setSelectedElementId(null);
    setIngestResult(null);
    setInspectorView("xml");
    setXmlScope("collection");
    setElementSearch("");
    setDraftSaveState("saved");
    setShowIssues(false);
    setRiskPrompt(null);
    setIdentityReport(null);
    setMobilePane("editor");
  };

  const selectPack = async (value) => {
    if (!value) return;
    const requestId = ++packRequestRef.current;
    try {
      await flushPendingDraft();
      if (value.startsWith(CHARACTER_PACK_PREFIX)) {
        setCharacterNotice(null);
        await refreshCharacterPack();
        if (requestId !== packRequestRef.current) return;
        setDraft(null);
        setCharacterView(true);
        resetSelection();
        return;
      }
      if (value === draftRef.current?.id && !characterView) return;
      const stored = await localStore.getHomebrew(value);
      if (!stored || requestId !== packRequestRef.current) return;
      const record = migratePack(stored);
      // Opening an older collection brings it up to the current shape in the store too.
      if (record !== stored) await localStore.putHomebrew(record);
      setCharacterView(false);
      setDraft(record);
      resetSelection();
    } catch (error) {
      setIngestResult({ ok: false, errors: [{ where: "Storage", message: error.message }] });
    }
  };

  const createNewPack = async () => {
    ++packRequestRef.current;
    const record = createCollection("New Pack");
    try {
      await flushPendingDraft();
      await localStore.putHomebrew(record);
      setCharacterView(false);
      setDraft(record);
      resetSelection();
      refreshList();
    } catch (error) {
      setIngestResult({ ok: false, errors: [{ where: "Storage", message: error.message }] });
    }
  };

  // Pack detail edits. Slug and abbreviation auto-derive from the name until the user edits them
  // directly or the pack is first loaded (the slug is the upload path, so it must stay stable once
  // the engine holds a file under it).
  const setPackField = (key, value) => {
    updateDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: value };
      if (key === "name" && !prev.ingestedAt) {
        if (!prev.slugTouched) next.slug = fileSlug(value);
        if (!prev.abbrTouched) next.abbreviation = deriveAbbreviation(value);
      }
      if (key === "slug") {
        next.slug = value.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
        next.slugTouched = true;
      }
      if (key === "abbreviation") {
        next.abbreviation = value.toUpperCase().replace(/[^A-Z0-9]+/g, "");
        next.abbrTouched = true;
      }
      return next;
    });
  };

  const addElement = useCallback(
    (element) => {
      updateDraft((prev) => {
        const at = prev.elements.findIndex((entry) => entry.id && entry.id === element.id && entry.localId !== element.localId);
        // An element with an id the pack already holds replaces it, as promotion does.
        if (at === -1) return { ...prev, elements: [...prev.elements, element] };
        return {
          ...prev,
          elements: prev.elements.map((entry, index) => (index === at ? { ...element, localId: entry.localId } : entry)),
        };
      });
      setSelectedElementId(element.localId);
      setInspectorView("preview");
      setXmlScope("element");
      setMobilePane("editor");
    },
    [updateDraft],
  );

  const changeElement = useCallback(
    (next) => {
      updateDraft((prev) => ({
        ...prev,
        elements: prev.elements.map((el) => (el.localId === next.localId ? next : el)),
      }));
    },
    [updateDraft],
  );

  const removeElement = (localId) => {
    const element = draft.elements.find((el) => el.localId === localId);
    if (
      !window.confirm(
        `Remove "${element?.name ?? "this element"}" from the pack? It disappears from the library the next time you update the builder.`,
      )
    )
      return;
    updateDraft((prev) => ({
      ...prev,
      elements: prev.elements.filter((el) => el.localId !== localId),
    }));
    if (selectedElementId === localId) {
      setSelectedElementId(null);
      setXmlScope("collection");
      setInspectorView("xml");
    }
  };

  // What the pack health card's fixes do.
  const applyFix = (finding, fix) => {
    if (fix.action === "open") {
      selectElement(fix.element);
    } else if (fix.action === "convert") {
      updateDraft((prev) => ({
        ...prev,
        elements: prev.elements.map((el) => (el.localId === fix.element.localId ? convertToFeature(el, prev) : el)),
      }));
    } else if (fix.action === "create-spell") {
      setSpellFix({ finding });
    } else if (fix.action === "find-source") {
      onOpenContent?.({ missing: fix.need });
    }
  };

  // Elements whose choices an update would change, with the picks that would be cleared.
  const collectRisks = async () => {
    if (typeof api.content.packChoiceImpact !== "function") return [];
    const risks = [];
    for (const element of draftRef.current?.elements ?? []) {
      if (!element.loadedDraft || !element.customDraft) continue;
      if (JSON.stringify(element.loadedDraft) === JSON.stringify(element.customDraft)) continue;
      try {
        const report = await api.content.packChoiceImpact(element.loadedDraft, element.customDraft);
        const changes = (report?.changes ?? []).filter((change) => change.picks.length > 0);
        if (changes.length > 0) risks.push({ element, changes });
      } catch {
        // An element the check cannot read is reported by validation, not here.
      }
    }
    return risks;
  };

  const saveAndIngest = async ({ skipRiskCheck = false } = {}) => {
    if (!draft) return;
    const errors = validateDraft(draft);
    if (errors.length) {
      setShowIssues(true);
      setIngestResult({ ok: false, errors });
      return;
    }
    if (!skipRiskCheck) {
      const risks = await collectRisks();
      if (risks.length > 0) {
        setRiskPrompt(risks);
        return;
      }
    }
    setRiskPrompt(null);
    setBusy(true);
    setIngestResult(null);
    try {
      await beforeLibraryMutation?.();
      await localStore.putHomebrew(draft); // draft JSON is the source of truth
      const { result, diagnostics, warnings, rejected } = await saveCollection(api, draft);
      api.content.clearCache();
      await onLibraryChanged?.({ source: "homebrew", result });

      if (diagnostics.length === 0 && rejected.length === 0) {
        // Ingested clean: freeze element ids (stable across renames / re-uploads) and remember the
        // version of each element's draft that is now in the library.
        const locked = loadedPack(draft);
        await localStore.putHomebrew(locked);
        setDraft(locked);
        setDraftSaveState("saved");
        setShowIssues(false);
        setIngestResult({ ok: true, count: result.elementCountAfterReload, warnings });
      } else {
        setIngestResult({ ok: false, diagnostics, rejected });
      }
      refreshList();
    } catch (e) {
      setIngestResult({ ok: false, errors: [{ where: "Ingest", message: e.message }] });
    } finally {
      setBusy(false);
      onLibraryMutationFinished?.();
    }
  };

  const saveFile = (text, filename) => {
    const url = URL.createObjectURL(new Blob([text], { type: "application/xml" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  // Download of the generated pack XML, as the library loads it.
  const download = () => {
    if (!draft) return;
    saveFile(buildCollectionXml(draft), collectionFileName(draft));
  };

  // The one-file share: the same XML plus the pack as the editor keeps it, so another device opens
  // it editable. A pack that does not pass validation is not shared, like one that is not loaded.
  const sharePack = async () => {
    if (!draft) return;
    const errors = validateDraft(draftRef.current ?? draft);
    if (errors.length) {
      setShowIssues(true);
      setIngestResult({ ok: false, errors });
      return;
    }
    try {
      await flushPendingDraft();
    } catch {
      return;
    }
    const record = draftRef.current ?? draft;
    const filename = `${fileSlug(record.slug || record.name) || "pack"}.pack.xml`;
    saveFile(buildPackFile(record), filename);
    notify(
      `${record.name} was saved as ${filename}. Send that file to anyone who should have the pack: they add it under Homebrew › Import pack or Content › Manage files, and can edit it just as you do.`,
      { sticky: true },
    );
  };

  const packImport = usePackImport({
    api,
    store: localStore,
    beforeLibraryMutation,
    onLibraryChanged,
    onLibraryMutationFinished,
    onImported: (pack) => {
      refreshList();
      // The open pack is the one that was replaced: show the file's copy, not the one it replaced.
      if (draftRef.current?.id === pack.id) {
        window.clearTimeout(persistTimerRef.current);
        setDraft(pack);
        resetSelection();
      }
    },
  });

  const chooseImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const kind = await packImport.start(file);
      if (kind === "not-pack") {
        notify(`${file.name} is a plain content file, not a pack file. Add it under Content › Manage files.`, { ms: 6000 });
      }
    } catch (error) {
      setIngestResult({ ok: false, errors: [{ where: "Import", message: error.message }] });
    }
  };

  const deletePack = async () => {
    if (!draft) return;
    if (
      !window.confirm(
        `Delete the pack "${draft.name}"? This removes the draft${draft.ingestedAt ? " and unloads its content from the library" : ""}. Characters using its elements will lose those picks.`,
      )
    )
      return;
    setBusy(true);
    try {
      await beforeLibraryMutation?.();
      let result = { characterReloadRequired: false };
      // Always: a pack that loaded with advice never gets ingestedAt, but its file is stored.
      if (canRemoveContent) {
        result = await removeCollection(api, draft);
        api.content.clearCache();
      }
      await localStore.deleteHomebrew(draft.id);
      setDraft(null);
      resetSelection();
      setMobilePane("library");
      refreshList();
      await onLibraryChanged?.({ source: "homebrew", result });
    } catch (e) {
      setIngestResult({ ok: false, errors: [{ where: "Delete", message: e.message }] });
    } finally {
      setBusy(false);
      onLibraryMutationFinished?.();
    }
  };

  // Copies one of the character's entries into My homebrew; its id stays, so the character keeps it.
  const copyCharacterEntry = async (entry) => {
    setBusy(true);
    setCharacterNotice(null);
    try {
      const promoted = await api.characters.promoteCustomDraft(characterId, entry.elementId, MY_HOMEBREW_NAME);
      await writePromotedElement(localStore, promoted, MY_HOMEBREW_NAME);
      refreshList();
      setCharacterNotice(`${entry.draft.name} is in ${MY_HOMEBREW_NAME}. Open that pack and update the builder to share it.`);
    } catch (e) {
      setIngestResult({ ok: false, errors: [{ where: "Copy", message: e.message }] });
    } finally {
      setBusy(false);
    }
  };

  // Editing one of the character's own entries here is the same form the Build, Equipment and Magic
  // tabs open, saved through the same character calls; the open workspace is told to refresh.
  const runOnCharacter = useCallback(
    async (operation) => {
      const result = await operation();
      await refreshCharacterPack();
      onCharacterChanged?.();
      return result;
    },
    [refreshCharacterPack, onCharacterChanged],
  );

  const openCharacterEntry = async (entry) => {
    let ruleset;
    try {
      ruleset = (await api.characters.get?.(characterId))?.rulesetMode;
    } catch {
      ruleset = undefined;
    }
    setCharacterEdit({ entry, ruleset });
  };

  const characterServices = useMemo(
    () =>
      characterEdit && characterId
        ? makeCustomServices({ api, store: localStore, id: characterId, run: runOnCharacter, ruleset: characterEdit.ruleset })
        : null,
    [characterEdit, characterId, runOnCharacter],
  );

  // Promotion: where an entry goes, and what it refers to that should come with it.
  const startCharacterPromotion = (entry) => {
    const byId = new Map((characterContent?.entries ?? []).map((candidate) => [candidate.elementId, candidate]));
    const describe = (candidate) => ({ name: candidate.draft.name, meta: characterEntryMeta(candidate), draft: candidate.draft, refs: refsOfDraft(candidate.draft) });
    const plan = planPromotion({
      primary: { id: entry.elementId, ...describe(entry) },
      find: (id) => (byId.has(id) ? describe(byId.get(id)) : null),
      target: null,
    });
    setPromotion({ subject: entry.draft.name, plan: { ...plan, sourceNoun: "character's pack" }, sourcePack: null, excludePackId: null, error: null });
  };

  const startElementPromotion = (element) => {
    const source = draftRef.current;
    if (!source) return;
    const describe = (candidate) => ({ name: candidate.name || `New ${candidate.type}`, meta: elementMeta(candidate), element: candidate, refs: refsOfElement(candidate) });
    const plan = planPromotion({
      primary: { id: elementIdOf(element, source), ...describe(element) },
      find: (id) => {
        const found = source.elements.find((candidate) => elementIdOf(candidate, source) === id);
        return found ? describe(found) : null;
      },
      target: null,
    });
    setPromotion({ subject: element.name || element.type, plan: { ...plan, sourceNoun: "pack" }, sourcePack: source, excludePackId: source.id, error: null });
  };

  const confirmPromotion = async ({ target, items }) => {
    setBusy(true);
    setPromotion((current) => (current ? { ...current, error: null } : current));
    try {
      await flushPendingDraft();
      const outcome = await promoteToPack({ store: localStore, target, items, sourcePack: promotion?.sourcePack ?? null });
      refreshList();
      const done = [...outcome.added, ...outcome.replaced];
      notify(
        `${done.join(", ")} ${done.length === 1 ? "is" : "are"} now in ${outcome.pack.name}. Open that pack and use Update builder to load it, or share it from there.`,
        { ms: 6000 },
      );
      setPromotion(null);
    } catch (e) {
      setPromotion((current) => (current ? { ...current, error: e.message } : current));
    } finally {
      setBusy(false);
    }
  };

  const visibleElements = useMemo(() => {
    const query = elementSearch.trim().toLowerCase();
    if (!draft || !query) return draft?.elements ?? [];
    return draft.elements.filter((element) => `${element.name} ${element.type}`.toLowerCase().includes(query));
  }, [draft, elementSearch]);

  const selectPackDetails = () => {
    setSelectedElementId(null);
    setInspectorView("xml");
    setXmlScope("collection");
    setMobilePane("editor");
  };

  function selectElement(element) {
    setSelectedElementId(element.localId);
    setXmlScope("element");
    setInspectorView("preview");
    setMobilePane("editor");
  }

  const copyInspectorXml = async () => {
    try {
      await navigator.clipboard.writeText(inspectorXml);
      setCopyResult({ xml: inspectorXml, status: "Copied" });
    } catch {
      setCopyResult({ xml: inspectorXml, status: "Copy failed" });
    }
  };

  const problemCount = problemsIn(health.findings).length;
  const spellServices = useMemo(
    () =>
      spellFix && draft
        ? makePackFormServices({
            api,
            pack: draft,
            kind: "spell",
            onSave: async (spell) => addElement(elementForDraft(spell, draftRef.current ?? draft)),
          })
        : null,
    [spellFix, draft, addElement],
  );

  return (
    <div aria-labelledby="homebrew-editor-title">
      <div className="fcb-page-heading fcb-homebrew-heading">
        <h1 id="homebrew-editor-title">Homebrew</h1>
        <p>Author your own spells, feats, items, and features in packs you can share.</p>
      </div>

      <HomebrewToolbar
        packs={packs}
        draft={draft}
        characterId={characterId}
        characterView={characterView}
        busy={busy || packImport.busy}
        draftSaveState={draftSaveState}
        onPackChange={selectPack}
        onNewPack={createNewPack}
        onLoad={() => saveAndIngest()}
        onDownload={download}
        onShare={sharePack}
        onImport={() => importInput.current?.click()}
        onDelete={deletePack}
      />
      <input
        ref={importInput}
        type="file"
        accept=".xml,application/xml,text/xml"
        hidden
        data-testid="hb-import-input"
        aria-label="Pack file to import"
        onChange={chooseImportFile}
      />

      <PackImportPanel
        plan={packImport.plan}
        outcome={packImport.outcome}
        busy={packImport.busy}
        onApply={packImport.apply}
        onCancel={packImport.cancel}
        onDismiss={packImport.dismiss}
      />

      {busy ? (
        <div data-testid="hb-ingest-progress" className="fcb-homebrew-ingest-result">
          <ContentLoadingProgress phase={libraryPhase} progress={libraryProgress} fallbackMessage="Preparing content update…" />
        </div>
      ) : (
        <IngestResult result={ingestResult} />
      )}

      {riskPrompt && (
        <div role="alert" className="fcb-alert space-y-2" data-testid="hb-risk-prompt">
          <p className="font-semibold">Updating the builder would clear picks characters already made.</p>
          <ul className="list-disc pl-5 text-sm">
            {riskPrompt.flatMap(({ element, changes }) =>
              changes.map((change) => (
                <li key={`${element.localId}-${change.blockId}`}>
                  {element.name}: &ldquo;{change.name}&rdquo; {change.change === "removed" ? "is being removed" : `changes its ${change.fields.join(", ")}`}.
                  Cleared: {change.picks.map((pick) => pick.elementName).join(", ")}.
                </li>
              )),
            )}
          </ul>
          <div className="fcb-toolbar">
            <button type="button" className="fcb-button" onClick={() => setRiskPrompt(null)}>
              Keep editing
            </button>
            <button type="button" className="fcb-button fcb-button-danger" onClick={() => saveAndIngest({ skipRiskCheck: true })}>
              Update and clear those picks
            </button>
          </div>
        </div>
      )}

      <div className={`fcb-homebrew-workspace is-mobile-${mobilePane}`}>
        <HomebrewNavigator
          draft={characterView ? null : draft}
          characterView={characterView}
          characterEntries={characterContent?.entries ?? []}
          characterName={characterId}
          busy={busy}
          problemCount={problemCount}
          healthStatus={health.status}
          selectedElementId={selectedElementId}
          elementSearch={elementSearch}
          visibleElements={visibleElements}
          onPackDetails={selectPackDetails}
          onElementSearch={setElementSearch}
          onAddElement={() => setNewElementOpen(true)}
          onSelectElement={selectElement}
          onRemoveElement={removeElement}
        />

        <section
          id="hb-main-editor"
          className="fcb-homebrew-editor min-w-0"
          data-testid="hb-main-editor"
          aria-label="Homebrew editor"
          onBlur={flushIfPending}
        >
          <button
            type="button"
            data-testid="hb-mobile-back"
            className="fcb-button fcb-homebrew-mobile-back"
            onClick={() => setMobilePane("library")}
          >
            Back to elements
          </button>
          {!draft && !characterView && (
            <section className="fcb-panel">
              <div className="fcb-panel-body">
                <p className="fcb-empty-copy">Create or select a pack to edit its contents.</p>
              </div>
            </section>
          )}
          {characterView && (
            <CharacterPackView
              characterName={characterId}
              content={characterContent}
              busy={busy}
              notice={characterNotice}
              onCopy={copyCharacterEntry}
              onEdit={openCharacterEntry}
              onPromote={startCharacterPromotion}
            />
          )}
          {draft && !characterView && !selectedElement && (
            <div className="space-y-4">
              <PackHealthCard pack={draft} health={health} busy={busy} onFix={applyFix} />
              <PackDetails pack={draft} busy={busy} onFieldChange={setPackField} onOpenContent={onOpenContent} />
            </div>
          )}
          {draft && !characterView && selectedElement && (
            <ElementEditor
              key={selectedElement.localId}
              element={selectedElement}
              pack={draft}
              api={api}
              disabled={busy}
              showIssues={showIssues}
              identityReport={identityReport}
              onChange={changeElement}
              onCopyToPack={() => startElementPromotion(selectedElement)}
            />
          )}
          {draft && !characterView && (
            <HomebrewPackTools
              busy={busy || packImport.busy}
              onRawElement={() => setRawStart(true)}
              onOpenContent={onOpenContent ? () => onOpenContent() : undefined}
            />
          )}
        </section>

        <HomebrewInspector
          draft={characterView ? { name: `${characterId}'s pack` } : draft}
          selectedElement={characterView ? null : selectedElement}
          previewElement={previewElement}
          inspectorView={characterView ? "xml" : inspectorView}
          xmlScope={characterView ? "collection" : xmlScope}
          inspectorXml={inspectorXml}
          copyStatus={copyStatus}
          onViewChange={setInspectorView}
          onScopeChange={setXmlScope}
          onCopy={copyInspectorXml}
        />
      </div>

      {(newElementOpen || rawStart) && draft && (
        <NewElementDialog
          pack={draft}
          api={api}
          startAt={rawStart ? "raw" : undefined}
          onClose={() => {
            setNewElementOpen(false);
            setRawStart(false);
          }}
          onCreate={addElement}
        />
      )}

      {characterEdit && characterServices && characterEdit.entry.kind === "item" && (
        <CustomItemModal
          key={characterEdit.entry.elementId}
          services={characterServices}
          characterName={characterId}
          entry={characterEdit.entry}
          onClose={() => setCharacterEdit(null)}
        />
      )}
      {characterEdit && characterServices && characterEdit.entry.kind === "spell" && (
        <CustomSpellModal
          key={characterEdit.entry.elementId}
          services={characterServices}
          characterName={characterId}
          entry={characterEdit.entry}
          onClose={() => setCharacterEdit(null)}
        />
      )}
      {characterEdit && characterServices && (characterEdit.entry.kind ?? "feature") === "feature" && (
        <CustomFeatureModal
          key={characterEdit.entry.elementId}
          services={characterServices}
          characterName={characterId}
          entry={characterEdit.entry}
          initialShowsUnder={characterEdit.entry.draft.showsUnder}
          onClose={() => setCharacterEdit(null)}
        />
      )}

      {promotion && (
        <PromoteDialog
          subject={promotion.subject}
          plan={promotion.plan}
          packs={(packs ?? []).filter((pack) => pack.id !== promotion.excludePackId)}
          busy={busy}
          error={promotion.error}
          onConfirm={confirmPromotion}
          onClose={() => setPromotion(null)}
        />
      )}

      {spellFix && spellServices && (
        <CustomSpellModal
          key={spellFix.finding.missingId}
          services={spellServices}
          characterName={draft.name}
          pack={{ name: draft.name }}
          initialDraft={spellDraftFromMissing(spellFix.finding)}
          onClose={() => setSpellFix(null)}
        />
      )}
      <ToastStack {...toastState} />
    </div>
  );
});

function HomebrewToolbar({
  packs,
  draft,
  characterId,
  characterView,
  busy,
  draftSaveState,
  onPackChange,
  onNewPack,
  onLoad,
  onDownload,
  onShare,
  onImport,
  onDelete,
}) {
  const builderState = !draft?.ingestedAt
    ? "Not loaded into builder"
    : draft.hasUnloadedChanges
      ? "Changes not loaded into builder"
      : "Loaded into builder";
  const saveLabel =
    draftSaveState === "saving" ? "Saving…" : draftSaveState === "error" ? "Save failed" : "Saved locally";
  const value = characterView ? `${CHARACTER_PACK_PREFIX}${characterId}` : (draft?.id ?? "");

  return (
    <header className="fcb-panel fcb-homebrew-toolbar" role="toolbar" aria-label="Homebrew pack actions">
      <label className="fcb-homebrew-collection-picker">
        <span className="fcb-homebrew-collection-label">Pack</span>
        <select
          data-testid="hb-pack-select"
          className="fcb-select"
          value={value}
          onChange={(event) => onPackChange(event.target.value)}
          disabled={busy || !packs}
          aria-label="Pack"
        >
          <option value="" disabled>
            {packs ? "Select a pack" : "Loading packs…"}
          </option>
          {characterId && (
            <optgroup label="On this character">
              <option value={`${CHARACTER_PACK_PREFIX}${characterId}`}>{characterId}&apos;s pack</option>
            </optgroup>
          )}
          <optgroup label="Homebrew packs">
            {(packs ?? []).map((pack) => (
              <option key={pack.id} value={pack.id}>
                {pack.name} ({pack.elements?.length ?? 0})
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <button
        type="button"
        data-testid="hb-new-pack"
        className="fcb-button fcb-homebrew-new-collection"
        onClick={onNewPack}
        disabled={busy}
        aria-label="Create new pack"
        title="Create new pack"
      >
        <span className="fcb-homebrew-new-symbol" aria-hidden="true">
          +
        </span>
        <span className="fcb-homebrew-new-label">New</span>
      </button>
      <div
        className="fcb-homebrew-status"
        role="status"
        aria-live="polite"
        aria-label={`${saveLabel}${draft ? `. ${builderState}` : ""}`}
      >
        <span className={`fcb-homebrew-status-dot ${draftSaveState === "error" ? "is-error" : ""}`} aria-hidden="true" />
        <span className="fcb-homebrew-save-label">{saveLabel}</span>
        {draft && <span className="fcb-homebrew-builder-state">{builderState}</span>}
      </div>
      <div className="fcb-homebrew-toolbar-actions">
        <button
          type="button"
          data-testid="hb-save-ingest"
          className="fcb-button fcb-button-primary"
          onClick={onLoad}
          disabled={busy || !draft}
        >
          {busy ? "Working…" : draft?.ingestedAt ? "Update builder" : "Load into builder"}
        </button>
        <button
          type="button"
          data-testid="hb-share-pack"
          className="fcb-button"
          onClick={onShare}
          disabled={busy || !draft}
          title="Save one file with the pack and its drafts, to give to another device or person"
        >
          Share pack
        </button>
        <button
          type="button"
          data-testid="hb-import-pack"
          className="fcb-button"
          onClick={onImport}
          disabled={busy}
          title="Add a pack file someone shared"
        >
          Import pack
        </button>
        <button
          type="button"
          data-testid="hb-download"
          className="fcb-button"
          onClick={onDownload}
          disabled={busy || !draft}
          aria-label="Download pack XML"
          title="Download pack XML"
        >
          Download XML
        </button>
        <button
          type="button"
          className="fcb-icon-button fcb-homebrew-delete-collection"
          onClick={onDelete}
          disabled={busy || !draft}
          aria-label="Delete pack"
          title="Delete pack"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16" />
            <path d="M9 7V4h6v3" />
            <path d="m7 7 1 13h8l1-13" />
            <path d="M10 11v5m4-5v5" />
          </svg>
        </button>
      </div>
    </header>
  );
}

// The rarely needed tools, kept inside the editor column and closed: an element written as XML, and
// the content files that arrive from Content › Manage files. Importing and downloading a pack are in
// the pack bar above, so they are not repeated here.
function HomebrewPackTools({ busy, onRawElement, onOpenContent }) {
  return (
    <Disclosure
      variant="panel"
      className="fcb-panel fcb-homebrew-pack-tools"
      data-testid="hb-pack-tools"
      summaryClassName="fcb-panel-header"
      summary={<span className="fcb-panel-title">More pack tools</span>}
      bare
    >
      <div className="fcb-panel-body space-y-3 text-sm">
        <p>
          Everything here is also reachable from the forms: any element can be edited as XML, and a content file you already have can be added
          as it always could.
        </p>
        <div className="fcb-toolbar">
          <button type="button" className="fcb-button" data-testid="hb-pack-tools-raw" disabled={busy} onClick={onRawElement}>
            New element written as XML
          </button>
          {onOpenContent && (
            <button type="button" className="fcb-button" data-testid="hb-pack-tools-manage-files" onClick={onOpenContent}>
              Open Content › Manage files
            </button>
          )}
        </div>
        <p className="fcb-muted-copy text-xs">
          To change one element&apos;s XML, open it and use Advanced › Edit raw XML. Content › Manage files takes XML files, ZIPs, folders and
          web addresses, and a pack file shared from here.
        </p>
      </div>
    </Disclosure>
  );
}

function IngestResult({ result }) {
  return (
    <div
      data-testid="hb-ingest-result"
      className="fcb-homebrew-ingest-result"
    >
      {result?.ok && (
        <p role="status">
          <span className="fcb-status-badge fcb-status-complete">
            {result.count != null
              ? `Loaded into builder — ${result.count} elements available`
              : "Loaded into builder"}
          </span>
        </p>
      )}
      {result?.ok && (result.warnings ?? []).length > 0 && (
        <div className="fcb-warning-note" data-testid="hb-ingest-warnings">
          <p className="font-semibold">Loaded, with content warnings:</p>
          <ul className="mt-1 list-disc pl-5">
            {result.warnings.map((warning, index) => (
              <li key={index}>
                [{warning.kind}] {warning.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result && !result.ok && (
        <div className="fcb-alert" role="alert">
          <p className="font-semibold">
            Could not load this pack — fix these and retry:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {(result.errors ?? []).map((error, index) => (
              <li key={`e${index}`}>
                {error.where}: {error.message}
              </li>
            ))}
            {(result.rejected ?? []).map((file, index) => (
              <li key={`r${index}`}>
                {file.fileName}: {file.error ?? "rejected"}
              </li>
            ))}
            {(result.diagnostics ?? []).map((diagnostic, index) => (
              <li key={`d${index}`}>
                [{diagnostic.kind}] {diagnostic.message}
                {diagnostic.detail ? ` — ${diagnostic.detail}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function HomebrewNavigator({
  draft,
  characterView,
  characterEntries,
  characterName,
  busy,
  problemCount,
  healthStatus,
  selectedElementId,
  elementSearch,
  visibleElements,
  onPackDetails,
  onElementSearch,
  onAddElement,
  onSelectElement,
  onRemoveElement,
}) {
  return (
    <aside className="fcb-panel fcb-homebrew-library">
      <nav aria-label="Elements in pack">
        <button
          type="button"
          className={`fcb-homebrew-nav-row ${draft && !selectedElementId ? "is-active" : ""}`}
          onClick={onPackDetails}
          disabled={!draft}
          aria-current={draft && !selectedElementId ? "page" : undefined}
          aria-controls="hb-main-editor"
        >
          <span>Pack details and health</span>
          <small>
            {draft && healthStatus === "ready" && problemCount > 0
              ? `${problemCount} to fix`
              : "Name, source settings and checks"}
          </small>
        </button>
        <div className="fcb-homebrew-library-heading">
          <div>
            <h2>Elements</h2>
            <span>{characterView ? characterEntries.length : (draft?.elements.length ?? 0)}</span>
          </div>
          {draft && (
            <label className="fcb-homebrew-search-field">
              <span>Search pack elements</span>
              <input
                type="search"
                className="fcb-input normal-case"
                value={elementSearch}
                onChange={(event) => onElementSearch(event.target.value)}
                placeholder="Name or type"
                aria-controls="hb-element-list"
              />
            </label>
          )}
        </div>

        <div id="hb-element-list" data-testid="hb-element-list" className="fcb-homebrew-element-list">
          {!draft && !characterView && <p className="fcb-empty-copy">Select a pack to browse its elements.</p>}
          {characterView && characterEntries.length === 0 && <p className="fcb-empty-copy">{characterName}&apos;s pack is empty.</p>}
          {characterView &&
            characterEntries.map((entry) => (
              <div className="fcb-homebrew-element-row" key={entry.elementId}>
                <span className="fcb-homebrew-nav-row">
                  <span>{entry.draft.name}</span>
                  <small>{characterEntryMeta(entry)}</small>
                </span>
              </div>
            ))}
          {draft?.elements.length === 0 && <p className="fcb-empty-copy">No elements yet. Use + Element to add one.</p>}
          {draft && draft.elements.length > 0 && visibleElements.length === 0 && (
            <p className="fcb-empty-copy">No elements match this search.</p>
          )}
          {visibleElements.map((element) => (
            <div className="fcb-homebrew-element-row" key={element.localId}>
              <button
                type="button"
                className={`fcb-homebrew-nav-row ${selectedElementId === element.localId ? "is-active" : ""}`}
                onClick={() => onSelectElement(element)}
                aria-current={selectedElementId === element.localId ? "page" : undefined}
              >
                <span>{element.name || `New ${element.type}`}</span>
                <small>{elementMeta(element)}</small>
              </button>
              <button
                type="button"
                className="fcb-icon-button fcb-homebrew-delete-element"
                onClick={() => onRemoveElement(element.localId)}
                disabled={busy}
                aria-label={`Delete ${element.name || element.type}`}
                title={`Delete ${element.name || element.type}`}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 7h16" />
                  <path d="M9 7V4h6v3" />
                  <path d="m7 7 1 13h8l1-13" />
                  <path d="M10 11v5m4-5v5" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </nav>

      <div className="fcb-homebrew-add-element">
        <button
          type="button"
          data-testid="hb-add-element"
          className="fcb-button fcb-button-primary"
          onClick={onAddElement}
          disabled={busy || !draft}
        >
          <Icon name="add" />
          Element
        </button>
      </div>
    </aside>
  );
}

function HomebrewInspector({
  draft,
  selectedElement,
  previewElement,
  inspectorView,
  xmlScope,
  inspectorXml,
  copyStatus,
  onViewChange,
  onScopeChange,
  onCopy,
}) {
  return (
    <aside
      className="fcb-panel fcb-homebrew-inspector min-w-0"
      data-testid="hb-inspector"
    >
      <header className="fcb-homebrew-inspector-header">
        <nav
          className="fcb-secondary-tabs"
          aria-label="Homebrew inspector view"
        >
          <button
            type="button"
            className={`fcb-tab ${
              inspectorView === "preview" ? "is-active" : ""
            }`}
            onClick={() => onViewChange("preview")}
            disabled={!selectedElement}
            aria-pressed={inspectorView === "preview"}
          >
            Preview
          </button>
          <button
            type="button"
            className={`fcb-tab ${
              inspectorView === "xml" ? "is-active" : ""
            }`}
            onClick={() => onViewChange("xml")}
            aria-pressed={inspectorView === "xml"}
          >
            XML
          </button>
        </nav>
        {inspectorView === "xml" && (
          <label className="fcb-homebrew-scope">
            <span>Scope</span>
            <select
              className="fcb-select"
              value={xmlScope}
              onChange={(event) => onScopeChange(event.target.value)}
              disabled={!selectedElement}
            >
              <option value="element">Current element</option>
              <option value="collection">Entire pack</option>
            </select>
          </label>
        )}
      </header>
      <div className="fcb-homebrew-inspector-body">
        {!draft && (
          <p className="fcb-empty-copy">
            Select a pack to inspect its generated XML.
          </p>
        )}
        {draft && inspectorView === "preview" && previewElement && (
          <div className="fcb-homebrew-live-preview">
            <ContentRenderer element={previewElement} />
            {previewElement.previewNote && (
              <p className="fcb-homebrew-preview-note">
                {previewElement.previewNote}
              </p>
            )}
          </div>
        )}
        {draft && inspectorView === "xml" && (
          <pre className="fcb-homebrew-xml" data-testid="hb-xml-preview">
            {inspectorXml}
          </pre>
        )}
      </div>
      {draft && inspectorView === "xml" && (
        <footer className="fcb-homebrew-inspector-actions">
          <button type="button" className="fcb-button" onClick={onCopy}>
            {copyStatus ?? "Copy XML"}
          </button>
        </footer>
      )}
    </aside>
  );
}

export default HomebrewEditor;
