import { shell } from "@shell";
import { useDriveSyncState } from "../hooks/useDriveSyncState.js";
import useShellTheme from "../hooks/useShellTheme";
import useAutosaveSetting from "../hooks/useAutosaveSetting";
import AutosaveToggle from "./AutosaveToggle";
import ThemeMenu from "./ThemeMenu";
import UtilityBadge from "./UtilityBadge";

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

// What the Drive sync control says about the connection, in words and as a
// badge glyph.
export function describeDriveState(drive) {
  if (drive.busy) return { label: "syncing", badge: "busy" };
  if (drive.status === "error") return { label: "sync failed", badge: "warn" };
  if (drive.status === "reconnect") return { label: "reconnect required", badge: "warn" };
  if (drive.connected) return { label: "connected", badge: "on" };
  return { label: "not connected", badge: "off" };
}

// The theme menu lists the default theme first, then the rest in the shell's
// order.
export function themeMenuOrder(themeApi = shell.theme) {
  const themes = themeApi.AVAILABLE_THEMES;
  return themes.includes(themeApi.DEFAULT_THEME)
    ? [themeApi.DEFAULT_THEME, ...themes.filter((value) => value !== themeApi.DEFAULT_THEME)]
    : [...themes];
}

// The global utilities live in the compact character bar. Three groups, left
// to right: `leading` (the open character's export, from App), storage (Drive
// sync, autosave), and site-wide (theme, and the host's support link when it
// has one). Each control is the same icon-only square except the theme menu,
// which names the theme in use from 1280 px; dividers mark the group
// boundaries.
export function TopbarUtilities({ leading = null, onCloudOpen }) {
  const { theme, selectTheme } = useShellTheme();
  const { autosaveEnabled, toggleAutosave } = useAutosaveSetting();
  const drive = useDriveSyncState();
  const support = shell.links.support;
  const supportName = support ? (support.title ?? support.label) : null;
  const driveState = describeDriveState(drive);

  return (
    <div className="fcb-topbar-utilities" aria-label="Builder utilities">
      {leading}
      <button
        aria-label={`Open Drive sync (${driveState.label})`}
        className={`fcb-topbar-utility fcb-cloud-utility is-${drive.status}`}
        onClick={onCloudOpen}
        title={`Drive sync: ${driveState.label}`}
        type="button"
      >
        <HeaderIcon name="cloud" />
        <UtilityBadge state={driveState.badge} />
      </button>
      <AutosaveToggle enabled={autosaveEnabled} onToggle={toggleAutosave} />
      <span className="fcb-topbar-divider" aria-hidden="true" />
      <ThemeMenu
        onSelect={selectTheme}
        theme={theme}
        themes={themeMenuOrder()}
      />
      {support ? (
        // A quiet ghost icon: optional and generous, never competing with the
        // builder's own controls for attention.
        <a
          aria-label={supportName}
          className="fcb-topbar-utility fcb-topbar-utility--quiet"
          href={support.href}
          rel="noopener noreferrer"
          target="_blank"
          title={supportName}
        >
          <HeaderIcon name="support" />
        </a>
      ) : null}
    </div>
  );
}

export default TopbarUtilities;
