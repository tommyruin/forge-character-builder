import { shell } from "@shell";
import { useDriveSyncState } from "../hooks/useDriveSyncState.js";
import useShellTheme from "../hooks/useShellTheme";
import useAutosaveSetting from "../hooks/useAutosaveSetting";
import AutosaveToggle from "./AutosaveToggle";

export function HeaderIcon({ name }) {
  const commonProps = {
    "aria-hidden": true,
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    viewBox: "0 0 24 24",
  };

  if (name === "theme-dark") {
    return (
      <svg {...commonProps}>
        <path d="M20.9 15.1A9 9 0 0 1 8.9 3.1 9 9 0 1 0 20.9 15.1Z" />
      </svg>
    );
  }
  if (name === "theme-retro") {
    return (
      <svg {...commonProps}>
        <path d="M8 2h8M9 2v4l-3 3v11h12V9l-3-3V2M8 12h8" />
      </svg>
    );
  }
  if (name === "theme-light") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
      </svg>
    );
  }
  if (name === "cloud") {
    return (
      <svg {...commonProps}>
        <path d="M7.5 18H17a4 4 0 0 0 .5-8 6 6 0 0 0-11.4-1.7A4.9 4.9 0 0 0 7.5 18Z" />
        <path d="m9 14 3-3 3 3m-3-3v8" />
      </svg>
    );
  }
  return (
    <svg {...commonProps}>
      <path d="M7 8h10v7a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4V8Zm10 2h1a2 2 0 1 1 0 4h-1M5 21h14" />
    </svg>
  );
}

// The global utilities live in the compact character bar. Three groups, left
// to right: `leading` (the open character's export, from App), storage (Drive
// sync, autosave), and site-wide (theme, and the host's support link when it
// has one). Each control is the same icon-only square; dividers mark the
// group boundaries.
export function TopbarUtilities({ leading = null, onCloudOpen }) {
  const { theme, toggleTheme } = useShellTheme();
  const { autosaveEnabled, toggleAutosave } = useAutosaveSetting();
  const drive = useDriveSyncState();
  const nextTheme = shell.theme.getNextTheme(theme);
  const support = shell.links.support;
  const driveState = drive.busy
    ? "syncing"
    : drive.connected
      ? "connected"
      : drive.status === "reconnect"
        ? "reconnect required"
        : "not connected";

  return (
    <div className="fcb-topbar-utilities" aria-label="Builder utilities">
      {leading}
      <button
        aria-label={`Open Drive sync (${driveState})`}
        className={`fcb-topbar-utility fcb-cloud-utility is-${drive.status}`}
        onClick={onCloudOpen}
        title={`Drive sync: ${driveState}`}
        type="button"
      >
        <HeaderIcon name="cloud" />
        <span className="fcb-cloud-utility-dot" aria-hidden="true" />
      </button>
      <AutosaveToggle enabled={autosaveEnabled} onToggle={toggleAutosave} />
      <span className="fcb-topbar-divider" aria-hidden="true" />
      <button
        aria-label={`Switch to ${nextTheme} theme`}
        className="fcb-topbar-utility"
        onClick={toggleTheme}
        title={`Switch to ${nextTheme} theme`}
        type="button"
      >
        <HeaderIcon name={`theme-${nextTheme}`} />
      </button>
      {support ? (
        <a
          aria-label={support.label}
          className="fcb-topbar-utility fcb-topbar-utility--support"
          href={support.href}
          rel="noopener noreferrer"
          target="_blank"
          title={support.title ?? support.label}
        >
          <HeaderIcon name="support" />
        </a>
      ) : null}
    </div>
  );
}

export default TopbarUtilities;
