/**
 * The layout thresholds the app actually navigates by. Everything else in
 * index.css is local polish for one component.
 *
 * - MOBILE_VIEWPORT_QUERY (820/821px): the viewport switch between the mobile
 *   shell (bottom nav, document scroll) and the desktop shell (app-height
 *   panes that own their own scrolling).
 * - The `fcb-pane` container queries at 1080/1081px and 700px: how a tab
 *   reflows inside its editor pane — section rail to pill strip, then two
 *   columns to one. These key off the pane, not the viewport, so Split View
 *   collapses a tab exactly like a narrow window does.
 */
export const MOBILE_VIEWPORT_QUERY = '(max-width: 820px)';

/** True when the viewport is in the mobile shell. Safe before hydration. */
export function isMobileViewport() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia(MOBILE_VIEWPORT_QUERY).matches
  );
}
