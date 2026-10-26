# Host shell

The client renders its chrome through one object, `shell`, imported from the
`@shell` alias. The alias resolves to `apps/client/src/shell/default/` — a
neutral brand, no ambient background, no release-notes dialog — unless the
build sets `FCB_HOST_SHELL_DIR` to a directory of the same shape. That is how a
host site brands the builder without forking it.

## Contract

`apps/client/src/shell/contract.d.ts` is the authoritative description. In
short, the directory exports (from `index.jsx`) a frozen `shell` object with:

| Member | Purpose |
|---|---|
| `appName` | Product name for headings and accessible labels. |
| `Logo` | Brand mark component (`size`, `subtitle`, `showWordmark`, `className`). |
| `Background` | Ambient page background; may render nothing. |
| `ReleaseNotesProvider` | Wraps the app; receives `announce`. |
| `VersionStamp` | Small version label next to the brand. |
| `theme` | `AVAILABLE_THEMES`, `DEFAULT_THEME`, `normalizeTheme`, `applyTheme`, `readStoredTheme`, `storeTheme`, `getNextTheme`. The stored key is `theme`; values are `dark`, `light`, `retro`. |
| `links` | `legal` (required), optional `home`, `support` and `makeToken`, each `{ href, label, title? }`, and optional `tools` (see below). |

### Optional links

- `support` shows as a quiet, icon-only link among the top-bar utilities. Its
  accessible name and tooltip are `title ?? label`. It opens in a new tab.
- `tools` is the host's own navigation: a list of `{ href, label, title?, Icon?,
  group?, current? }`. When it is non-empty the top bar shows a "Tools" button
  (labelled from 1280 px, icon-only below) inside `<nav aria-label="Tools">`,
  opening a short list of the entries. `Icon` is a decorative component drawn at
  about 16 px. `group: "apps"` entries are separate apps: they follow a divider,
  carry a ↗ mark and say "(opens its own page)" in their tooltip. The
  `current: true` entry is this builder; it shows as the current page
  (`aria-current="page"`) rather than as a link. Links open in the same tab.
- `makeToken` adds "Make a token" to each character's Export menu, opening
  `href` in the same tab.

A host that leaves these out gets none of these controls.

The theme control reads `theme.AVAILABLE_THEMES` and shows "Theme: Retro"
style labels (each name capitalised), with a menu of the themes in that order.

The directory also supplies `styles.css`, imported as `@shell/styles.css`
before the client's own stylesheet. It must define the `--dmf-*` design tokens
listed in `src/shell/default/styles.css` for all three themes (including
`--dmf-header-background`, `--dmf-header-height`, which is a minimum height,
`--dmf-control-radius` and the `--dmf-type-*` steps; the client falls back to
56 px, 8 px and 11/12/14 px when a host omits the last ones), plus the
`.dmf-logo*`, `.dmf-versioned-brand*`, `.dmf-version-stamp` and `.dmf-sr-only`
rules its own `Logo` and `VersionStamp` rely on.

## Build-time variables

| Variable | Default | Meaning |
|---|---|---|
| `FCB_HOST_SHELL_DIR` | `src/shell/default` | Directory the `@shell` alias resolves to. |
| `FCB_ASSET_OVERLAY_DIR` | unset | Directory served ahead of `public/` in development and copied over the build output (favicon, legal page). |
| `PUBLIC_BASE_PATH` | `/` | Vite `base`; the path the client is mounted at. |
| `FCB_HOST_PROXY_ORIGIN` | unset | In development, requests outside `PUBLIC_BASE_PATH` are proxied here. |
| `VITE_FCB_APP_TITLE` | `Forge Character Builder` | `<title>` and `application-name`. |
| `VITE_FCB_APP_DESCRIPTION` | generic | `<meta name="description">`. |
| `VITE_FCB_THEME_COLOR` | `#0b0f17` | `<meta name="theme-color">`. |
| `VITE_FCB_DEFAULT_THEME` | `dark` | Theme applied before any stored preference exists. |

Tests always resolve `@shell` to the default shell, so they describe the
repository's own behaviour regardless of the host.

## Storage names

The client persists data in the browser under names the shell may set:

| `shell.storage` field | Default | Holds |
| --- | --- | --- |
| `database` | `fcb-local` | The IndexedDB database: characters, uploaded content, homebrew, settings, snapshots. |
| `keys.autosave` | `fcb-autosave` | The autosave switch. |
| `keys.activeCharacter` | `fcb-active-character` | The last active character. |
| `keys.splitView` | `fcb-split-view` | The split-view preference. |
| `packageToken` | `fcb-character-package` | The `format` token written into exported character packages. |
| `legacyPackageTokens` | none | Further package tokens the importer accepts. |

Browsers look these up by exact name, so a host that already has users under
other names keeps them here; a fresh deployment leaves `storage` out. Once
chosen for a deployment they must never change, or its users' stored
characters become unreachable.
