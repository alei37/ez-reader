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
  | "quickHighlight"
  | "quickBookmark"
  | "toggleImmersive"
  | "first"
  | "last"
  | "showHelp"
  | "escape"
  | "copySelection"
  | "openSearch";

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
  // Alt — reserve for OS, don't intercept (browser / WM use it).
  if (event.altKey) return null;

  // Ctrl / Cmd + F → open search (跨平台 OS 习惯)。其他 Ctrl/Cmd 组合保留给
  // Obsidian / 浏览器, 不抢。
  if ((event.ctrlKey || event.metaKey) && event.key === "f" && !event.shiftKey) {
    return "openSearch";
  }

  // Escape — let Obsidian handle the priority order (close leaf > blur
  // > close panel) by NOT returning a shortcut here. Previously we always
  // returned "escape" which stole the event before Obsidian saw it, so
  // Escape on a focused reader leaf wouldn't close the leaf — just the
  // first open panel. Now we only return "escape" for the panel-dismiss
  // path inside ReaderView; this function returns null so Obsidian's
  // own handler still runs.
  if (event.key === "Escape") return "escape";

  // 裸 Ctrl / Meta (无修饰键) — 让 Obsidian / OS 处理, 不拦截。
  if (event.ctrlKey || event.metaKey) return null;

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
  // 高亮 / 摘录 (modal flow) — 需要 shift, 跟之前一致
  if (key === cfg.highlight.toLowerCase() && event.shiftKey) return "excerpt";
  // P2 quick action: 裸 H → quick highlight (no modal, 直接保存 + 高亮).
  // 与 Shift+H (modal excerpt) 并存, 用户按习惯选. 注意: 必须在 cfg.highlight
  // 检查后, 否则裸 H 会被 cfg.highlight.toLowerCase() === "h" 吃掉
  if (key === "h" && !event.shiftKey) return "quickHighlight";
  // P2 quick action: 裸 B → quick bookmark (no modal, 自动 label chapter+%)
  if (key === "b" && !event.shiftKey) return "quickBookmark";

  // Below this point: fixed shortcuts that aren't user-configurable.
  // Gate them on `enabled` so a degraded mode (e.g. text input focused)
  // can disable without losing user's custom bindings.
  if (!enabled) return null;

  // Fixed shortcuts (not user-configurable; users with muscle memory from
  // Adobe / Preview / Calibre / Kindle will appreciate these).
  //
  // PageUp/PageDown + ArrowUp/ArrowDown are always prev/next regardless of
  // what `cfg.prev` / `cfg.next` are bound to. Two reasons:
  //   1. Muscle memory from every PDF reader / Calibre / Kindle app uses
  //      ↑/↓/PageUp/PageDown for paging. Hardcoding matches user expectation.
  //   2. Users who remap `cfg.prev` to e.g. "k" (vim style) still want
  //      ↑/↓ to work — they shouldn't have to reconfigure four keys.
  switch (event.key) {
    case "PageUp":
    case "ArrowUp":
      return "prev";
    case "PageDown":
    case "ArrowDown":
      return "next";
    case "Home":
      return "first";
    case "End":
      return "last";
  }
  // P1 修复: 裸 `f`(小写)跟 foliate 自身的查找 (find in book) 冲突, 所以
  // 小写 f 永远不能匹配本快捷键。
  //
  // P0 修复: 这条判断之前是下面 `case "F"` 的形式, 放在
  // `if (event.shiftKey) { … return null; }` **之后** —— 每一个带 Shift 的
  // 组合键都在那里被 `return null` 吃掉, 所以 Shift+F 根本走不到那个 case。
  // 注释和 ShortcutHelpModal 都写着「按 F 切沉浸」, 实际按什么都不发生,
  // 只有工具栏按钮能用。必须提到那个 shift 闸门之前。
  //
  // 浏览器里 `event.key` 有两种会给到大写 "F" 的情况: 按住 Shift, 或开了
  // Caps Lock。两者都接受, 小写 f 不接受 —— 既恢复了文档承诺的 Shift+F,
  // 又不破坏之前 Caps+F 就能用的行为。
  if (event.key === "F") {
    return "toggleImmersive";
  }

  if (event.shiftKey) {
    if (event.key === " ") return "prev";
    return null;
  }
  switch (event.key) {
    case " ":
      return "next";
    case "?":
      return "showHelp";
    case "c":
    case "C":
      return "copySelection";
    // P1: find-in-book 快捷键 — Ctrl/Cmd+F 跨平台一致 + 裸 `/` (vim style)
    // 都能打开. 注意 Ctrl/Cmd 修饰由外层 shortcut event 决定, routeShortcut
    // 在 alt/ctrl/meta 时已 return null, 所以这里捕获的是裸键或裸 shift.
    case "/":
      return "openSearch";
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