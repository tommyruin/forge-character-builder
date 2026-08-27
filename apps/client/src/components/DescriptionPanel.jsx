import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import ContentRenderer from './ContentRenderer';

// The right-hand description pane shown next to every selection surface.
// Element descriptions are parsed into a safe React tree by ContentRenderer
// instead of injected as raw HTML.
export default function DescriptionPanel({
  elementId,
  placeholder,
  hideEmptyOnMobile = false,
  scrollRef,
  onReturn,
  onContentReady,
  returnLabel = 'Back to list',
  detailsLabel = 'Details',
}) {
  const [state, setState] = useState({ id: null, element: null, error: null });
  const panelRef = useRef(null);

  const setPanelRef = useCallback(
    (node) => {
      panelRef.current = node;
      if (typeof scrollRef === 'function') scrollRef(node);
    },
    [scrollRef],
  );

  useEffect(() => {
    if (!elementId) return undefined;
    let cancelled = false;
    api.content
      .element(elementId)
      .then((element) => {
        if (!cancelled) setState({ id: elementId, element, error: null });
      })
      .catch((e) => {
        if (!cancelled)
          setState({ id: elementId, element: null, error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [elementId]);

  useEffect(() => {
    const handle = window.requestAnimationFrame(() => {
      panelRef.current?.scrollTo({ top: 0, left: 0 });
    });
    return () => window.cancelAnimationFrame(handle);
  }, [elementId]);

  const element = state.id === elementId ? state.element : null;
  const error = state.id === elementId ? state.error : null;
  const isEmpty = !element && !error;

  useEffect(() => {
    if ((!element && !error) || !onContentReady) return undefined;
    const handle = window.requestAnimationFrame(() => {
      onContentReady(panelRef.current);
    });
    return () => window.cancelAnimationFrame(handle);
  }, [element, error, onContentReady]);

  return (
    <aside
      className={`fcb-panel fcb-description-panel ${
        isEmpty && hideEmptyOnMobile ? 'is-mobile-hidden-when-empty' : ''
      } ${onReturn ? 'is-mobile-navigation-target' : ''}`}
    >
      {/* The panel clips to its radius and this region scrolls: a scrollbar is
          painted on the border box, so a rounded panel that scrolls itself
          gets a straight track down the edge wherever the platform draws
          classic scrollbars. It is also the focus and scroll target the mobile
          navigation reports through scrollRef. */}
      <div
        ref={setPanelRef}
        aria-label={onReturn ? detailsLabel : undefined}
        tabIndex={onReturn ? -1 : undefined}
        className="fcb-description-scroll"
      >
      {elementId && onReturn && (
        <button
          type="button"
          className="fcb-button fcb-description-return"
          data-testid="description-return"
          aria-label={returnLabel}
          onClick={onReturn}
        >
          ← {returnLabel}
        </button>
      )}
      {isEmpty && (
        <div className="fcb-panel-body">
          <p className="fcb-empty-copy">
            {placeholder ?? 'Select an option to read about it'}
          </p>
        </div>
      )}
      {error && (
        <div className="fcb-panel-body">
          <p className="fcb-alert">{error}</p>
        </div>
      )}
      {element && (
        <div className="fcb-panel-body">
          <ContentRenderer element={element} />
        </div>
      )}
      </div>
    </aside>
  );
}
