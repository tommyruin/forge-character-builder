import { useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// Vite bundles the worker locally via ?url — no CDN, so the fully-local (zero-backend)
// model and the strict no-external-host policy both hold.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
const standardFontDataUrl = `${import.meta.env.BASE_URL}pdfjs-standard-fonts/`;

/** Clean up optional pdf.js resources without turning teardown into a render error. */
export function cleanupPdfDocument(doc) {
  if (!doc || typeof doc.destroy !== 'function') return;
  try {
    const result = doc.destroy();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    // Teardown is best-effort after a render is superseded.
  }
}

function cleanupPdfLoadingTask(loadingTask) {
  if (!loadingTask || typeof loadingTask.destroy !== 'function') return;
  try {
    const result = loadingTask.destroy();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    // A cancelled loading task is not a user-visible render failure.
  }
}

// Renders PDF bytes to a stack of <canvas> pages inside a scrollable container. Unlike an
// <iframe src=blob:> — which fully re-initialises the browser's PDF viewer on every change,
// resetting scroll and flashing blank — this re-renders in place: pages are drawn to fresh
// canvases and swapped atomically, so the previous sheet stays visible until the new pixels
// are ready and the scroll position is preserved across regenerations.
export default function PdfCanvasViewer({
  bytes,
  className,
  zoom = 1,
  scrollRef,
}) {
  const containerRef = useRef(null);
  // Bumped on every new render request and on unmount; async work checks it and bails if a
  // newer render (or teardown) has superseded it.
  const tokenRef = useRef(0);

  useEffect(() => {
    if (!bytes || !bytes.length) return undefined;
    const tokenRefForCleanup = tokenRef;
    const token = ++tokenRef.current;
    let doc = null;
    let loadingTask = null;
    let renderTask = null;
    let documentDisposed = false;

    const disposeDocument = (candidate) => {
      if (!candidate || documentDisposed) return;
      documentDisposed = true;
      cleanupPdfDocument(candidate);
      if (doc === candidate) doc = null;
    };
    const cancelRenderTask = () => {
      if (!renderTask) return;
      try {
        renderTask.cancel();
      } catch {
        // A finished task cannot be cancelled; nothing to do.
      }
      renderTask = null;
    };

    (async () => {
      // getDocument({data}) transfers the buffer to the worker (detaching it); clone so the
      // caller's Uint8Array (and any cross-mount cache holding it) stays intact.
      loadingTask = pdfjsLib.getDocument({
        data: bytes.slice(),
        standardFontDataUrl,
      });
      const loadedDoc = await loadingTask.promise;
      doc = loadedDoc;
      loadingTask = null;
      if (token !== tokenRef.current) {
        disposeDocument(loadedDoc);
        return;
      }

      const container = containerRef.current;
      if (!container) {
        disposeDocument(loadedDoc);
        return;
      }
      const cssWidth = container.clientWidth || 600;
      // Cap the raster density: past 2x the extra pixels are invisible on the
      // sheet's vector art but multiply main-thread raster time and canvas memory.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      // First pass builds page geometry and blank, correctly-sized canvases —
      // rasterization happens per page below, visible pages first.
      const entries = [];
      for (let pageNumber = 1; pageNumber <= loadedDoc.numPages; pageNumber++) {
        if (token !== tokenRef.current) {
          disposeDocument(loadedDoc);
          return;
        }
        const page = await loadedDoc.getPage(pageNumber);
        const unscaled = page.getViewport({ scale: 1 });
        // zoom=1 fits page to container width (CSS width:100%, responsive); zoom!=1 renders
        // larger/smaller and pins an explicit CSS size so the container's overflow scrolls.
        const viewport = page.getViewport({
          scale: (cssWidth / unscaled.width) * zoom,
        });
        const canvas = document.createElement('canvas');
        canvas.className = 'fcb-pdf-page';
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        if (zoom !== 1) {
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
        }
        entries.push({ page, viewport, canvas, rendered: false });
      }

      const renderEntry = async (entry) => {
        if (entry.rendered) return;
        entry.rendered = true;
        renderTask = entry.page.render({
          canvasContext: entry.canvas.getContext('2d'),
          viewport: entry.viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        try {
          await renderTask.promise;
        } finally {
          renderTask = null;
        }
        // Yield to the event loop between pages so input and state updates
        // interleave with a long multi-page sheet render instead of waiting
        // for every page to finish on the main thread.
        await new Promise((resolve) => setTimeout(resolve, 0));
      };

      // Pages overlapping the current scroll window (with a viewport of margin)
      // rasterize before the swap so the user never sees a blank visible page;
      // the rest fill in afterwards where a superseding sheet can cancel them.
      const viewTop = container.scrollTop;
      const viewHeight =
        container.clientHeight || entries[0]?.viewport.height || 0;
      let offset = 0;
      const visible = [];
      for (const entry of entries) {
        const pageHeight = entry.viewport.height;
        const overlaps =
          offset < viewTop + viewHeight * 2 &&
          offset + pageHeight > viewTop - viewHeight;
        if (overlaps || visible.length === 0) visible.push(entry);
        offset += pageHeight;
      }
      for (const entry of visible) {
        if (token !== tokenRef.current) {
          disposeDocument(loadedDoc);
          return;
        }
        await renderEntry(entry);
      }

      if (token !== tokenRef.current) {
        disposeDocument(loadedDoc);
        return;
      }
      // Swap all pages in one shot, restoring scroll (replaceChildren keeps the
      // container element, so scrollTop is ours to preserve). Offscreen pages
      // attach blank and are painted by the background loop below.
      const scrollTop = container.scrollTop;
      container.replaceChildren(...entries.map((entry) => entry.canvas));
      container.scrollTop = scrollTop;

      for (const entry of entries) {
        if (token !== tokenRef.current) {
          disposeDocument(loadedDoc);
          return;
        }
        await renderEntry(entry);
      }
      disposeDocument(loadedDoc);
    })().catch((e) => {
      if (token === tokenRef.current)
        console.warn('[pdf-canvas] render failed', e);
    });

    // Bump the shared token so any in-flight render for this effect run bails (a newer render
    // or unmount has superseded it), and cancel the rasterization actually in flight — without
    // the cancel, a superseded sheet keeps burning main-thread time to completion.
    return () => {
      tokenRefForCleanup.current++;
      cancelRenderTask();
      disposeDocument(doc);
      cleanupPdfLoadingTask(loadingTask);
      loadingTask = null;
    };
  }, [bytes, zoom]);

  const setContainerRef = (node) => {
    containerRef.current = node;
    if (typeof scrollRef === 'function') scrollRef(node);
  };

  return (
    <div
      ref={setContainerRef}
      data-testid="sheet-canvas"
      className={`fcb-pdf-canvas ${className || ''}`}
    />
  );
}
