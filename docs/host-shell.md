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
| `links` | `legal` (required), optional `home` and `support`, each `{ href, label, title? }`. |

The directory also supplies `styles.css`, imported as `@shell/styles.css`
before the client's own stylesheet. It must define the `--dmf-*` design tokens
listed in `src/shell/default/styles.css` for all three themes, plus the
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
