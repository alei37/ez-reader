import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  DEFAULT_SHORTCUTS,
  routeShortcut,
  type ShortcutEvent
} from "../../src/ui/reader/readerShortcuts";

/**
 * Lock down the keyboard shortcut router. The router is pure: same input →
 * same output. These tests are the contract.
 */

const key = (k: string, mods: Partial<Omit<ShortcutEvent, "key">> = {}): ShortcutEvent => ({
  key: k,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods
});

test("ArrowLeft → prev", () => {
  assert.equal(routeShortcut(key("ArrowLeft"), DEFAULT_SHORTCUTS), "prev");
});

test("ArrowRight → next", () => {
  assert.equal(routeShortcut(key("ArrowRight"), DEFAULT_SHORTCUTS), "next");
});

test("PageUp/PageDown → prev/next (PDF reader convention)", () => {
  assert.equal(routeShortcut(key("PageUp"), DEFAULT_SHORTCUTS), "prev");
  assert.equal(routeShortcut(key("PageDown"), DEFAULT_SHORTCUTS), "next");
});

test("Space → next; Shift+Space → prev", () => {
  assert.equal(routeShortcut(key(" "), DEFAULT_SHORTCUTS), "next");
  assert.equal(routeShortcut(key(" ", { shiftKey: true }), DEFAULT_SHORTCUTS), "prev");
});

test("Home/End → first/last", () => {
  assert.equal(routeShortcut(key("Home"), DEFAULT_SHORTCUTS), "first");
  assert.equal(routeShortcut(key("End"), DEFAULT_SHORTCUTS), "last");
});

test("Shift+F → toggleImmersive (lowercase f alone does not match)", () => {
  // P1 修复: 之前 lowercase 'f' 也匹配 toggleImmersive — 跟 foliate
  // 内部的查找 (find in book) 冲突, 把快捷键也加上 shift.
  assert.equal(routeShortcut(key("f"), DEFAULT_SHORTCUTS), null);
  assert.equal(routeShortcut(key("F"), DEFAULT_SHORTCUTS), "toggleImmersive");
});

test("? → showHelp", () => {
  assert.equal(routeShortcut(key("?"), DEFAULT_SHORTCUTS), "showHelp");
});

test("Escape → escape (always, no modifier check)", () => {
  assert.equal(routeShortcut(key("Escape"), DEFAULT_SHORTCUTS), "escape");
  // Even with shift held
  assert.equal(routeShortcut(key("Escape", { shiftKey: true }), DEFAULT_SHORTCUTS), "escape");
});

test("Translate shortcut is shift+T (capital T only)", () => {
  // lowercase t (no shift) → toggleToc
  assert.equal(routeShortcut(key("t"), DEFAULT_SHORTCUTS), "toggleToc");
  // shift+t (user reports key as 'T' or 't' depending on platform) → translate
  assert.equal(routeShortcut(key("t", { shiftKey: true }), DEFAULT_SHORTCUTS), "translate");
  assert.equal(routeShortcut(key("T", { shiftKey: true }), DEFAULT_SHORTCUTS), "translate");
});

test("Excerpt shortcut is shift+H (uppercase only)", () => {
  // lowercase h (no shift) → not bound, null
  assert.equal(routeShortcut(key("h"), DEFAULT_SHORTCUTS), null);
  // shift+h → excerpt
  assert.equal(routeShortcut(key("H", { shiftKey: true }), DEFAULT_SHORTCUTS), "excerpt");
  assert.equal(routeShortcut(key("h", { shiftKey: true }), DEFAULT_SHORTCUTS), "excerpt");
});

test("Alt / Ctrl / Meta → null (don't intercept browser/OS shortcuts)", () => {
  assert.equal(routeShortcut(key("ArrowLeft", { altKey: true }), DEFAULT_SHORTCUTS), null);
  assert.equal(routeShortcut(key("ArrowLeft", { ctrlKey: true }), DEFAULT_SHORTCUTS), null);
  assert.equal(routeShortcut(key("ArrowLeft", { metaKey: true }), DEFAULT_SHORTCUTS), null);
  // Escape with Alt is null — Alt+Esc is OS
  assert.equal(routeShortcut(key("Escape", { altKey: true }), DEFAULT_SHORTCUTS), null);
});

test("Custom shortcuts are honored — arrow keys become user-configurable", () => {
  const custom = {
    prev: "k",
    next: "j",
    toggleSidebar: "n",
    toggleToc: "m",
    translate: "T",
    highlight: "E"
  };
  assert.equal(routeShortcut(key("k"), custom), "prev");
  assert.equal(routeShortcut(key("j"), custom), "next");
  assert.equal(routeShortcut(key("n"), custom), "toggleNotes");
  // ArrowLeft no longer matches because user remapped prev to k.
  // PageUp/PageDown remain hardcoded prev/next.
  assert.equal(routeShortcut(key("ArrowLeft"), custom), null);
  assert.equal(routeShortcut(key("PageUp"), custom), "prev");
});

test("enabled=false disables fixed shortcuts but Escape still works", () => {
  assert.equal(routeShortcut(key(" "), DEFAULT_SHORTCUTS, false), null);
  // ArrowLeft is cfg-bound, not "fixed", so still works with enabled=false
  assert.equal(routeShortcut(key("ArrowLeft"), DEFAULT_SHORTCUTS, false), "prev");
  assert.equal(routeShortcut(key("Escape"), DEFAULT_SHORTCUTS, false), "escape");
});

test("Unknown keys → null (don't crash on arbitrary input)", () => {
  assert.equal(routeShortcut(key("z"), DEFAULT_SHORTCUTS), null);
  assert.equal(routeShortcut(key("1"), DEFAULT_SHORTCUTS), null);
  assert.equal(routeShortcut(key("Enter"), DEFAULT_SHORTCUTS), null);
  assert.equal(routeShortcut(key("Tab"), DEFAULT_SHORTCUTS), null);
});

test("C → copySelection", () => {
  assert.equal(routeShortcut(key("c"), DEFAULT_SHORTCUTS), "copySelection");
  assert.equal(routeShortcut(key("C"), DEFAULT_SHORTCUTS), "copySelection");
});