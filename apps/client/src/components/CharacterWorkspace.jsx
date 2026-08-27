import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { applyLibraryRevision } from "../libraryLifecycle.js";
import { WorkspaceContext } from "./WorkspaceContext";
import BuildTab from "./tabs/BuildTab";
import { useMigrationIssues } from "../hooks/useMigrationIssues";
import { clearSheetCache } from "./sheetCache";
import {
  createLatestRequestGate,
  loadMutationWorkspaceData,
  loadWorkspaceData,
  shouldRefreshWorkspaceOnActivation,
  storeResourceIfCurrent,
} from "./workspaceData";
import { splitViewPreference } from "./workspacePreferences";
import {
  DesktopWorkspaceNavigation,
  MobileWorkspaceNavigation,
} from "./WorkspaceNavigation";
import CharacterLoadingState from "./CharacterLoadingState";
import ContentLoadingProgress from "./ContentLoadingProgress";
import Icon from './Icon';
import SaveButton from "./SaveButton";
import UndoButton from "./UndoButton";
import useAutosaveSetting from "../hooks/useAutosaveSetting";
import useUnsavedChanges from "../hooks/useUnsavedChanges";
import useUndoAvailable from "../hooks/useUndoAvailable";
import { isMobileViewport } from "../layoutBreakpoints";
import { SPLIT_VIEW_STORAGE_KEY } from "../storageNames.js";

const MagicTab = lazy(() => import("./tabs/MagicTab"));
const EquipmentTab = lazy(() => import("./tabs/EquipmentTab"));
const ManageTab = lazy(() => import("./tabs/ManageTab"));
const SheetTab = lazy(() => import("./tabs/SheetTab"));
const SheetPreviewPanel = lazy(() => import("./SheetPreviewPanel"));
const LevelUpFlyout = lazy(() => import("./LevelUpFlyout"));
const MigrationDrawer = lazy(() => import("./MigrationDrawer"));

const panelFallback = <p className="fcb-empty-copy">Loading section…</p>;
const DEFAULT_CHARACTER_LOAD_STATE = {
  id: null,
  active: true,
  percentage: null,
  message: "Preparing character data…",
  error: null,
};

// A persisted localStorage key: renaming it silently resets the preference for
// everyone who already set it.
const SPLIT_VIEW_KEY = SPLIT_VIEW_STORAGE_KEY;

// Below this viewport width the split layout would have to stack the sheet under the
// editor — scrolling to it is no quicker than opening the SHEET tab, so the preview
// (and its toggle) disappear entirely and no PDFs regenerate in the background.
const SPLIT_MIN_WORKSPACE_WIDTH = 1185;

// Library-backed pickers may remain mounted while the character workspace is hidden. Keep
// their refresh lifecycle independent from React effects so a revision is requested once,
// obsolete responses cannot publish, and a failed request remains retryable.
export function createLibraryPickerRefreshController(initialRevision = null) {
  const completedRevisions = new Map();
  const latestGenerations = new Map();
  const inFlightRequests = new Map();

  return {
    request(revision, active, operation, requestKey = "default") {
      const completedRevision = completedRevisions.has(requestKey)
        ? completedRevisions.get(requestKey)
        : initialRevision;
      if (!active || revision <= completedRevision) return null;
      const inFlight = inFlightRequests.get(requestKey);
      if (inFlight?.revision === revision) return inFlight.promise;

      const generation = (latestGenerations.get(requestKey) ?? 0) + 1;
      latestGenerations.set(requestKey, generation);
      const promise = Promise.resolve()
        .then(operation)
        .then(
          (value) => {
            const stale = generation !== latestGenerations.get(requestKey);
            if (!stale) {
              completedRevisions.set(requestKey, revision);
              inFlightRequests.delete(requestKey);
            }
            return { stale, value };
          },
          (error) => {
            if (generation === latestGenerations.get(requestKey)) {
              inFlightRequests.delete(requestKey);
            }
            throw error;
          },
        );
      inFlightRequests.set(requestKey, { revision, promise });
      return promise;
    },
  };
}

