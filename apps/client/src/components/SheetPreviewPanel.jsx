import { useEffect, useRef, useState } from 'react';
import { shell } from '@shell';
import { api } from '../api';
import useSheetTemplateSetting from '../hooks/useSheetTemplateSetting';
import useSheetColoursSetting from '../hooks/useSheetColoursSetting';
import useSheetFontsSetting from '../hooks/useSheetFontsSetting';
import useSheetPagesSetting from '../hooks/useSheetPagesSetting';
import useSheetAbilitySetting from '../hooks/useSheetAbilitySetting';
import { loadSheetBrandImage } from '../sheetBrandImage.js';
import { useWorkspace } from './WorkspaceContext';
import PdfCanvasViewer from './PdfCanvasViewer';
import { sheetCacheKey, getCachedSheet, putCachedSheet } from './sheetCache';

// Split-view companion panel: the character sheet rendered beside the editor, and kept in
// sync (debounced) with every workspace mutation. The sheet is the LITE variant (no card
// pages) — the fast path for a live preview, matching the deployed DM Forge site — and
// rendered to a scroll-preserving pdf.js canvas rather than a
// blob-URL iframe (which would reset scroll and flash blank on every regeneration). The engine
// worker serializes calls, so generation never races an in-flight edit.
export default function SheetPreviewPanel() {
  const { id, mutationTick, libraryRevision = 0, active } = useWorkspace();
  const { templateSet } = useSheetTemplateSetting();
  const { colours, coloursKey } = useSheetColoursSetting();
  const { fonts, fontsKey } = useSheetFontsSetting();
  const { pages, pagesKey } = useSheetPagesSetting();
  const { emphasizeAbilityModifiers } = useSheetAbilitySetting();
  const footerText = `Generated with ${shell.appName}.`;
  // What we want rendered: the latest debounced mutation tick (+ manual refreshes). Seeded from
  // the CURRENT tick (not 0) so a remount can hit the cross-mount cache immediately instead of
  // first generating a stale tick-0 sheet.
  const [target, setTarget] = useState(() => ({
    tick: mutationTick,
    nonce: 0,
  }));
  // The bytes currently displayed (kept visible until a newer render lands) + freshness key.
  const [state, setState] = useState({ key: null, bytes: null, error: null });
  const pumpBusy = useRef(false);
  const wanted = useRef(null); // { id, key, tick } the pump converges to
  const done = useRef(null); // key of the last finished generation (success or error)
  const alive = useRef(true);

  // Debounce mutation bursts (e.g. cascading selections) into one regeneration. Kept short:
  // the pump below coalesces anything that lands while a generation is already in flight.
  useEffect(() => {
    if (!active) return undefined;
    const handle = window.setTimeout(() => {
      setTarget((t) =>
        t.tick === mutationTick ? t : { ...t, tick: mutationTick },
      );
    }, 100);
    return () => window.clearTimeout(handle);
  }, [active, mutationTick]);

  const key = `${id}#${libraryRevision}#${target.tick}#${templateSet}#${coloursKey}#${fontsKey}#${pagesKey}#${emphasizeAbilityModifiers}#${target.nonce}`;

  // Serial pump: at most one generation in flight. When one lands, it regenerates only if the
  // wanted key moved on — the engine worker serializes calls, so firing one generation per
  // mutation would queue seconds of redundant renders behind each other. A manual Refresh
  // (nonce bump) bypasses the cache; automatic ticks may serve cached bytes instantly.
  useEffect(() => {
    if (!active) return undefined;
    // Revive after StrictMode's mount->cleanup->remount probe (the cleanup below sets
    // alive=false; refs persist across the probe, so it must be reset on effect re-run).
    alive.current = true;
    wanted.current = {
      id,
      key,
      tick: target.tick,
      nonce: target.nonce,
      libraryRevision,
      templateSet,
      colours,
      coloursKey,
      fonts,
      fontsKey,
      pages,
      pagesKey,
      emphasizeAbilityModifiers,
    };

    // Fast path: cached complete bytes for this tick (a remount or a tick we already rendered).
    // Deferred to a microtask so the state lands in a callback, not synchronously in the
    // effect body (react-hooks/set-state-in-effect).
    if (target.nonce === 0) {
      const cached = getCachedSheet(
        sheetCacheKey(id, target.tick, true, libraryRevision, templateSet, coloursKey, fontsKey, pagesKey, emphasizeAbilityModifiers),
      );
      if (cached) {
        done.current = key;
        const runKey = key;
        Promise.resolve().then(() => {
          if (alive.current)
            setState({ key: runKey, bytes: cached, error: null });
        });
        return undefined;
      }
    }

    if (pumpBusy.current) return undefined;
    pumpBusy.current = true;
    (async () => {
      try {
        while (alive.current && done.current !== wanted.current.key) {
          const run = wanted.current;
          try {
            const bytes = await api.characters.sheetBytes(run.id, {
              lite: true,
              templateSet: run.templateSet,
              colours: run.colours,
              fonts: run.fonts,
              emphasizeAbilityModifiers: run.emphasizeAbilityModifiers,
              include: run.pages,
              brandImage: await loadSheetBrandImage(),
              footerText,
            });
            if (!alive.current) return;
            putCachedSheet(
              sheetCacheKey(
                run.id,
                run.tick,
                true,
                run.libraryRevision,
                run.templateSet,
                run.coloursKey,
                run.fontsKey,
                run.pagesKey,
                run.emphasizeAbilityModifiers,
              ),
              bytes,
            );
            done.current = run.key;
            setState({ key: run.key, bytes, error: null });
          } catch (e) {
            done.current = run.key; // one attempt per key — no retry storm on persistent errors
            if (alive.current)
              setState((prev) => ({
                key: run.key,
                bytes: prev.bytes,
                error: e.message,
              }));
          }
        }
      } finally {
        pumpBusy.current = false;
      }
    })();
    return undefined;
  }, [active, id, key, libraryRevision, target.tick, target.nonce, templateSet, colours, coloursKey, fonts, fontsKey, pages, pagesKey, emphasizeAbilityModifiers, footerText]);

  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const generating = state.key !== key;
  const pendingChanges = target.tick !== mutationTick;
  const updating = generating || pendingChanges;

  return (
    <aside className="fcb-panel fcb-sheet-preview">
      {/* The sheet regenerates itself on every change, so there is no header
          and no refresh control: the only thing worth saying is that an update
          is in flight, and that floats over the page while it lasts. */}
      {updating && (
        <p
          className="fcb-sheet-preview-status is-stale"
          role="status"
          aria-live="polite"
        >
          <span className="fcb-boot-pill-spinner" aria-hidden="true" />
          {pendingChanges ? 'Changes pending…' : 'Updating sheet…'}
        </p>
      )}
      {state.error && !generating && (
        <p className="fcb-alert m-3">{state.error}</p>
      )}
      {state.bytes ? (
        <PdfCanvasViewer
          bytes={state.bytes}
          className="fcb-sheet-preview-canvas"
        />
      ) : (
        <div className="fcb-panel-body">
          <p className="fcb-empty-copy">
            Generating the first sheet preview…
          </p>
        </div>
      )}
    </aside>
  );
}
