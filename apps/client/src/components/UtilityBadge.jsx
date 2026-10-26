// The state badge in the corner of a top-bar utility (Drive sync, autosave).
// Each state carries its own glyph as well as its colour, so colour is never
// the only signal; the control's tooltip and accessible name say it in words.
const GLYPHS = {
  // A tick: connected, or saving by itself.
  on: <path d="m3.5 6.2 1.7 1.7 3.3-3.6" />,
  // A slash: not connected, or off.
  off: <path d="M3.8 8.2 8.2 3.8" />,
  // An exclamation mark: needs attention.
  warn: (
    <>
      <path d="M6 3.4v3" />
      <path d="M6 8.5v.1" />
    </>
  ),
  // An open arc: working.
  busy: <path d="M8.6 6A2.6 2.6 0 1 1 6 3.4" />,
};

export default function UtilityBadge({ state }) {
  return (
    <span
      aria-hidden="true"
      className={`fcb-utility-badge is-${state}`}
      data-badge={state}
    >
      <svg
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
        viewBox="0 0 12 12"
      >
        {GLYPHS[state] ?? GLYPHS.off}
      </svg>
    </span>
  );
}
