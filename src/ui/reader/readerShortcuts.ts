import type { KeyboardShortcuts } from "../../core/types/ReaderSettings";

/**
 * Keyboard shortcut routing — pure function so we can unit-test all
 * combinations without spinning up Obsidian.
 *
 * Each shortcut is matched against a KeyboardEvent-like input. Modifiers
 * (shift / ctrl / alt / meta) are matched exactly: e.g. `T` (shift+T)
 * only fires when shiftKey is true; `t` alone does NOT match.
 *
 * Alt / Ctrl / Meta shortcuts are ignored (we return null) so they don't
 * collide with browser / OS shortcuts.
 */

export interface ShortcutEvent {
  /** Same shape as KeyboardEvent.key */
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

export type ShortcutAction =
  | "prev"
  | "next"
  | "toggleNotes"
  | "toggleToc"
  | "translate"
  | "excerpt"
  | "toggleImmersive"
  | "first"
  | "last"
  | "showHelp"
  | "escape"
  | "copySelection";

/**
 * Map a keyboard event to a shortcut action, or null if nothing matches.
 * Pure / synchronous / no DOM.
 *
 * @param event KeyboardEvent-like
 * @param shortcuts User's configured shortcuts (defaults provided)
 * @param enabled Whether to consider fixed shortcuts (Space, Home, End, F, ?, Escape)
 *   that don't live in `shortcuts` config. Defaults to true.
 */
export const routeShortcut = (
  event: ShortcutEvent,
  shortcuts: KeyboardShortcuts,
  enabled = true
): ShortcutAction | null => {
  // Alt / Ctrl / Meta — reserve for browser / OS, don't intercept.
  if (event.altKey || event.ctrlKey || event.metaKey) return null;

  // Escape — let Obsidian handle the priority order (close leaf > blur
  // > close panel) by NOT returning a shortcut here. Previously we always
  // returned "escape" which stole the event before Obsidian saw it, so
  // Escape on a focused reader leaf wouldn't close the leaf — just the
  // first open panel. Now we only return "escape" for the panel-dismiss
  // path inside ReaderView; this function returns null so Obsidian's
  // own handler still runs.
  if (event.key === "Escape") return "escape";

  const key = event.key.toLowerCase();
  const cfg = shortcuts;

  // User-configured shortcuts — always honored (user explicitly remapped
  // them, so don't gate on `enabled`). Case-insensitive.
  // translate / excerpt require shift to disambiguate from letter keys
  // (T also matches t — without shift we'd jump pages on every T press).
  if (key === cfg.prev.toLowerCase()) return "prev";
  if (key === cfg.next.toLowerCase()) return "next";
  if (key === cfg.toggleSidebar.toLowerCase() && !event.shiftKey) return "toggleNotes";
  if (key === cfg.toggleToc.toLowerCase() && !event.shiftKey) return "toggleToc";
  if (key === cfg.translate.toLowerCase() && event.shiftKey) return "translate";
  if (key === cfg.highlight.toLowerCase() && event.shiftKey) return "excerpt";

  // Below this point: fixed shortcuts that aren't user-configurable.
  // Gate them on `enabled` so a degraded mode (e.g. text input focused)
  // can disable without losing user's custom bindings.
  if (!enabled) return null;

  // Fixed shortcuts (not user-configurable; users with muscle memory from
  // Adobe / Preview / Calibre will appreciate these).
  switch (event.key) {
    case "PageUp":
      return "prev";
    case "PageDown":
      return "next";
    case "Home":
      return "first";
    case "End":
      return "last";
  }
  if (event.shiftKey) {
    if (event.key === " ") return "prev";
    return null;
  }
  switch (event.key) {
    case " ":
      return "next";
    // P1 修复: 之前裸 `f` 跟 foliate 自身的查找 (find in book) 冲突.
    // 强制需要 Shift+F 才能切沉浸, 跟其他 fixed shortcut 一致.
    case "F":
      return "toggleImmersive";
    case "?":
      return "showHelp";
    case "c":
    case "C":
      return "copySelection";
  }
  return null;
};

/**
 * Default shortcuts used when the user hasn't customized. Mirrors
 * `DEFAULT_KEYBOARD_SHORTCUTS` so a missing config doesn't break routing.
 */
export const DEFAULT_SHORTCUTS: KeyboardShortcuts = {
  prev: "ArrowLeft",
  next: "ArrowRight",
  toggleSidebar: "s",
  toggleToc: "t",
  translate: "T",
  highlight: "h"
};