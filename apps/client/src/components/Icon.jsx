/**
 * The app's single icon registry. Every icon is drawn on a 24x24 grid with a
 * 1.8 stroke in currentColor, so any two icons sit together at the same weight
 * and inherit the surrounding text colour. Size comes from CSS
 * (`.fcb-icon`, plus the `-sm`/`-lg` variants), never per-call attributes.
 *
 * One action, one icon: pick the name that matches the action a control
 * performs rather than adding a near-duplicate glyph.
 */
const PATHS = {
  add: <path d="M12 5v14M5 12h14" />,
  remove: <path d="M5 12h14" />,
  delete: <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />,
  edit: (
    <>
      <path d="m4 20 4.2-1 10.7-10.7-3.2-3.2L5 15.8 4 20Z" />
      <path d="m14.8 6 3.2 3.2" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.75v.5" />
    </>
  ),
  export: (
    <>
      <path d="M12 15V3m0 0L8 7m4-4 4 4" />
      <path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
    </>
  ),
  import: (
    <>
      <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
      <path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4h-4" />
    </>
  ),
  randomize: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M9 9h.01M15 15h.01M15 9h.01M9 15h.01" />
    </>
  ),
  learn: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a2 2 0 0 0-2-1.5H5.5A1.5 1.5 0 0 1 4 16V5.5Z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a2 2 0 0 1 2-1.5h4.5A1.5 1.5 0 0 0 20 16V5.5Z" />
    </>
  ),
  clear: (
    <>
      <path d="M4 7h16" />
      <path d="M10 11v5m4-5v5" />
      <path d="M6 7h12l-1 12H7L6 7Z" />
    </>
  ),
  save: (
    <>
      <path d="M5 5a1 1 0 0 1 1-1h10l3 3v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5Z" />
      <path d="M8 4v5h7V4" />
      <path d="M8 19v-5h8v5" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </>
  ),
  // Circular arrows: the "keeps saving by itself" setting, distinct from the
  // disk that means "save now".
  autosave: (
    <>
      <path d="M20 12a8 8 0 0 0-13.7-5.7L4 8.5" />
      <path d="M4 4v4.5h4.5" />
      <path d="M4 12a8 8 0 0 0 13.7 5.7L20 15.5" />
      <path d="M20 20v-4.5h-4.5" />
    </>
  ),
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'move-up': (
    <>
      <path d="M12 19V5" />
      <path d="m6 11 6-6 6 6" />
    </>
  ),
  'move-down': (
    <>
      <path d="M12 5v14" />
      <path d="m6 13 6 6 6-6" />
    </>
  ),
  show: (
    <>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  hide: (
    <>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="m4 4 16 16" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16 9" />
    </>
  ),
  armor: (
    <>
      <path d="M12 3 19 6v5c0 4.5-2.8 8.1-7 10-4.2-1.9-7-5.5-7-10V6l7-3Z" />
      <path d="m8.5 12 2.2 2.2 4.8-4.8" />
    </>
  ),
  unequip: <path d="M12 5v14m0 0-5-5m5 5 5-5" />,
  attune: <path d="M9 7H7a4 4 0 0 0 0 8h2m6-8h2a4 4 0 0 1 0 8h-2M8 12h8" />,
  unattune: (
    <>
      <path d="M9 7H7a4 4 0 0 0 0 8h2m6-8h2a4 4 0 0 1 0 8h-2M8 12h8" />
      <path d="m5 5 14 14" />
    </>
  ),
  extract: (
    <>
      <path d="m4 9 3-5h10l3 5-3 3H7L4 9Z" />
      <path d="M12 20v-8m0 0-3 3m3-3 3 3" />
    </>
  ),
  'main-hand': (
    <>
      <path d="M6 18 18 6" />
      <path d="M14 4h6v6" />
      <path d="m4 20 3-1 1-3" />
    </>
  ),
  'off-hand': (
    <>
      <path d="M18 18 6 6" />
      <path d="M10 4H4v6" />
      <path d="m20 20-3-1-1-3" />
    </>
  ),
  'two-handed': <path d="M4 8h16M4 16h16M7 5v3m10-3v3M7 16v3m10-3v3" />,
  override: (
    <>
      <path d="M4 7h8m4 0h4M4 17h4m4 0h8" />
      <circle cx="14" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
};

export const ICON_NAMES = Object.keys(PATHS);

export default function Icon({ name, className }) {
  return (
    <svg
      aria-hidden="true"
      className={className ? `fcb-icon ${className}` : 'fcb-icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.8}
    >
      {PATHS[name] ?? <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}
