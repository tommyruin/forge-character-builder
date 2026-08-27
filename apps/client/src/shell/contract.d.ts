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
