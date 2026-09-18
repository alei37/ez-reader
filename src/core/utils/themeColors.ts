import type { ReaderTheme } from "../types/ReaderSettings";

/**
 * Theme-aware color resolution for the reader. Used by both foliate-js
 * (via `setStyles`) and the paged-text adapter to keep the look consistent
 * across formats when the user switches themes.
 *
 * Values mirror what `foliate-paginator` expects for `background`,
 * `color`, and `color-scheme`. Light / dark / sepia map to concrete colors;
 * `system` uses the platform "Canvas" / "CanvasText" keywords so the
 * reader follows the OS theme instead of forcing one.
 */
export interface ReaderThemeColors {
  readonly bg: string;
  readonly fg: string;
  readonly scheme: "light" | "dark" | "light dark";
}

export const themeColors = (theme: ReaderTheme): ReaderThemeColors => {
  switch (theme) {
    case "light":
      return { bg: "#ffffff", fg: "#1f2328", scheme: "light" };
    case "dark":
      return { bg: "#1f2328", fg: "#e6edf3", scheme: "dark" };
    case "sepia":
      return { bg: "#f4ecd8", fg: "#4b3b2a", scheme: "light" };
    default:
      // "system" — defer to platform. `Canvas` / `CanvasText` are
      // CSS-system colors supported in Chrome 89+, Firefox 113+, Safari 15+.
      // Both readers inherit the page background through these keywords.
      return { bg: "Canvas", fg: "CanvasText", scheme: "light dark" };
  }
};
