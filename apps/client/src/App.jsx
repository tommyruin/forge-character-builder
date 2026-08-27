import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { shell } from '@shell';
import {
  createNavigationState,
  getGlobalNavigationTabs,
  navigationReducer,
} from './appNavigation.js';
import CharacterList from './components/CharacterList';
import BootSplash from './components/BootSplash';
import CharacterLoadingState from './components/CharacterLoadingState';
import { TopbarUtilities } from './components/TopbarUtilities';
import FastStartActivityNotice from './components/FastStartActivityNotice';
import { api } from './api.js';
import { autosaveSettingStore } from './autosaveSetting.js';
import useAutosaveSetting from './hooks/useAutosaveSetting';
import { prepareOpenCharacterForLibraryChange } from './libraryLifecycle.js';
import Icon from './components/Icon';
import ExportMenu from './components/ExportMenu';
import UnsavedChangesDialog from './components/UnsavedChangesDialog';

const loadCharacterWorkspace = () => import('./components/CharacterWorkspace');
const loadContentManager = () => import('./components/ContentManager');
const loadHomebrewEditor = () => import('./components/homebrew/HomebrewEditor');
const loadDriveSyncDrawer = () => import('./components/cloud/DriveSyncDrawer');
const CharacterWorkspace = lazy(loadCharacterWorkspace);
const ContentManager = lazy(loadContentManager);
const HomebrewEditor = lazy(loadHomebrewEditor);
const DriveSyncDrawer = lazy(loadDriveSyncDrawer);

const viewFallback = <p className="fcb-empty-copy">Loading view…</p>;
const isPublicRelease = import.meta.env.VITE_PUBLIC_RELEASE === 'true';
const DEFAULT_CONTENT_LOAD_STATE = {
  active: false,
  percentage: null,
  message: 'Content library ready',
  error: null,
};

