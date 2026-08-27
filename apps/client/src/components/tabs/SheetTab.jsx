import { useEffect, useMemo, useState } from 'react';
import { shell } from '@shell';
import { api } from '../../api';
import useSheetTemplateSetting from '../../hooks/useSheetTemplateSetting';
import useSheetColoursSetting from '../../hooks/useSheetColoursSetting';
import useSheetFontsSetting from '../../hooks/useSheetFontsSetting';
import { loadSheetBrandImage } from '../../sheetBrandImage.js';
import { useWorkspace } from '../WorkspaceContext';
import PdfCanvasViewer from '../PdfCanvasViewer';
import WorkspaceTabLayout from '../WorkspaceTabLayout';
import Icon from '../Icon';
import {
  sheetCacheKey,
  getCachedSheet,
  putCachedSheet,
  sharedSheetGeneration,
} from '../sheetCache';

// CHARACTER SHEET tab. The full sheet (all card pages): api.characters.sheetBytes returns
// raw PDF bytes generated in-browser by the engine, rendered to a scroll-preserving pdf.js
// canvas. Shares the cross-mount sheet cache with the Split View preview so tab round-trips
// reuse work, and the Download link builds a blob URL from the same bytes.
export default function SheetTab() {
  const {
    id,
    mutationTick,
    libraryRevision = 0,
    active,
    registerPrimaryScroll,
  } = useWorkspace();
  const [nonce, setNonce] = useState(0);
  const [zoom, setZoom] = useState(1); // sheet PDF zoom (1 = fit width); useful on phones
  const { templateSet } = useSheetTemplateSetting();
  const { colours, coloursKey } = useSheetColoursSetting();
  const { fonts, fontsKey } = useSheetFontsSetting();
  // Debounced view of mutationTick: a burst of cascading mutations (multi-step
  // selections, level-ups) folds into one full-sheet regeneration instead of
  // rendering once per tick. Seeded from the current tick so the first mount
  // generates immediately.
  const [debouncedTick, setDebouncedTick] = useState(mutationTick);
  useEffect(() => {
    if (!active || debouncedTick === mutationTick) return undefined;
    const handle = window.setTimeout(() => setDebouncedTick(mutationTick), 250);
    return () => window.clearTimeout(handle);
  }, [active, debouncedTick, mutationTick]);
  // Only written from the async resolution; `loading` is derived by comparing keys.
  const [state, setState] = useState({ key: null, bytes: null, error: null });
  const key = `${id}#${libraryRevision}#${debouncedTick}#${templateSet}#${coloursKey}#${fontsKey}#${nonce}`;

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const runKey = key;
    const cacheKey = sheetCacheKey(
      id,
      debouncedTick,
      false,
      libraryRevision,
      templateSet,
      coloursKey,
      fontsKey,
    );

    // Manual Regenerate (nonce > 0) always re-renders; automatic loads may serve the cache.
    // Deferred to a microtask so the state lands in a callback, not synchronously in the
    // effect body (react-hooks/set-state-in-effect).
    if (nonce === 0) {
      const cached = getCachedSheet(cacheKey);
      if (cached) {
        Promise.resolve().then(() => {
          if (!cancelled) setState({ key: runKey, bytes: cached, error: null });
        });
        return () => {
          cancelled = true;
        };
      }
    }

    // Share one generation across StrictMode's doubled dev mount: both effect runs await the
    // same promise (keyed by runKey, incl. the manual-refresh nonce), and each sets state only
    // if its own cleanup hasn't cancelled it — so the surviving mount always renders.
    sharedSheetGeneration(runKey, () =>
      loadSheetBrandImage().then((brandImage) =>
        api.characters.sheetBytes(id, { lite: false, templateSet, colours, fonts, brandImage, footerText: `Generated with ${shell.appName}.` })),
    )
      .then((bytes) => {
        putCachedSheet(cacheKey, bytes);
        if (!cancelled) setState({ key: runKey, bytes, error: null });
      })
      .catch((e) => {
        if (!cancelled)
          setState({ key: runKey, bytes: null, error: e.message });
      });

    return () => {
      cancelled = true;
    };
  }, [active, id, key, libraryRevision, debouncedTick, nonce, templateSet, colours, coloursKey, fonts, fontsKey]);

  const ready = state.key === key;
  const bytes = ready ? state.bytes : null;
  const error = ready ? state.error : null;

  // Build a blob URL for the download link from the current bytes (revoked on change/unmount).
  const downloadUrl = useMemo(() => {
    if (!bytes) return null;
    return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  }, [bytes]);
  useEffect(
    () => () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    },
    [downloadUrl],
  );
  useEffect(() => {
    if (!bytes) return;
    // Browser verification and host integrations can inspect the latest generated
    // handoff without reaching into the React cache.
    globalThis.__FCB_SHEET_BYTES__ = bytes;
  }, [bytes]);

  return (
    <WorkspaceTabLayout
      as="section"
      panel
      className="fcb-sheet-tab"
      data-sheet-bytes={bytes?.byteLength ?? 0}
    >
      {/* The sheet is the content, so its controls float over the page's top
          right rather than costing a full-width bar above it. */}
      <div className="fcb-toolbar fcb-sheet-float">
        <div className="fcb-sheet-zoom" role="group" aria-label="Zoom sheet">
          <button
            className="fcb-icon-button fcb-sheet-zoom-button"
            onClick={() =>
              setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))
            }
            disabled={!ready || zoom <= 0.5}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <Icon name="remove" />
          </button>
          <button
            className="fcb-button fcb-sheet-zoom-value"
            onClick={() => setZoom(1)}
            disabled={!ready}
            title="Reset zoom to fit width"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            className="fcb-icon-button fcb-sheet-zoom-button"
            onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}
            disabled={!ready || zoom >= 3}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <Icon name="add" />
          </button>
        </div>
        <button
          onClick={() => setNonce((n) => n + 1)}
          className="fcb-icon-button"
          disabled={!ready}
          aria-label={
            ready ? 'Regenerate character sheet' : 'Generating character sheet'
          }
          title={
            ready ? 'Regenerate character sheet' : 'Generating character sheet'
          }
        >
          <Icon name="refresh" />
        </button>
        <a
          href={downloadUrl ?? undefined}
          download={`${id}.pdf`}
          aria-disabled={!downloadUrl}
          aria-label="Save character sheet"
          title="Save character sheet"
          className={`fcb-button fcb-button-primary ${downloadUrl ? '' : 'pointer-events-none opacity-50'}`}
        >
          <Icon name="save" />
          Save
        </a>
      </div>
      <div className="fcb-panel-body fcb-sheet-body">
        {!ready && (
          <p className="fcb-empty-copy">Generating character sheet…</p>
        )}
        {ready && error && <p className="fcb-alert">{error}</p>}
        {ready && bytes && (
          <PdfCanvasViewer
            bytes={bytes}
            zoom={zoom}
            scrollRef={registerPrimaryScroll}
            className="w-full rounded border border-[var(--fcb-border)] bg-[var(--fcb-surface)]"
          />
        )}
      </div>
    </WorkspaceTabLayout>
  );
}
