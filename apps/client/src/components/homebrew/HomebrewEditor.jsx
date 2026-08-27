import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../../api";
import { localStore } from "../../transport/localStore";
import ContentRenderer from "../ContentRenderer";
import ContentLoadingProgress from "../ContentLoadingProgress";
import ElementForm from "./ElementForm";
import { buildHomebrewPreviewElement } from "./homebrewPreview";
import Icon from '../Icon';
import {
  ELEMENT_TYPES,
  RULESET_OPTIONS,
  UPLOAD_CATEGORY,
  buildCollectionXml,
  buildElementXml,
  collectionFileName,
  collectionFilePath,
  createCollection,
  createElement,
  deriveAbbreviation,
  fileSlug,
  resolveElementId,
  normalizeCollectionRuleset,
  validateDraft,
} from "./xmlBuilder";

const ELEMENT_TYPE_GROUPS = [
  { label: "Magic", types: ["Spell"] },
  {
    label: "Character options",
    types: [
      "Feat",
      "Racial Trait",
      "Class Feature",
      "Archetype Feature",
      "Background Feature",
      "Language",
    ],
  },
  {
    label: "Equipment",
    types: ["Weapon", "Armor", "Item", "Magic Item"],
  },
];

// In-app homebrew content editor. Collections are structured drafts
// stored in IndexedDB (localStore.homebrew); Save & Ingest generates compatible XML and
// uploads it under the stable path homebrew/<slug>.xml, so re-saving edits in place.
const HomebrewEditor = forwardRef(function HomebrewEditor(
  {
    beforeLibraryMutation,
    libraryPhase = "content",
    libraryProgress,
    libraryRevision = 0,
    onLibraryChanged,
    onLibraryMutationFinished,
  },
  ref,
) {
  const [collections, setCollections] = useState(null);
  const [draft, setDraft] = useState(null);
  const [selectedElementId, setSelectedElementId] = useState(null);
  const [newType, setNewType] = useState(ELEMENT_TYPES[0]);
  const [busy, setBusy] = useState(false);
  const [ingestResult, setIngestResult] = useState(null);
  const [inspectorView, setInspectorView] = useState("xml");
  const [xmlScope, setXmlScope] = useState("collection");
  const [elementSearch, setElementSearch] = useState("");
  const [draftSaveState, setDraftSaveState] = useState("saved");
  const [copyResult, setCopyResult] = useState(null);
  const [mobilePane, setMobilePane] = useState("library");
  const draftRef = useRef(draft);
  const persistTimerRef = useRef(null);
  const collectionRequestRef = useRef(0);
  const observedLibraryRevision = useRef(libraryRevision);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const refreshList = useCallback(() => {
    localStore
      .listHomebrew()
      .then((records) =>
        setCollections(
          [...records].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
        ),
      )
      .catch(() => setCollections([]));
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

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

  useImperativeHandle(
    ref,
    () => ({
      flushPendingDraft,
    }),
    [flushPendingDraft],
  );

  // Debounce-persist the working draft so edits survive tab switches without an
  // explicit save (Save & Ingest additionally regenerates + uploads the XML).
  useEffect(() => {
    if (!draft) return undefined;
    window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      void flushPendingDraft().catch(() => {});
    }, 600);
    return () => window.clearTimeout(persistTimerRef.current);
  }, [draft, flushPendingDraft]);

  useEffect(() => {
    if (observedLibraryRevision.current === libraryRevision) return;
    observedLibraryRevision.current = libraryRevision;
    refreshList();
  }, [libraryRevision, refreshList]);

  const selectedElement =
    draft?.elements.find((el) => el.localId === selectedElementId) ?? null;
  const canRemoveContent = typeof api.content.remove === "function";

  const collectionXml = useMemo(
    () => (draft ? buildCollectionXml(draft) : ""),
    [draft],
  );

  const elementXml = useMemo(
    () =>
      selectedElement && draft ? buildElementXml(selectedElement, draft) : "",
    [draft, selectedElement],
  );

  const previewElement = useMemo(
    () =>
      selectedElement && draft
        ? buildHomebrewPreviewElement(selectedElement, draft)
        : null,
    [draft, selectedElement],
  );

  const inspectorXml =
    xmlScope === "element" && selectedElement ? elementXml : collectionXml;
  const copyStatus =
    copyResult?.xml === inspectorXml ? copyResult.status : null;

  const updateDraft = useCallback((updater) => {
    setDraft((previous) => {
      if (!previous) return previous;
      const next = typeof updater === "function" ? updater(previous) : updater;
      if (!next || next === previous) return next;
      return {
        ...next,
        hasUnloadedChanges: Boolean(previous.ingestedAt),
      };
    });
    setDraftSaveState("saving");
  }, []);

  const selectCollection = async (id) => {
    if (!id || id === draftRef.current?.id) return;
    const requestId = ++collectionRequestRef.current;
    try {
      await flushPendingDraft();
      const record = await localStore.getHomebrew(id);
      if (!record || requestId !== collectionRequestRef.current) return;
      setDraft(record);
      setSelectedElementId(null);
      setIngestResult(null);
      setInspectorView("xml");
      setXmlScope("collection");
      setElementSearch("");
      setDraftSaveState("saved");
      setMobilePane("editor");
    } catch (error) {
      setIngestResult({
        ok: false,
        errors: [{ where: "Storage", message: error.message }],
      });
    }
  };

  const createNewCollection = async () => {
    ++collectionRequestRef.current;
    const record = createCollection("New Collection");
    try {
      await flushPendingDraft();
      await localStore.putHomebrew(record);
      setDraft(record);
      setSelectedElementId(null);
      setIngestResult(null);
      setInspectorView("xml");
      setXmlScope("collection");
      setElementSearch("");
      setDraftSaveState("saved");
      setMobilePane("editor");
      refreshList();
    } catch (error) {
      setIngestResult({
        ok: false,
        errors: [{ where: "Storage", message: error.message }],
      });
    }
  };

  // Collection meta edits. Slug and abbreviation auto-derive from the name until the user
  // edits them directly or the collection is first ingested (the slug is the upload path,
  // so it must stay stable once the engine holds a file under it).
  const setCollectionField = (key, value) => {
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

  const addElement = () => {
    const element = createElement(newType);
    updateDraft((prev) => ({
      ...prev,
      elements: [...prev.elements, element],
    }));
    setSelectedElementId(element.localId);
    setInspectorView("preview");
    setXmlScope("element");
    setMobilePane("editor");
  };

  const changeElement = (next) => {
    updateDraft((prev) => ({
      ...prev,
      elements: prev.elements.map((el) =>
        el.localId === next.localId ? next : el,
      ),
    }));
  };

  const removeElement = (localId) => {
    const element = draft.elements.find((el) => el.localId === localId);
    if (
      !window.confirm(
        `Remove "${element?.name ?? "this element"}" from the collection? It disappears from the library the next time you update the builder.`,
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

  const saveAndIngest = async () => {
    if (!draft) return;
    const errors = validateDraft(draft);
    if (errors.length) {
      setIngestResult({ ok: false, errors });
      return;
    }
    setBusy(true);
    setIngestResult(null);
    try {
      await beforeLibraryMutation?.();
      await localStore.putHomebrew(draft); // draft JSON is the source of truth
      const xml = buildCollectionXml(draft);
      const file = new File([xml], collectionFileName(draft), {
        type: "application/xml",
      });
      const result = await api.content.upload([file], UPLOAD_CATEGORY);
      api.content.clearCache();
      await onLibraryChanged?.({ source: "homebrew", result });

      const path = collectionFilePath(draft);
      const diagnostics = (result.diagnostics ?? []).filter(
        (d) => d.file && d.file.endsWith(path),
      );
      const rejected = (result.files ?? []).filter((f) => !f.accepted);

      if (diagnostics.length === 0 && rejected.length === 0) {
        // Ingested clean: freeze element ids (stable across renames / re-uploads).
        const locked = {
          ...draft,
          ingestedAt: Date.now(),
          hasUnloadedChanges: false,
          elements: draft.elements.map((el) => ({
            ...el,
            id: resolveElementId(el, draft),
            idLocked: true,
          })),
        };
        await localStore.putHomebrew(locked);
        setDraft(locked);
        setDraftSaveState("saved");
        setIngestResult({ ok: true, count: result.elementCountAfterReload });
      } else {
        setIngestResult({ ok: false, diagnostics, rejected });
      }
      refreshList();
    } catch (e) {
      setIngestResult({
        ok: false,
        errors: [{ where: "Ingest", message: e.message }],
      });
    } finally {
      setBusy(false);
      onLibraryMutationFinished?.();
    }
  };

  // Download of the generated collection XML.
  const download = () => {
    if (!draft) return;
    const url = URL.createObjectURL(
      new Blob([buildCollectionXml(draft)], { type: "application/xml" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = collectionFileName(draft);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const deleteCollection = async () => {
    if (!draft) return;
    if (
      !window.confirm(
        `Delete the collection "${draft.name}"? This removes the draft${draft.ingestedAt ? " and unloads its content from the library" : ""}. Characters using its elements will lose those picks.`,
      )
    )
      return;
    setBusy(true);
    try {
      await beforeLibraryMutation?.();
      let result = { characterReloadRequired: false };
      if (draft.ingestedAt && canRemoveContent) {
        result = await api.content.remove([collectionFilePath(draft)]);
        api.content.clearCache();
      }
      await localStore.deleteHomebrew(draft.id);
      setDraft(null);
      setSelectedElementId(null);
      setIngestResult(null);
      setInspectorView("xml");
      setXmlScope("collection");
      setElementSearch("");
      setDraftSaveState("saved");
      setMobilePane("library");
      refreshList();
      await onLibraryChanged?.({ source: "homebrew", result });
    } catch (e) {
      setIngestResult({
        ok: false,
        errors: [{ where: "Delete", message: e.message }],
      });
    } finally {
      setBusy(false);
      onLibraryMutationFinished?.();
    }
  };

  const visibleElements = useMemo(() => {
    const query = elementSearch.trim().toLowerCase();
    if (!draft || !query) return draft?.elements ?? [];
    return draft.elements.filter((element) =>
      `${element.name} ${element.type}`.toLowerCase().includes(query),
    );
  }, [draft, elementSearch]);

  const selectCollectionDetails = () => {
    setSelectedElementId(null);
    setInspectorView("xml");
    setXmlScope("collection");
    setMobilePane("editor");
  };

  const selectElement = (element) => {
    setSelectedElementId(element.localId);
    setXmlScope("element");
    setInspectorView("preview");
    setMobilePane("editor");
  };

  const copyInspectorXml = async () => {
    try {
      await navigator.clipboard.writeText(inspectorXml);
      setCopyResult({ xml: inspectorXml, status: "Copied" });
    } catch {
      setCopyResult({ xml: inspectorXml, status: "Copy failed" });
    }
  };

  return (
    <div aria-labelledby="homebrew-editor-title">
      <div className="fcb-page-heading fcb-homebrew-heading">
        <h1 id="homebrew-editor-title">Homebrew</h1>
        <p>Author your own spells, feats, items, and features.</p>
      </div>

      <HomebrewToolbar
        collections={collections}
        draft={draft}
        busy={busy}
        draftSaveState={draftSaveState}
        onCollectionChange={selectCollection}
        onNewCollection={createNewCollection}
        onLoad={saveAndIngest}
        onDownload={download}
        onDelete={deleteCollection}
      />

      {busy ? (
        <div
          data-testid="hb-ingest-progress"
          className="fcb-homebrew-ingest-result"
        >
          <ContentLoadingProgress
            phase={libraryPhase}
            progress={libraryProgress}
            fallbackMessage="Preparing content update…"
          />
        </div>
      ) : (
        <IngestResult result={ingestResult} />
      )}

      <div className={`fcb-homebrew-workspace is-mobile-${mobilePane}`}>
        <HomebrewNavigator
          draft={draft}
          busy={busy}
          selectedElementId={selectedElementId}
          elementSearch={elementSearch}
          visibleElements={visibleElements}
          newType={newType}
          onCollectionDetails={selectCollectionDetails}
          onElementSearch={setElementSearch}
          onElementType={setNewType}
          onAddElement={addElement}
          onSelectElement={selectElement}
          onRemoveElement={removeElement}
        />

        <section
          id="hb-main-editor"
          className="fcb-homebrew-editor min-w-0"
          data-testid="hb-main-editor"
          aria-label="Homebrew editor"
        >
          <button
            type="button"
            data-testid="hb-mobile-back"
            className="fcb-button fcb-homebrew-mobile-back"
            onClick={() => setMobilePane("library")}
          >
            Back to elements
          </button>
          {!draft && (
            <section className="fcb-panel">
              <div className="fcb-panel-body">
                <p className="fcb-empty-copy">
                  Create or select a collection to edit its contents.
                </p>
              </div>
            </section>
          )}
          {draft && !selectedElement && (
            <CollectionDetails
              draft={draft}
              busy={busy}
              onFieldChange={setCollectionField}
            />
          )}
          {draft && selectedElement && (
            <ElementForm
              key={selectedElement.localId}
              element={selectedElement}
              collection={draft}
              disabled={busy}
              onChange={changeElement}
            />
          )}
        </section>

        <HomebrewInspector
          draft={draft}
          selectedElement={selectedElement}
          previewElement={previewElement}
          inspectorView={inspectorView}
          xmlScope={xmlScope}
          inspectorXml={inspectorXml}
          copyStatus={copyStatus}
          onViewChange={setInspectorView}
          onScopeChange={setXmlScope}
          onCopy={copyInspectorXml}
        />
      </div>
    </div>
  );
});

function HomebrewToolbar({
  collections,
  draft,
  busy,
  draftSaveState,
  onCollectionChange,
  onNewCollection,
  onLoad,
  onDownload,
  onDelete,
}) {
  const builderState = !draft?.ingestedAt
    ? "Not loaded into builder"
    : draft.hasUnloadedChanges
      ? "Changes not loaded into builder"
      : "Loaded into builder";
  const saveLabel =
    draftSaveState === "saving"
      ? "Saving…"
      : draftSaveState === "error"
        ? "Save failed"
        : "Saved locally";

  return (
    <header
      className="fcb-panel fcb-homebrew-toolbar"
      role="toolbar"
      aria-label="Homebrew collection actions"
    >
      <label className="fcb-homebrew-collection-picker">
        <span className="fcb-homebrew-collection-label">Collection</span>
        <select
          data-testid="hb-collection-select"
          className="fcb-select"
          value={draft?.id ?? ""}
          onChange={(event) => onCollectionChange(event.target.value)}
          disabled={busy || !collections}
          aria-label="Collection"
        >
          <option value="" disabled>
            {collections ? "Select a collection" : "Loading collections…"}
          </option>
          {(collections ?? []).map((collection) => (
            <option key={collection.id} value={collection.id}>
              {collection.name} ({collection.elements?.length ?? 0})
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        data-testid="hb-new-collection"
        className="fcb-button fcb-homebrew-new-collection"
        onClick={onNewCollection}
        disabled={busy}
        aria-label="Create new collection"
        title="Create new collection"
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
        <span
          className={`fcb-homebrew-status-dot ${
            draftSaveState === "error" ? "is-error" : ""
          }`}
          aria-hidden="true"
        />
        <span className="fcb-homebrew-save-label">{saveLabel}</span>
        {draft && (
          <span className="fcb-homebrew-builder-state">{builderState}</span>
        )}
      </div>
      <div className="fcb-homebrew-toolbar-actions">
        <button
          type="button"
          data-testid="hb-save-ingest"
          className="fcb-button fcb-button-primary"
          onClick={onLoad}
          disabled={busy || !draft}
        >
          {busy
            ? "Working…"
            : draft?.ingestedAt
              ? "Update builder"
              : "Load into builder"}
        </button>
        <button
          type="button"
          data-testid="hb-download"
          className="fcb-button fcb-homebrew-download-button"
          onClick={onDownload}
          disabled={busy || !draft}
          aria-label="Download collection XML"
          title="Download collection XML"
        >
          <svg
            className="fcb-homebrew-download-icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M12 3v12m0 0 5-5m-5 5-5-5" />
            <path d="M5 20h14" />
          </svg>
          <span className="fcb-homebrew-download-label">Download XML</span>
        </button>
        <button
          type="button"
          className="fcb-icon-button fcb-homebrew-delete-collection"
          onClick={onDelete}
          disabled={busy || !draft}
          aria-label="Delete collection"
          title="Delete collection"
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
      {result && !result.ok && (
        <div className="fcb-alert" role="alert">
          <p className="font-semibold">
            Could not load this collection — fix these and retry:
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
  busy,
  selectedElementId,
  elementSearch,
  visibleElements,
  newType,
  onCollectionDetails,
  onElementSearch,
  onElementType,
  onAddElement,
  onSelectElement,
  onRemoveElement,
}) {
  return (
    <aside className="fcb-panel fcb-homebrew-library">
      <nav aria-label="Elements in collection">
        <button
          type="button"
          className={`fcb-homebrew-nav-row ${
            draft && !selectedElementId ? "is-active" : ""
          }`}
          onClick={onCollectionDetails}
          disabled={!draft}
          aria-current={draft && !selectedElementId ? "page" : undefined}
          aria-controls="hb-main-editor"
        >
          <span>Edit collection details</span>
          <small>Name, description and source settings</small>
        </button>
        <div className="fcb-homebrew-library-heading">
          <div>
            <h2>Elements</h2>
            <span>{draft?.elements.length ?? 0}</span>
          </div>
          {draft && (
            <label className="fcb-homebrew-search-field">
              <span>Search collection elements</span>
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

        <div
          id="hb-element-list"
          data-testid="hb-element-list"
          className="fcb-homebrew-element-list"
        >
          {!draft && (
            <p className="fcb-empty-copy">
              Select a collection to browse its elements.
            </p>
          )}
          {draft?.elements.length === 0 && (
            <p className="fcb-empty-copy">
              No elements yet. Choose a type below to add one.
            </p>
          )}
          {draft &&
            draft.elements.length > 0 &&
            visibleElements.length === 0 && (
              <p className="fcb-empty-copy">
                No elements match this search.
              </p>
            )}
          {visibleElements.map((element) => (
            <div className="fcb-homebrew-element-row" key={element.localId}>
              <button
                type="button"
                className={`fcb-homebrew-nav-row ${
                  selectedElementId === element.localId ? "is-active" : ""
                }`}
                onClick={() => onSelectElement(element)}
                aria-current={
                  selectedElementId === element.localId ? "page" : undefined
                }
              >
                <span>{element.name || `New ${element.type}`}</span>
                <small>{element.type}</small>
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
        <select
          data-testid="hb-element-type"
          className="fcb-select"
          value={newType}
          onChange={(event) => onElementType(event.target.value)}
          disabled={busy || !draft}
          aria-label="New element type"
        >
          {ELEMENT_TYPE_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.types.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
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

function CollectionDetails({ draft, busy, onFieldChange }) {
  return (
    <section className="fcb-panel">
      <header className="fcb-panel-header">
        <div>
          <h2 className="fcb-panel-title">Collection details</h2>
          <p className="fcb-panel-subtitle">
            Edit the source information shared by every element.
          </p>
        </div>
      </header>
      <div className="fcb-panel-body space-y-4">
        <label className="fcb-field-label">
          Name
          <input
            data-testid="hb-collection-name"
            className="fcb-input normal-case"
            value={draft.name}
            onChange={(event) => onFieldChange("name", event.target.value)}
            disabled={busy}
          />
        </label>
        <label className="fcb-field-label">
          Description
          <textarea
            rows={8}
            className="fcb-textarea normal-case"
            value={draft.description}
            onChange={(event) =>
              onFieldChange("description", event.target.value)
            }
            disabled={busy}
            placeholder="What this collection contains (shown on its Source element)"
          />
        </label>
        <label className="fcb-field-label">
          Rules version
          <select
            data-testid="hb-collection-ruleset"
            className="fcb-select"
            value={normalizeCollectionRuleset(draft.ruleset)}
            onChange={(event) =>
              onFieldChange("ruleset", event.target.value)
            }
            disabled={busy}
          >
            {RULESET_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <span className="text-xs normal-case tracking-normal text-[var(--fcb-text-faint)]">
            Sets the default rules version for entries in this collection.
          </span>
        </label>
        <details className="fcb-homebrew-advanced">
          <summary>Advanced source settings</summary>
          <div className="fcb-homebrew-advanced-grid">
            <label className="fcb-field-label">
              Abbreviation
              <input
                className="fcb-input"
                value={draft.abbreviation}
                onChange={(event) =>
                  onFieldChange("abbreviation", event.target.value)
                }
                disabled={busy}
              />
            </label>
            <label className="fcb-field-label">
              File slug
              <input
                className="fcb-input"
                value={draft.slug}
                onChange={(event) => onFieldChange("slug", event.target.value)}
                disabled={busy || Boolean(draft.ingestedAt)}
                title={
                  draft.ingestedAt
                    ? "Locked after the first load: the slug is the upload path."
                    : undefined
                }
              />
            </label>
          </div>
        </details>
        <p className="fcb-homebrew-file-path">
          Generated file: <code>{collectionFilePath(draft)}</code>
        </p>
      </div>
    </section>
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
              <option value="collection">Entire collection</option>
            </select>
          </label>
        )}
      </header>
      <div className="fcb-homebrew-inspector-body">
        {!draft && (
          <p className="fcb-empty-copy">
            Select a collection to inspect its generated XML.
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