export default function App() {
  const [navigation, dispatchNavigation] = useReducer(
    navigationReducer,
    undefined,
    createNavigationState,
  );
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [duplicateReviewRequested, setDuplicateReviewRequested] =
    useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryPhase, setLibraryPhase] = useState('idle');
  const [libraryCharacterReloadRequired, setLibraryCharacterReloadRequired] =
    useState(undefined);
  const [libraryProgress, setLibraryProgress] = useState(
    () => api.content.getLoadState?.() ?? DEFAULT_CONTENT_LOAD_STATE,
  );
  const [notice, setNotice] = useState(null);
  // A character switch held back by the unsaved-changes dialog (autosave off).
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [pendingSaving, setPendingSaving] = useState(false);
  const [pendingError, setPendingError] = useState(null);
  const { autosaveEnabled } = useAutosaveSetting();
  const topbarRef = useRef(null);
  const homebrewRef = useRef(null);
  const sectionDeactivateHandlers = useRef(new Set());
  const {
    activeSection,
    characterSurface,
    cloudOpen,
    openCharacterId,
    visitedSections,
  } = navigation;
  const workspaceActive =
    activeSection === 'characters' &&
    characterSurface === 'workspace' &&
    Boolean(openCharacterId);
  const globalTabs = getGlobalNavigationTabs(openCharacterId);

  // Warm the workspace chunk while the rules engine starts so opening a newly created
  // character does not leave the navigation absent during the first browser interaction.
  useEffect(() => {
    void loadCharacterWorkspace();
  }, []);

  useEffect(() => {
    const topbar = topbarRef.current;
    if (!topbar) return undefined;
    const apply = () =>
      document.documentElement.style.setProperty(
        '--fcb-topbar-h',
        `${topbar.offsetHeight}px`,
      );
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(topbar);
    return () => observer.disconnect();
  }, []);

  useEffect(() => api.content.onLoadProgress?.(setLibraryProgress), []);

  // With autosave off, closing the tab would lose the edits held in the
  // engine; the browser's own prompt is the only reliable guard there.
  useEffect(() => {
    const warnBeforeUnload = (event) => {
      if (autosaveSettingStore.getSnapshot()) return;
      if (!api.characters.hasUnsavedChanges?.()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, []);

  const registerSectionDeactivate = useCallback((handler) => {
    sectionDeactivateHandlers.current.add(handler);
    return () => sectionDeactivateHandlers.current.delete(handler);
  }, []);

  const deactivateTransientSurfaces = useCallback(() => {
    for (const handler of sectionDeactivateHandlers.current) handler();
  }, []);

  const selectSection = (section) => {
    if (section === 'content') void loadContentManager();
    if (section === 'homebrew') void loadHomebrewEditor();
    if (section !== activeSection) deactivateTransientSurfaces();
    dispatchNavigation({ type: 'select-section', section });
  };

  // Runs `proceed` at once unless the open character has unsaved edits under
  // manual save, in which case the dialog decides. Returning to the same
  // character never re-imports, so only a switch to another id can lose work.
  const guardUnsavedChanges = useCallback(
    (proceed) => {
      if (
        autosaveEnabled ||
        !openCharacterId ||
        !api.characters.hasUnsavedChanges?.(openCharacterId)
      ) {
        proceed();
        return;
      }
      setPendingError(null);
      setPendingNavigation({ characterId: openCharacterId, proceed });
    },
    [autosaveEnabled, openCharacterId],
  );

  const openCharacter = (id) => {
    const proceed = () => {
      deactivateTransientSurfaces();
      setNotice(null);
      try {
        globalThis.localStorage?.setItem('tcb-active-character', id);
      } catch {
        // Best effort only; the current tab still opens the character.
      }
      dispatchNavigation({ type: 'open-character', id });
    };
    if (id === openCharacterId) {
      proceed();
      return;
    }
    guardUnsavedChanges(proceed);
  };

  const resolvePendingNavigation = (proceed) => {
    setPendingNavigation(null);
    proceed();
  };

  const savePendingAndContinue = async () => {
    if (!pendingNavigation) return;
    setPendingSaving(true);
    setPendingError(null);
    try {
      await api.characters.saveCharacter(pendingNavigation.characterId);
      resolvePendingNavigation(pendingNavigation.proceed);
    } catch (error) {
      setPendingError(error.message);
    } finally {
      setPendingSaving(false);
    }
  };

  const discardPendingAndContinue = () => {
    if (!pendingNavigation) return;
    api.characters.discardUnsavedChanges?.(pendingNavigation.characterId);
    resolvePendingNavigation(pendingNavigation.proceed);
  };

  const showCollection = () => {
    deactivateTransientSurfaces();
    dispatchNavigation({ type: 'show-collection' });
  };

  const selectGlobalTab = (tab) => {
    if (tab.characterSurface === 'collection') {
      showCollection();
      return;
    }
    if (tab.characterSurface === 'workspace') {
      deactivateTransientSurfaces();
      setNotice(null);
      dispatchNavigation({ type: 'show-workspace' });
      return;
    }
    selectSection(tab.section);
  };

  const characterDeleted = (id) => {
    try {
      if (globalThis.localStorage?.getItem('tcb-active-character') === id) {
        globalThis.localStorage.removeItem('tcb-active-character');
      }
    } catch {
      // Best effort only.
    }
    dispatchNavigation({ type: 'character-deleted', id });
    if (id === openCharacterId) {
      setNotice(`“${id}” was removed from this device.`);
    }
  };

  const beforeLibraryMutation = useCallback(async () => {
    setLibraryBusy(true);
    setLibraryPhase('waiting');
    try {
      await api.characters.flushPendingSaves?.();
      await homebrewRef.current?.flushPendingDraft?.();
      setLibraryPhase('content');
    } catch (error) {
      setLibraryBusy(false);
      setLibraryPhase('idle');
      throw error;
    }
  }, []);

  const libraryChanged = useCallback(
    async ({
      source = 'content',
      message = null,
      result = null,
      characterReloadRequired,
    } = {}) => {
      const reloadRequired =
        characterReloadRequired ?? result?.characterReloadRequired;
      const replayRequired = source === 'cloud' ? false : reloadRequired;
      setLibraryCharacterReloadRequired(replayRequired);
      if (replayRequired !== false && openCharacterId) {
        setLibraryPhase('character');
      }
      // Loading new content invalidates the engine's current character. Reconcile the
      // retained workspace while the library action is still visibly working so the first
      // unopened picker does not inherit that several-second restore when the user returns.
      const characterRefreshError = await prepareOpenCharacterForLibraryChange(
        api.characters,
        source === 'cloud' ? null : openCharacterId,
        { characterReloadRequired: reloadRequired },
      );
      setLibraryRevision((revision) => revision + 1);
      setLibraryBusy(false);
      setLibraryPhase('finalizing');

      if (source === 'cloud' && openCharacterId) {
        const characters = await api.characters.list();
        if (!characters.some((character) => character.id === openCharacterId)) {
          dispatchNavigation({
            type: 'character-deleted',
            id: openCharacterId,
          });
          setNotice(
            `“${openCharacterId}” was removed by Drive sync. Showing your character collection.`,
          );
          return;
        }
      }

      setNotice(
        message ??
          (characterRefreshError
            ? `The content library was updated, but “${openCharacterId}” could not be refreshed yet. Returning to the character will retry automatically.`
            : source === 'cloud'
              ? 'Drive changes were applied to your local library.'
              : null),
      );
    },
    [openCharacterId],
  );

  const libraryMutationFinished = useCallback(() => {
    setLibraryBusy(false);
    setLibraryPhase('idle');
  }, []);

  return (
    <div
      className={`fcb-app-shell ${
        workspaceActive
          ? 'fcb-app-shell--workspace'
          : 'fcb-app-shell--library'
      }`}
    >
      <shell.Background />
      <BootSplash />
      <FastStartActivityNotice />
      <header
        className={`fcb-topbar fcb-topbar--${
          workspaceActive ? 'workspace' : 'library'
        }`}
        ref={topbarRef}
      >
        <div className="fcb-topbar-inner">
          <div className="dmf-versioned-brand fcb-topbar-brand">
            {shell.links.home ? (
              <a
                aria-label={shell.links.home.label}
                className="dmf-versioned-brand__home"
                href={shell.links.home.href}
              >
                <shell.Logo size={40} subtitle={null} />
              </a>
            ) : (
              <span className="dmf-versioned-brand__home">
                <shell.Logo size={40} subtitle={null} />
              </span>
            )}
            <shell.VersionStamp />
          </div>
          <nav
            className="fcb-primary-tabs fcb-global-tabs"
            aria-label="Character Builder sections"
          >
            {globalTabs.map((tab) => {
              const isActive =
                activeSection === tab.section &&
                (tab.characterSurface === null ||
                  characterSurface === tab.characterSurface);
              const isCharacterTab = tab.characterSurface === 'workspace';
              return (
                <button
                  key={tab.key}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={tab.label}
                  className={`fcb-tab ${
                    isCharacterTab ? 'fcb-tab-character' : ''
                  } ${isActive ? 'is-active' : ''}`}
                  onClick={() => selectGlobalTab(tab)}
                  onFocus={() => {
                    if (tab.key === 'content') void loadContentManager();
                    if (tab.key === 'homebrew') void loadHomebrewEditor();
                  }}
                  onMouseEnter={() => {
                    if (tab.key === 'content') void loadContentManager();
                    if (tab.key === 'homebrew') void loadHomebrewEditor();
                  }}
                  type="button"
                >
                  {isCharacterTab ? (
                    <span className="fcb-tab-character-copy">
                      <span className="fcb-tab-character-name">
                        {tab.label}
                      </span>
                      <span
                        className="fcb-tab-character-metadata"
                        id="fcb-char-tab-detail"
                      />
                    </span>
                  ) : (
                    <>
                      <span className="fcb-tab-label--full">
                        {tab.label}
                      </span>
                      <span
                        className="fcb-tab-label--compact"
                        aria-hidden="true"
                      >
                        {tab.compactLabel}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </nav>
          <div className="fcb-topbar-actions" id="fcb-topbar-actions" />
          <TopbarUtilities
            leading={
              workspaceActive ? (
                <ExportMenu
                  id={openCharacterId}
                  onError={setNotice}
                  variant="utility"
                  iconOnly
                />
              ) : null
            }
            onCloudOpen={() => {
              void loadDriveSyncDrawer();
              dispatchNavigation({ type: 'open-cloud' });
            }}
          />
        </div>
      </header>

      <div className="fcb-library-shell" hidden={workspaceActive}>
        <main className="fcb-main fcb-library-main">
          {notice && (
            <div className="fcb-shell-notice" role="status">
              <span>{notice}</span>
              <button
                aria-label="Dismiss notice"
                onClick={() => setNotice(null)}
                type="button"
              >
                <Icon name="close" />
              </button>
            </div>
          )}
          <section
            className="fcb-persistent-surface"
            hidden={
              activeSection !== 'characters' ||
              characterSurface !== 'collection'
            }
          >
            <CharacterList
              libraryRevision={libraryRevision}
              onDeleted={characterDeleted}
              onOpen={openCharacter}
              onPreloadWorkspace={loadCharacterWorkspace}
            />
          </section>
          {visitedSections.content && (
            <section
              className="fcb-persistent-surface"
              hidden={activeSection !== 'content'}
            >
              <Suspense fallback={viewFallback}>
                <ContentManager
                  active={activeSection === 'content'}
                  beforeLibraryMutation={beforeLibraryMutation}
                  duplicateReviewRequested={duplicateReviewRequested}
                  libraryRevision={libraryRevision}
                  onLibraryChanged={libraryChanged}
                  onLibraryMutationFinished={libraryMutationFinished}
                  onDuplicateReviewHandled={() =>
                    setDuplicateReviewRequested(false)
                  }
                  registerSectionDeactivate={registerSectionDeactivate}
                />
              </Suspense>
            </section>
          )}
          {visitedSections.homebrew && (
            <section
              className="fcb-persistent-surface"
              hidden={activeSection !== 'homebrew'}
            >
              <Suspense fallback={viewFallback}>
                <HomebrewEditor
                  ref={homebrewRef}
                  active={activeSection === 'homebrew'}
                  beforeLibraryMutation={beforeLibraryMutation}
                  libraryPhase={libraryPhase}
                  libraryProgress={libraryProgress}
                  libraryRevision={libraryRevision}
                  onLibraryChanged={libraryChanged}
                  onLibraryMutationFinished={libraryMutationFinished}
                />
              </Suspense>
            </section>
          )}
        </main>
      </div>

      {openCharacterId && (
        <Suspense
          fallback={
            workspaceActive ? (
              <main className="fcb-main fcb-workspace-main">
                <CharacterLoadingState
                  characterName={openCharacterId}
                  message="Loading character workspace…"
                />
              </main>
            ) : null
          }
        >
          {/* Keyed by the open character: the workspace holds per-character
              state that no single effect owns (the open tab, each panel's
              fetched rows, the resource cache), so switching characters
              remounts it rather than leaving the previous one on screen. */}
          <CharacterWorkspace
            key={openCharacterId}
            active={workspaceActive}
            id={openCharacterId}
            libraryCharacterReloadRequired={libraryCharacterReloadRequired}
            libraryBusy={libraryBusy}
            libraryPhase={libraryPhase}
            libraryProgress={libraryProgress}
            libraryRevision={libraryRevision}
            notice={workspaceActive ? notice : null}
            onDismissNotice={() => setNotice(null)}
            registerSectionDeactivate={registerSectionDeactivate}
          />
        </Suspense>
      )}

      {isPublicRelease && !workspaceActive && (
        <footer className="fcb-public-footer is-mobile-visible">
          <p>
            Characters are stored in this browser and travel as{' '}
            <code>.dnd5e</code> files.
          </p>
          <p>
            Sheet styling uses assets from the{' '}
            <a
              href="https://github.com/naturalcrit/homebrewery"
              target="_blank"
              rel="noreferrer"
            >
              Homebrewery
            </a>
            .
          </p>
          <p>
            Base release · SRD 5.1 and SRD 5.2.1 content only ·{' '}
            <a href={shell.links.legal.href}>
              Licences and SRD notices
            </a>
          </p>
        </footer>
      )}

      <UnsavedChangesDialog
        characterName={pendingNavigation?.characterId ?? ''}
        error={pendingError}
        onCancel={() => setPendingNavigation(null)}
        onDiscard={discardPendingAndContinue}
        onSave={() => {
          void savePendingAndContinue();
        }}
        open={pendingNavigation !== null}
        saving={pendingSaving}
      />

      {cloudOpen && (
        <Suspense fallback={null}>
          <DriveSyncDrawer
            beforeSync={beforeLibraryMutation}
            onClose={() => dispatchNavigation({ type: 'close-cloud' })}
            onLibraryChanged={libraryChanged}
            onReviewDuplicates={() => {
              void loadContentManager();
              dispatchNavigation({ type: 'close-cloud' });
              dispatchNavigation({
                type: 'select-section',
                section: 'content',
              });
              setDuplicateReviewRequested(true);
            }}
            onSyncFinished={libraryMutationFinished}
          />
        </Suspense>
      )}
    </div>
  );
}