// The per-character shell: the main tab strip, the persistent action bar
// (Level Up & XP, character badge) and the live statistics ribbon.
export default function CharacterWorkspace({
  active = true,
  id,
  libraryCharacterReloadRequired,
  libraryBusy = false,
  libraryPhase = "idle",
  libraryProgress,
  libraryRevision = 0,
  notice = null,
  onDismissNotice,
  registerSectionDeactivate,
}) {
  const [tab, setTab] = useState("build");
  const [detail, setDetail] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loadState, setLoadState] = useState(() => {
    return api.characters.getLoadState?.() ?? DEFAULT_CHARACTER_LOAD_STATE;
  });
  const [busy, setBusy] = useState(false);
  // Surface the mutation lock as a document-wide busy cursor: inputs are
  // disabled while a choice is writing, and the cursor communicates why.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("fcb-busy-cursor", busy || libraryBusy);
    return () => root.classList.remove("fcb-busy-cursor");
  }, [busy, libraryBusy]);
  const [levelUpOpen, setLevelUpOpen] = useState(false);
  // Sheet generation occupies the same serialized worker as edits. Keep it opt-in for new
  // workspaces so a low-priority PDF cannot sit ahead of user input; stored choices persist.
  const [splitView, setSplitView] = useState(() => {
    return splitViewPreference(localStorage.getItem(SPLIT_VIEW_KEY));
  });
  const [splitFits, setSplitFits] = useState(false);
  // Bumped after every successful mutation; the live sheet preview regenerates from it.
  const [mutationTick, setMutationTick] = useState(0);
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);
  const resourceCache = useRef(new Map());
  const workspaceRef = useRef(null);
  const mainRef = useRef(null);
  const subbarRef = useRef(null);
  const interactionScrollRef = useRef(null);
  const primaryScrollRef = useRef(null);
  const detailsScrollRef = useRef(null);
  const primaryScrollPositions = useRef(new Map());
  const activeTabRef = useRef(tab);
  const wasActiveRef = useRef(active);
  const appliedLibraryRevision = useRef(libraryRevision);
  const skipActivationRefreshRevision = useRef(null);
  const refreshRequestGate = useRef(createLatestRequestGate());
  const [libraryEngineInitialRevision] = useState(libraryRevision);
  // The controller is created once per character; later revisions must remain retryable state.
  const libraryEngineRefresh = useMemo(
    () => ({
      id,
      controller: createLibraryPickerRefreshController(
        libraryEngineInitialRevision,
      ),
    }),
    [id, libraryEngineInitialRevision],
  );
  // The action buttons render into the topbar's slot (App.jsx) so they share the header
  // row instead of occupying their own subbar row.
  const [actionsSlot, setActionsSlot] = useState(null);
  const [tabDetailSlot, setTabDetailSlot] = useState(null);

  // Manual save: with autosave off the toolbar shows a Save button (and
  // Ctrl/Cmd+S) that writes the character's pending edits on demand.
  const { autosaveEnabled } = useAutosaveSetting();
  const unsaved = useUnsavedChanges(id);
  const [saving, setSaving] = useState(false);
  const saveNow = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await api.characters.saveCharacter(id);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }, [id]);
  useEffect(() => {
    if (!active || autosaveEnabled) return undefined;
    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (unsaved && !saving) void saveNow();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, autosaveEnabled, unsaved, saving, saveNow]);

  useEffect(() => {
    refreshRequestGate.current.begin();
    resourceCache.current.clear();
    // The cross-mount sheet cache is keyed by (id, mutationTick); mutationTick resets to 0 on
    // a fresh workspace mount, so drop any stale bytes for this character to avoid a tick-0
    // collision with a previous session's sheet.
    clearSheetCache(id);
  }, [id]);

  useEffect(() => {
    // Deferred so the state lands in a callback, not synchronously in the effect
    // (react-hooks/set-state-in-effect); the topbar is committed by the time it runs.
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      setActionsSlot(document.getElementById("fcb-topbar-actions"));
      setTabDetailSlot(document.getElementById("fcb-char-tab-detail"));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The export menu opens downward from the portaled topbar and can overlap the
  // sticky workspace subbar. Raise the owning layer while the workspace action
  // portal is live so the menu remains a real pointer target.
  useEffect(() => {
    const topbar = actionsSlot?.closest(".fcb-topbar");
    if (!topbar || !active || !detail) return undefined;
    const previousZIndex = topbar.style.zIndex;
    topbar.style.zIndex = "32";
    return () => {
      topbar.style.zIndex = previousZIndex;
    };
  }, [actionsSlot, active, detail]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return undefined;
    const apply = () =>
      setSplitFits(workspace.clientWidth >= SPLIT_MIN_WORKSPACE_WIDTH);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  // Sticky offsets (section-nav strip, description panel, sheet preview) are computed from
  // the subbar's height, which grows when its toolbar wraps on narrow viewports — measure
  // it into the CSS variable instead of hardcoding per breakpoint.
  useEffect(() => {
    const workspace = workspaceRef.current;
    const subbar = subbarRef.current;
    if (!workspace || !subbar) return undefined;
    const apply = () =>
      workspace.style.setProperty(
        "--fcb-subbar-h",
        `${subbar.offsetHeight}px`,
      );
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(subbar);
    return () => observer.disconnect();
  }, []);

  // Transient confirmation messages (e.g. "Added Longsword to your inventory").
  const notify = useCallback((message) => {
    const nextId = ++toastId.current;
    setToasts((current) => [...current.slice(-3), { id: nextId, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== nextId));
    }, 2800);
  }, []);

  const refresh = useCallback(() => {
    const request = refreshRequestGate.current.begin();
    // State is set inside the promise callbacks (never synchronously) so this can
    // be driven straight from an effect without react-hooks/set-state-in-effect.
    return loadWorkspaceData(api.characters, id)
      .then(({ detail: next, stats: nextStats }) => {
        if (!refreshRequestGate.current.isCurrent(request)) return;
        setError(null);
        setDetail(next);
        setStats(nextStats);
      })
      .catch((e) => {
        if (refreshRequestGate.current.isCurrent(request)) {
          setError(e.message);
        }
      });
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof api.characters.onLoadProgress !== "function") return undefined;
    return api.characters.onLoadProgress((next) => {
      if (!next.id || next.id === id) setLoadState(next);
    });
  }, [id]);

  // Runs an API mutation; if it returns a character detail payload it becomes
  // the new state, otherwise the workspace re-fetches.
  const getCachedResource = useCallback(
    (key, loader, { force = false } = {}) => {
      const cache = resourceCache.current;
      const existing = cache.get(key);
      if (!force && existing?.data !== undefined)
        return Promise.resolve(existing.data);
      if (!force && existing?.promise) return existing.promise;

      const promise = Promise.resolve()
        .then(loader)
        .then((data) => {
          storeResourceIfCurrent(cache, key, promise, data);
          return data;
        })
        .catch((e) => {
          if (cache.get(key)?.promise === promise) cache.delete(key);
          throw e;
        });
      cache.set(key, { promise });
      return promise;
    },
    [],
  );

  const setCachedResource = useCallback((key, data) => {
    resourceCache.current.set(key, { data });
  }, []);

  const invalidateCache = useCallback((prefix) => {
    for (const key of resourceCache.current.keys()) {
      if (!prefix || key.startsWith(prefix)) resourceCache.current.delete(key);
    }
  }, []);

  const invalidateLibraryCaches = useCallback(() => {
    invalidateCache("");
    api.content.clearCache?.();
  }, [invalidateCache]);

  // The engine-side spellbook snapshot refresh is optional while older artifacts are
  // in circulation. The client still refreshes its read models; a matching engine artifact can
  // additionally rebuild retained caster snapshots through one shared, retryable request.
  const ensureLibraryRevisionReady = useCallback(
    (revision, isActive) => {
      if (
        !isActive ||
        libraryCharacterReloadRequired !== false ||
        typeof revision !== "number"
      ) {
        return Promise.resolve({ stale: false, value: null, skipped: true });
      }
      const refreshSpellLibrary =
        api.characters.refreshSpellLibrary ??
        api.characters.refreshSpellcasting ??
        api.characters.refreshSpellbook;
      const request = libraryEngineRefresh.controller.request(
        revision,
        isActive,
        () => refreshSpellLibrary?.(id),
      );
      return (
        request ?? Promise.resolve({ stale: false, value: null, skipped: true })
      );
    },
    [id, libraryCharacterReloadRequired, libraryEngineRefresh],
  );

  useEffect(() => {
    if (appliedLibraryRevision.current === libraryRevision) return;
    appliedLibraryRevision.current = libraryRevision;
    if (libraryCharacterReloadRequired === false) {
      skipActivationRefreshRevision.current = libraryRevision;
    } else {
      skipActivationRefreshRevision.current = null;
    }
    applyLibraryRevision({
      characterReloadRequired: libraryCharacterReloadRequired,
      invalidateCache: invalidateLibraryCaches,
      invalidateSheet: () => clearSheetCache(id),
      active,
      refresh: () => void refresh(),
    });
  }, [
    active,
    id,
    invalidateLibraryCaches,
    libraryCharacterReloadRequired,
    libraryRevision,
    refresh,
  ]);

  useEffect(() => {
    const shouldRefresh = shouldRefreshWorkspaceOnActivation(
      wasActiveRef.current,
      active,
    );
    wasActiveRef.current = active;
    if (!shouldRefresh) return;
    if (skipActivationRefreshRevision.current === libraryRevision) {
      skipActivationRefreshRevision.current = null;
      return;
    }
    invalidateLibraryCaches();
    clearSheetCache(id);
    void refresh();
  }, [active, id, invalidateLibraryCaches, libraryRevision, refresh]);

  const registerPrimaryScroll = useCallback((node) => {
    primaryScrollRef.current = node;
    if (node && !isMobileViewport()) {
      node.scrollTop =
        primaryScrollPositions.current.get(activeTabRef.current) ?? 0;
    }
  }, []);

  const registerDetailsScroll = useCallback((node) => {
    detailsScrollRef.current = node;
  }, []);

  const capturePaneScroll = useCallback(
    () => ({
      primary: primaryScrollRef.current?.scrollTop ?? 0,
      details: detailsScrollRef.current?.scrollTop ?? 0,
    }),
    [],
  );

  const restorePaneScroll = useCallback((position) => {
    if (!position) return;
    window.requestAnimationFrame(() => {
      if (primaryScrollRef.current) {
        primaryScrollRef.current.scrollTop = position.primary ?? 0;
      }
      if (detailsScrollRef.current) {
        detailsScrollRef.current.scrollTop = position.details ?? 0;
      }
    });
  }, []);

  const preserveDesktopScrollOnPointerDown = useCallback((event) => {
    const target = event.target;
    if (target instanceof Element && target.closest(".fcb-export-menu")) return;
    if (isMobileViewport()) return;
    const position = capturePaneScroll();
    interactionScrollRef.current = position;
    window.requestAnimationFrame(() => {
      if (interactionScrollRef.current === position) {
        interactionScrollRef.current = null;
      }
    });
  }, [capturePaneScroll]);

  // Overlapping mutations queue in order instead of racing: selection cards
  // stay clickable while a choice is writing, and each queued edit runs
  // against the state its predecessor produced (the engine worker serializes
  // writes anyway; this keeps the client-side snapshot handling in order).
  const runChainRef = useRef(Promise.resolve());
  const runNow = useCallback(
    async (operation, options = {}) => {
      if (libraryBusy) {
        const libraryError = new Error(
          "The content library is updating. Try this edit again in a moment.",
        );
        setError(libraryError.message);
        throw libraryError;
      }
      const { refreshDetail = true, invalidateSelectionOptions = true } =
        options;
      const scrollPosition = isMobileViewport()
        ? null
        : (interactionScrollRef.current ?? capturePaneScroll());
      refreshRequestGate.current.begin();
      setBusy(true);
      setError(null);
      try {
        const result = await operation();
        if (invalidateSelectionOptions) invalidateCache("selection-options:");
        // Any mutation can change spellcasting (new class/feature) or inventory
        // (granted equipment), so those tab caches must not survive it. Tabs that
        // mutate re-seed the cache with the fresh payload right after this.
        invalidateCache("spellcasting:");
        invalidateCache("spell-browse:");
        invalidateCache("companion:");
        invalidateCache("inventory:");
        invalidateCache("attacks:");
        const snapshot = await loadMutationWorkspaceData(
          api.characters,
          id,
          result,
          { refreshDetail },
        );
        if (snapshot.detail) setDetail(snapshot.detail);
        setStats(snapshot.stats);
        setMutationTick((t) => t + 1);
        return result;
      } catch (e) {
        setError(e.message);
        throw e;
      } finally {
        setBusy(false);
        restorePaneScroll(scrollPosition);
      }
    },
    [capturePaneScroll, id, invalidateCache, libraryBusy, restorePaneScroll],
  );
  const run = useCallback(
    (operation, options = {}) => {
      const task = runChainRef.current
        .catch(() => undefined)
        .then(() => runNow(operation, options));
      runChainRef.current = task;
      return task;
    },
    [runNow],
  );

  // Undo restores the engine copy from before the latest edit in either
  // autosave mode; it goes through the mutation queue so the workspace
  // refreshes like any change.
  const undoAvailable = useUndoAvailable(id);
  const undoLast = useCallback(
    () => run(() => api.characters.undoLastChange(id)),
    [id, run],
  );

  const statValue = (key) => stats?.values?.[key];

  // Content-update migration: persists the engine's first-load `loadIssues`
  // (IndexedDB) until every affected choice is re-picked or dismissed, and
  // drives the drawer + warning banner below.
  const migration = useMigrationIssues({ id, detail, notify });
  const closeMigrationDrawer = migration.closeDrawer;

  useEffect(
    () =>
      registerSectionDeactivate?.(() => {
        setLevelUpOpen(false);
        closeMigrationDrawer();
      }),
    [closeMigrationDrawer, registerSectionDeactivate],
  );

  const toggleSplitView = () => {
    setSplitView((current) => {
      const next = !current;
      localStorage.setItem(SPLIT_VIEW_KEY, next ? "1" : "0");
      return next;
    });
  };

  const selectTab = (nextTab) => {
    if (!isMobileViewport()) {
      primaryScrollPositions.current.set(
        tab,
        primaryScrollRef.current?.scrollTop ?? 0,
      );
    }
    activeTabRef.current = nextTab;
    setTab(nextTab);
    if (!isMobileViewport()) return;
    window.requestAnimationFrame(() => {
      mainRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
  };

  useEffect(() => {
    if (isMobileViewport()) return undefined;
    const handle = window.requestAnimationFrame(() => {
      if (primaryScrollRef.current) {
        primaryScrollRef.current.scrollTop =
          primaryScrollPositions.current.get(tab) ?? 0;
      }
      if (detailsScrollRef.current) detailsScrollRef.current.scrollTop = 0;
    });
    return () => window.cancelAnimationFrame(handle);
  }, [tab]);

  // Export (portable .dnd5e / .dnd5e-pkg) lives in the top bar's storage
  // group (App renders the ExportMenu beside Drive sync and autosave); the
  // sheet PDF has its own download on the SHEET tab.

  // The SHEET tab already fills the page with the PDF, so split view applies elsewhere;
  // it only activates when the measured workspace is at least the split threshold.
  const splitActive = active && splitView && splitFits && tab !== "sheet";
  const currentLoadState =
    loadState.id === id ? loadState : DEFAULT_CHARACTER_LOAD_STATE;
  const loadingMessage =
    currentLoadState.message === "Character ready"
      ? "Finishing workspace…"
      : currentLoadState.message;
  const retryInitialLoad = () => {
    setError(null);
    setDetail(null);
    setStats(null);
    void refresh();
  };

  return (
    <WorkspaceContext.Provider
      value={{
        id,
        detail,
        stats,
        busy: busy || libraryBusy,
        // Selection cards stay interactive during ordinary mutations (edits
        // queue); only a content-library rebuild genuinely invalidates them.
        selectionBusy: libraryBusy,
        error,
        run,
        refresh,
        statValue,
        getCachedResource,
        setCachedResource,
        invalidateCache,
        notify,
        mutationTick,
        libraryRevision,
        active,
        libraryCharacterReloadRequired,
        createLibraryPickerRefreshController: (initialRevision) =>
          createLibraryPickerRefreshController(initialRevision),
        ensureLibraryRevisionReady,
        // Migration surface: rules already carry `wasInvalidated` on the first
        // load after a content change, but reloads after the engine's autosave
        // only have the persisted set — BuildTab/SelectionRuleCard read it here.
        pendingMigration: migration.pending,
        migrationWarning: migration.warning,
        openMigrationDrawer: migration.openDrawer,
        registerPrimaryScroll,
        registerDetailsScroll,
        resetPrimaryScroll: () => {
          if (primaryScrollRef.current) primaryScrollRef.current.scrollTop = 0;
        },
      }}
    >
      <div
        className="fcb-workspace"
        data-testid="migration-contract"
        hidden={!active}
        ref={workspaceRef}
        onPointerDownCapture={preserveDesktopScrollOnPointerDown}
      >
        {actionsSlot &&
          active &&
          detail &&
          createPortal(
            <div className="fcb-toolbar">
              <UndoButton
                available={undoAvailable}
                disabled={libraryBusy || busy}
                onUndo={undoLast}
              />
              {!autosaveEnabled && (
                <SaveButton
                  dirty={unsaved}
                  saving={saving}
                  disabled={libraryBusy}
                  onSave={saveNow}
                />
              )}
              <button
                aria-label="Level Up & XP"
                className="fcb-button fcb-level-up-button"
                disabled={libraryBusy}
                onClick={() => setLevelUpOpen(true)}
                title="Level Up & XP"
              >
                <span className="fcb-level-up-label">Level Up & XP</span>
                <svg
                  aria-hidden="true"
                  className="fcb-level-up-icon"
                  viewBox="0 0 24 24"
                >
                  <path d="M11 18V5m0 0-5 5m5-5 5 5" />
                  <path d="M19 15v6m-3-3h6" />
                </svg>
              </button>
              {splitFits && (
                <button
                  onClick={toggleSplitView}
                  className={`fcb-icon-button ${splitView ? "fcb-status-complete" : ""}`}
                  aria-pressed={splitView}
                  aria-label="Split View"
                  title="Show the character sheet beside the editor"
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                  >
                    <rect
                      x="1.5"
                      y="2.5"
                      width="5"
                      height="11"
                      rx="1"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                    <rect
                      x="9.5"
                      y="2.5"
                      width="5"
                      height="11"
                      rx="1"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                  </svg>
                </button>
              )}
            </div>,
            actionsSlot,
          )}
        {tabDetailSlot &&
          detail &&
          createPortal(
            <>
              Level {detail.level} — {detail.class}
            </>,
            tabDetailSlot,
          )}
        <div className="fcb-subbar" ref={subbarRef}>
          <div className="fcb-subbar-inner">
            <DesktopWorkspaceNavigation activeTab={tab} onSelect={selectTab} />
            {detail && (
              <div className="fcb-subbar-stats">
                {[
                  ["HP", "Hit Points", statValue("hp")],
                  ["AC", "Armor Class", detail.armorClass],
                  ["INIT", "Initiative", detail.initiative],
                  ["PROF", "Proficiency", detail.proficiency],
                  ["SPEED", "Speed", detail.speed],
                ].map(([label, full, value]) => (
                  <span key={label} className="fcb-stat-pill" title={full}>
                    <strong>{value ?? "—"}</strong> {label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {(notice ||
          libraryBusy ||
          migration.pending.length > 0 ||
          (error && detail)) && (
          <div className="fcb-workspace-alerts">
            {notice && (
              <div className="fcb-shell-notice mx-6 mt-4" role="status">
                <span>{notice}</span>
                <button
                  aria-label="Dismiss notice"
                  onClick={onDismissNotice}
                  type="button"
                >
                  <Icon name="close" />
                </button>
              </div>
            )}
            {libraryBusy && (
              <div className="fcb-alert fcb-library-update-alert mx-6 mt-4">
                <ContentLoadingProgress
                  phase={libraryPhase}
                  progress={
                    libraryPhase === "character"
                      ? currentLoadState
                      : libraryProgress?.active
                        ? libraryProgress
                        : currentLoadState
                  }
                  fallbackMessage="Refreshing the open character…"
                />
              </div>
            )}
            {migration.pending.length > 0 && (
              <button
                type="button"
                data-testid="migration-banner"
                onClick={migration.openDrawer}
                className="fcb-warning-banner mx-6 mt-4 flex items-center gap-2 rounded-[var(--fcb-radius)] border px-3 py-2 text-left text-sm font-semibold"
              >
                <span className="fcb-tab-dot shrink-0" aria-hidden="true" />
                {migration.pending.length}{" "}
                {migration.pending.length === 1
                  ? "choice needs"
                  : "choices need"}{" "}
                attention after a content update
                <span className="ml-auto text-xs font-bold uppercase tracking-wide">
                  Review
                </span>
              </button>
            )}
            {error && <p className="fcb-alert mx-6 mt-4">{error}</p>}
          </div>
        )}

        <main
          className={`fcb-main fcb-workspace-main ${
            !detail ? "is-loading" : ""
          }`}
          ref={mainRef}
          aria-busy={libraryBusy || (!detail && !error)}
        >
          {!detail && (
            <CharacterLoadingState
              characterName={id}
              message={loadingMessage}
              percentage={currentLoadState.percentage}
              error={error}
              onRetry={retryInitialLoad}
            />
          )}
          {detail && (
            <div
              className={`fcb-workspace-content ${splitActive ? "fcb-split-layout" : ""}`}
            >
              <div className={`fcb-editor-pane fcb-editor-pane--${tab}`}>
                {tab === "build" && <BuildTab />}
                <Suspense fallback={panelFallback}>
                  {tab === "magic" && <MagicTab />}
                  {tab === "equipment" && <EquipmentTab />}
                  {tab === "manage" && <ManageTab />}
                  {tab === "sheet" && active && <SheetTab />}
                </Suspense>
              </div>
              {splitActive && (
                <Suspense fallback={panelFallback}>
                  <SheetPreviewPanel />
                </Suspense>
              )}
            </div>
          )}
        </main>

        <MobileWorkspaceNavigation activeTab={tab} onSelect={selectTab} />

        {active && levelUpOpen && (
          <Suspense fallback={null}>
            <LevelUpFlyout onClose={() => setLevelUpOpen(false)} />
          </Suspense>
        )}

        {active && migration.drawerOpen && (
          <Suspense fallback={null}>
            <MigrationDrawer
              onClose={migration.closeDrawer}
              onDismissAll={migration.dismissAll}
            />
          </Suspense>
        )}

        {toasts.length > 0 && (
          <div className="fcb-toast-stack" role="status" aria-live="polite">
            {toasts.map((toast) => (
              <div key={toast.id} className="fcb-toast">
                {toast.message}
              </div>
            ))}
          </div>
        )}
      </div>
    </WorkspaceContext.Provider>
  );
}
