import { test } from "node:test";
import { strict as assert } from "node:assert";

import { buildAppearanceCss } from "../../src/adapters/foliate/FoliateBookReader";
import { themeColors } from "../../src/core/utils/themeColors";
import type { ReaderAppearance } from "../../src/core/types/ReaderSettings";

/**
 * 纯函数测试 — 验证 FoliateBookReader.applyAppearance 注入到 iframe 的
 * CSS 字符串是否正确反映每个 appearance 字段。
 *
 * foliate-paginator.setStyles 接收 CSS 字符串, 内部塞到 <style> 元素
 * textContent 里。我们只测 CSS 字符串的拼接, 实际 DOM 注入要靠 Obsidian
 * runtime 验证。
 */

const appearance = (overrides: Partial<ReaderAppearance> = {}): ReaderAppearance => ({
  fontSize: 100,
  lineHeight: 1.6,
  margin: 32,
  theme: "system",
  flow: "paginated",
  twoPages: false,
  immersive: false,
  ...overrides
});

test("themeColors: light returns paper-white + dark ink", () => {
  assert.deepEqual(themeColors("light"), { bg: "#ffffff", fg: "#1f2328", scheme: "light" });
});

test("themeColors: dark returns inverted paper + light ink", () => {
  assert.deepEqual(themeColors("dark"), { bg: "#1f2328", fg: "#e6edf3", scheme: "dark" });
});

test("themeColors: sepia returns warm cream + brown ink", () => {
  assert.deepEqual(themeColors("sepia"), { bg: "#f4ecd8", fg: "#4b3b2a", scheme: "light" });
});

test("themeColors: system falls back to OS system colors", () => {
  const c = themeColors("system");
  // 系统主题用 CSS 系统色 + light dark scheme 让浏览器跟随 OS
  assert.equal(c.bg, "Canvas");
  assert.equal(c.fg, "CanvasText");
  assert.equal(c.scheme, "light dark");
});

test("buildAppearanceCss: default appearance carries fontScale 1.000", () => {
  const css = buildAppearanceCss(appearance());
  assert.match(css, /--ez-reader-font-scale:\s*1\.000/);
});

test("buildAppearanceCss: fontSize 150 produces fontScale 1.500", () => {
  const css = buildAppearanceCss(appearance({ fontSize: 150 }));
  assert.match(css, /--ez-reader-font-scale:\s*1\.500/);
});

test("buildAppearanceCss: fontSize 80 produces fontScale 0.800", () => {
  const css = buildAppearanceCss(appearance({ fontSize: 80 }));
  assert.match(css, /--ez-reader-font-scale:\s*0\.800/);
});

test("buildAppearanceCss: line-height propagates to body + block elements", () => {
  const css = buildAppearanceCss(appearance({ lineHeight: 1.4 }));
  // body 行距
  assert.match(css, /body\s*\{[^}]*line-height:\s*1\.4\s*!important/);
  // p / li / blockquote / dd 行距
  assert.match(css, /p,\s*li,\s*blockquote,\s*dd\s*\{[^}]*line-height:\s*1\.4\s*!important/);
});

test("buildAppearanceCss: margin propagates to body padding-inline", () => {
  const css = buildAppearanceCss(appearance({ margin: 48 }));
  assert.match(css, /body\s*\{[^}]*padding-inline:\s*48px\s*!important/);
});

test("buildAppearanceCss: theme colors reach html/body color+background", () => {
  const css = buildAppearanceCss(appearance({ theme: "sepia" }));
  assert.match(css, /background:\s*#f4ecd8\s*!important/);
  assert.match(css, /color:\s*#4b3b2a\s*!important/);
  assert.match(css, /color-scheme:\s*light/);
});

test("buildAppearanceCss: dark theme colors + dark scheme", () => {
  const css = buildAppearanceCss(appearance({ theme: "dark" }));
  assert.match(css, /background:\s*#1f2328\s*!important/);
  assert.match(css, /color:\s*#e6edf3\s*!important/);
  assert.match(css, /color-scheme:\s*dark/);
});

test("buildAppearanceCss: system theme uses Canvas/CanvasText + light dark scheme", () => {
  const css = buildAppearanceCss(appearance({ theme: "system" }));
  assert.match(css, /background:\s*Canvas\s*!important/);
  assert.match(css, /color:\s*CanvasText\s*!important/);
  assert.match(css, /color-scheme:\s*light dark/);
});

test("buildAppearanceCss: every declaration that should override is marked !important", () => {
  // 防止有人删掉 !important 后 EPUB 自带 stylesheet 反过来压住我们。
  const css = buildAppearanceCss(appearance({ theme: "dark", fontSize: 120, margin: 24, lineHeight: 1.8 }));
  // 至少 4 个 !important (font-size / color / background / padding-inline / line-height (出现 2 次))
  const importantCount = (css.match(/!important/g) ?? []).length;
  assert.ok(importantCount >= 5, `expected at least 5 !important rules, got ${importantCount}`);
});

test("buildAppearanceCss: font-size is calc()ed against the --ez-reader-font-scale variable", () => {
  // 我们故意走 CSS 变量而不是直接 font-size: 1.5em, 因为 foliate-paginator
  // 可能在不同 section 之间用 calc 重写 base font-size. calc(1em * var) 比
  // 直接 em 更鲁棒。
  const css = buildAppearanceCss(appearance({ fontSize: 175 }));
  assert.match(css, /font-size:\s*calc\(1em \* var\(--ez-reader-font-scale\)\)\s*!important/);
  assert.match(css, /--ez-reader-font-scale:\s*1\.750/);
});