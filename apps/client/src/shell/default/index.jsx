/**
 * The default host shell: neutral branding, no ambient background, no
 * release-notes dialog. A host site supplies its own module of the same
 * shape through `FCB_HOST_SHELL_DIR` (see ../contract.d.ts).
 */

import mark from "./mark.svg";

export const APP_NAME = "Forge Character Builder";

export const AVAILABLE_THEMES = ["dark", "light", "retro"];
export const DEFAULT_THEME = AVAILABLE_THEMES.includes(import.meta.env?.VITE_FCB_DEFAULT_THEME)
  ? import.meta.env.VITE_FCB_DEFAULT_THEME
  : "dark";

const THEME_STORAGE_KEY = "theme";

function resolveSystemPreference() {
  if (!globalThis.matchMedia) return "dark";
  return globalThis.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function normalizeTheme(value) {
  if (value === "system") return resolveSystemPreference();
  return AVAILABLE_THEMES.includes(value) ? value : null;
}

export function applyTheme(value, target = globalThis.document) {
  const theme = normalizeTheme(value) || DEFAULT_THEME;
  const root = target?.documentElement;
  if (!root) return theme;
  root.dataset.theme = theme;
  root.classList.toggle("light-mode", theme === "light");
  root.classList.toggle("retro-mode", theme === "retro");
  return theme;
}

export function readStoredTheme(storage = globalThis.localStorage) {
  try {
    return normalizeTheme(storage?.getItem(THEME_STORAGE_KEY)) || DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function storeTheme(value, storage = globalThis.localStorage) {
  const theme = normalizeTheme(value) || DEFAULT_THEME;
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (private windows, locked-down browsers).
  }
  return theme;
}

export function getNextTheme(value) {
  const theme = normalizeTheme(value) || DEFAULT_THEME;
  return AVAILABLE_THEMES[(AVAILABLE_THEMES.indexOf(theme) + 1) % AVAILABLE_THEMES.length];
}

export function Logo({
  size = 46,
  title = APP_NAME,
  subtitle = null,
  showWordmark = true,
  className = "",
}) {
  return (
    <span className={`dmf-logo ${className}`.trim()}>
      <img alt="" aria-hidden="true" className="dmf-logo__icon" height={size} src={mark} width={size} />
      {showWordmark ? (
        <span className="dmf-logo__copy">
          <span className="dmf-logo__title">{title}</span>
          {subtitle ? <span className="dmf-logo__subtitle">{subtitle}</span> : null}
        </span>
      ) : (
        <span className="dmf-sr-only">{title}</span>
      )}
    </span>
  );
}

export function Background() {
  return null;
}

export function ReleaseNotesProvider({ children }) {
  return children;
}

export function VersionStamp({ className = "" }) {
  const version = import.meta.env?.VITE_FCB_VERSION || "dev";
  return (
    <span className={`dmf-version-stamp ${className}`.trim()} title={`${APP_NAME} v${version}`}>
      v{version}
    </span>
  );
}

const base = import.meta.env?.BASE_URL ?? "/";

export const shell = Object.freeze({
  appName: APP_NAME,
  Logo,
  Background,
  ReleaseNotesProvider,
  VersionStamp,
  theme: Object.freeze({
    AVAILABLE_THEMES,
    DEFAULT_THEME,
    normalizeTheme,
    applyTheme,
    readStoredTheme,
    storeTheme,
    getNextTheme,
  }),
  links: Object.freeze({
    legal: { href: `${base}legal/`, label: "Credits & licences" },
  }),
});

export default shell;
