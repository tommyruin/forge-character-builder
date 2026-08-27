/**
 * Host shell contract.
 *
 * The client renders its chrome (logo, ambient background, version stamp,
 * release-notes provider, theme helpers, host links) through a single `shell`
 * object imported from the `@shell` alias. The alias resolves to
 * `src/shell/default/` unless the build sets `FCB_HOST_SHELL_DIR` to a
 * directory exporting the same shape from index.jsx, which is how a host site brands the
 * builder without forking it. See docs/host-shell.md.
 */

import type { ComponentType, ReactNode } from "react";

export type ThemeName = "dark" | "light" | "retro";

export interface ShellTheme {
  readonly AVAILABLE_THEMES: readonly ThemeName[];
  readonly DEFAULT_THEME: ThemeName;
  /** Maps any stored or requested value onto a known theme, or null. */
  normalizeTheme(value: unknown): ThemeName | null;
  /** Writes the theme onto the document root; returns the theme applied. */
  applyTheme(value: unknown, target?: Document): ThemeName;
  readStoredTheme(storage?: Storage): ThemeName;
  storeTheme(value: unknown, storage?: Storage): ThemeName;
  getNextTheme(value: unknown): ThemeName;
}

export interface ShellLink {
  readonly href: string;
  readonly label: string;
  /** Tooltip text; defaults to `label`. */
  readonly title?: string;
}

export interface ShellLinks {
  /** Where the brand mark navigates. Omitted: the mark is not a link. */
  readonly home?: ShellLink;
  /** The credits and licences page. */
  readonly legal: ShellLink;
  /** An optional support/donation link shown among the top-bar utilities. */
  readonly support?: ShellLink;
}

/**
 * Where the client persists data in the browser. A host that already has
 * users under other names supplies them here so nothing they stored is
 * stranded; the defaults are the builder's own.
 */
export interface ShellStorage {
  /** The IndexedDB database holding characters, uploads, homebrew and settings. Default `fcb-local`. */
  readonly database?: string;
  readonly keys?: {
    /** localStorage key of the autosave switch. Default `fcb-autosave`. */
    readonly autosave?: string;
    /** localStorage key of the last active character id. Default `fcb-active-character`. */
    readonly activeCharacter?: string;
    /** localStorage key of the split-view preference. Default `fcb-split-view`. */
    readonly splitView?: string;
  };
  /** The `format` token written into exported character packages. Default `fcb-character-package`. */
  readonly packageToken?: string;
  /** Further `format` tokens the importer accepts, for packages the host's users already hold. */
  readonly legacyPackageTokens?: readonly string[];
}

/** Host branding for the generated character sheets. */
export interface ShellSheet {
  /**
   * A logo painted over the sheet's brand badge: a URL the client fetches, or
   * a `data:` URL. PNG or JPEG; anything else is ignored. Omitted, the
   * templates' own die mark shows.
   */
  readonly logo?: string;
}

export interface LogoProps {
  size?: number;
  title?: string;
  subtitle?: string | null;
  showWordmark?: boolean;
  className?: string;
}

export interface HostShell {
  /** Product name used in headings and accessible labels. */
  readonly appName: string;
  /** Browser persistence names; omitted for the builder's defaults. */
  readonly storage?: ShellStorage;
  /** Branding for the generated character sheets. */
  readonly sheet?: ShellSheet;
  readonly Logo: ComponentType<LogoProps>;
  /** Ambient page background; may render nothing. */
  readonly Background: ComponentType;
  /** Wraps the app; may show release notes when `announce` is true. */
  readonly ReleaseNotesProvider: ComponentType<{ announce: boolean; children?: ReactNode }>;
  /** Small version label rendered next to the brand. */
  readonly VersionStamp: ComponentType<{ className?: string }>;
  readonly theme: ShellTheme;
  readonly links: ShellLinks;
}

export declare const shell: HostShell;
