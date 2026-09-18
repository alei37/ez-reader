import { test } from "node:test";
import { strict as assert } from "node:assert";
import { composeQuickBookmarkLabel } from "../../src/ui/reader/ReaderView";

/**
 * P1 回归: quick bookmark label 必须 clamp fraction 到 [0, 1], 否则
 * foliate / paginator 异常 relocate 会输出 "-10%" 或 "150%" 让用户
 * 困惑. 也覆盖 NaN / Infinity 安全保护.
 */

test("composeQuickBookmarkLabel: clamps negative fraction to 0%", () => {
  assert.equal(composeQuickBookmarkLabel("Chapter 1", -0.1), "Chapter 1 · 0%");
});

test("composeQuickBookmarkLabel: clamps fraction > 1 to 100%", () => {
  assert.equal(composeQuickBookmarkLabel("Chapter 1", 1.5), "Chapter 1 · 100%");
});

test("composeQuickBookmarkLabel: handles NaN as 0%", () => {
  assert.equal(composeQuickBookmarkLabel("Chapter 1", Number.NaN), "Chapter 1 · 0%");
});

test("composeQuickBookmarkLabel: handles Infinity as 0% (non-finite → safe fallback)", () => {
  // Infinity 走 `Number.isFinite` 检查,被视为无效输入, 跟 NaN 同样 fallback 到 0.
  // 比放任 Infinity 输出 "Infinity%" 更稳.
  assert.equal(composeQuickBookmarkLabel("Chapter 1", Number.POSITIVE_INFINITY), "Chapter 1 · 0%");
  assert.equal(composeQuickBookmarkLabel("Chapter 1", Number.NEGATIVE_INFINITY), "Chapter 1 · 0%");
});

test("composeQuickBookmarkLabel: empty chapter falls back to percentage only", () => {
  assert.equal(composeQuickBookmarkLabel("", 0.42), "42%");
  assert.equal(composeQuickBookmarkLabel(undefined, 0.42), "42%");
  assert.equal(composeQuickBookmarkLabel(null, 0.42), "42%");
  assert.equal(composeQuickBookmarkLabel("   ", 0.42), "42%");
});

test("composeQuickBookmarkLabel: normal case still works", () => {
  assert.equal(composeQuickBookmarkLabel("Chapter 6", 0.423), "Chapter 6 · 42%");
  assert.equal(composeQuickBookmarkLabel("Chapter 6", 0.5), "Chapter 6 · 50%");
  assert.equal(composeQuickBookmarkLabel("Chapter 6", 0), "Chapter 6 · 0%");
  assert.equal(composeQuickBookmarkLabel("Chapter 6", 1), "Chapter 6 · 100%");
});