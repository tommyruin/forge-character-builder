import { useCallback, useEffect, useRef, useState } from 'react';
import { MOBILE_VIEWPORT_QUERY } from '../layoutBreakpoints';

// Keeps the wide-viewport side-panel interaction unchanged while making an explicit
// information-button press useful on mobile: move to the stacked description,
// then return to the exact list position and originating control.
export default function useMobileDescriptionNavigation({
  onInspect,
  registerDetailsScroll,
  returnLabel = 'Back to list',
  detailsLabel = 'Details',
}) {
  const [showReturn, setShowReturn] = useState(false);
  const panelRef = useRef(null);
  const returnStateRef = useRef(null);
  const pendingFrameRef = useRef(null);

  const registerPanel = useCallback(
    (node) => {
      panelRef.current = node;
      if (typeof registerDetailsScroll === 'function') {
        registerDetailsScroll(node);
      }
    },
    [registerDetailsScroll],
  );

  const focusDetails = useCallback((readyPanel) => {
    const panel = readyPanel ?? panelRef.current;
    const returnState = returnStateRef.current;
    if (!panel || !returnState) return;

    const { scrollOwner } = returnState;
    panel.scrollIntoView({ block: 'start', behavior: 'auto' });

    // scrollIntoView can be clamped while an asynchronous description is still
    // short. Once content is ready, correct any remaining offset explicitly.
    const panelTop = panel.getBoundingClientRect().top;
    const scrollOwnerTop = scrollOwner.getBoundingClientRect().top;
    const remainingOffset = panelTop - scrollOwnerTop;
    if (Math.abs(remainingOffset) > 1) {
      scrollOwner.scrollTo({
        top: scrollOwner.scrollTop + remainingOffset,
        left: scrollOwner.scrollLeft,
        behavior: 'auto',
      });
    }
    panel.focus({ preventScroll: true });
  }, []);

  const inspect = useCallback(
    (elementId, source) => {
      onInspect(elementId);
      if (!source || !window.matchMedia(MOBILE_VIEWPORT_QUERY).matches) {
        return;
      }

      const scrollOwner = source.closest('.fcb-workspace-main');
      if (!scrollOwner) return;

      returnStateRef.current = {
        source,
        sourceLabel: source.getAttribute('aria-label'),
        scrollOwner,
        scrollTop: scrollOwner.scrollTop,
        scrollLeft: scrollOwner.scrollLeft,
      };
      setShowReturn(true);
      if (pendingFrameRef.current != null) {
        window.cancelAnimationFrame(pendingFrameRef.current);
      }
      pendingFrameRef.current = window.requestAnimationFrame(() => {
        pendingFrameRef.current = null;
        focusDetails();
      });
    },
    [focusDetails, onInspect],
  );

  const returnToSource = useCallback(() => {
    if (pendingFrameRef.current != null) {
      window.cancelAnimationFrame(pendingFrameRef.current);
      pendingFrameRef.current = null;
    }
    const returnState = returnStateRef.current;
    returnStateRef.current = null;
    setShowReturn(false);
    if (!returnState) return;

    const restoreScroll = () => {
      returnState.scrollOwner.scrollTo({
        top: returnState.scrollTop,
        left: returnState.scrollLeft,
        behavior: 'auto',
      });
    };
    restoreScroll();
    window.requestAnimationFrame(() => {
      let source = returnState.source?.isConnected
        ? returnState.source
        : null;
      if (!source && returnState.sourceLabel) {
        const candidates = [
          ...returnState.scrollOwner.querySelectorAll('button[aria-label]'),
        ].filter(
          (candidate) =>
            candidate.getAttribute('aria-label') === returnState.sourceLabel,
        );
        source =
          candidates.find((candidate) => candidate.getClientRects().length) ??
          candidates[0] ??
          null;
      }
      if (source) {
        source.focus({ preventScroll: true });
      }
      // Focus should not move a nested or browser-specific scroll owner, but
      // restore once more so the caller's exact list position is the contract.
      restoreScroll();
    });
  }, []);

  const dismiss = useCallback(() => {
    if (pendingFrameRef.current != null) {
      window.cancelAnimationFrame(pendingFrameRef.current);
      pendingFrameRef.current = null;
    }
    returnStateRef.current = null;
    setShowReturn(false);
  }, []);

  useEffect(
    () => () => {
      if (pendingFrameRef.current != null) {
        window.cancelAnimationFrame(pendingFrameRef.current);
      }
    },
    [],
  );

  return {
    inspect,
    dismiss,
    descriptionPanelProps: {
      scrollRef: registerPanel,
      onReturn: showReturn ? returnToSource : undefined,
      onContentReady: showReturn ? focusDetails : undefined,
      returnLabel,
      detailsLabel,
    },
  };
}

export { MOBILE_VIEWPORT_QUERY };
