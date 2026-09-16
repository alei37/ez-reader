import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  expandToBoundary,
  shouldExpand
} from "../../src/ui/reader/chineseSelectionExpansion";

/**
 * Pure function tests for the Chinese selection expansion heuristic.
 * Originally inlined in ReaderView; extracted so the rule can be
 * locked down with tests instead of running in the wild.
 */

test("shouldExpand: short Latin text → false (don't touch)", () => {
  assert.equal(shouldExpand("hi"), false);
  assert.equal(shouldExpand(""), false);
});

test("shouldExpand: short CJK text → true", () => {
  assert.equal(shouldExpand("你好"), true);
  assert.equal(shouldExpand("中"), true);
});

test("shouldExpand: long text (>= 12 chars) → false regardless of content", () => {
  // 12+ chars including any CJK
  assert.equal(shouldExpand("这是一段足够长的中文文本"), false);
  assert.equal(shouldExpand("This is a long English text."), false);
});

test("expandToBoundary: short CJK with right-side stop → extend right", () => {
  // 选中 "你好", 后面紧跟 "，世界。" → 扩展到 "你好，"
  const ctx = "他说你好，世界。";
  assert.equal(expandToBoundary("你好", ctx), "你好，");
});

test("expandToBoundary: short CJK with left-side stop → extend left (drop stop)", () => {
  // 选中 "世界", 前面有 "，" (comma) → 从 "，" 之后开始 (不要逗号)
  const ctx = "你好，世界。";
  assert.equal(expandToBoundary("世界", ctx), "世界。");
});

test("expandToBoundary: both sides have stops → extend both (drop left, keep right)", () => {
  // "，你好，世界。" → 选中 "你好", 扩展为 "你好，"
  const ctx = "早上好，你好，世界。今天天晴。";
  assert.equal(expandToBoundary("你好", ctx), "你好，");
});

test("expandToBoundary: sentence-ending period — period kept on right", () => {
  // 选中 "今天", 后跟 "天气真好。" → 扩展到 "今天天气真好。"
  const ctx = "今天天气真好。明天会下雨。";
  assert.equal(expandToBoundary("今天", ctx), "今天天气真好。");
});

test("expandToBoundary: Latin text not expanded even with stops around", () => {
  // 拉丁原文浏览器自己分词好, 不要动
  assert.equal(expandToBoundary("hi", "say hi, world."), "hi");
});

test("expandToBoundary: long text not expanded", () => {
  // 即使是中文, 长度 >= 12 也不动
  const long = "这是一段足够长的中文文本";
  assert.equal(expandToBoundary(long, "前文" + long + "后文。"), long);
});

test("expandToBoundary: stop char out of window → only one side expands", () => {
  // "。" 在 200 字符之外 (超过默认 window=120)
  // 选中 "你好", 但远处才有 "。" — window 内没有 stop → 不扩展
  let ctx = "x".repeat(150);
  ctx += "你好";
  ctx += "y".repeat(150);
  ctx += "。";
  assert.equal(expandToBoundary("你好", ctx), "你好");
});

test("expandToBoundary: raw not found in context → no expansion (defensive)", () => {
  assert.equal(expandToBoundary("你", "毫无关系的上下文"), "你");
});

test("expandToBoundary: newline treated as stop", () => {
  // 段落分隔符也是 stop
  const ctx = "第一段内容\n第二段内容。";
  assert.equal(expandToBoundary("第二", ctx), "第二段内容。");
});

test("expandToBoundary: English full stop / comma / semicolon treated as stop", () => {
  // Latin mixed with CJK
  const ctx = "Read this, 你好, and that.";
  assert.equal(expandToBoundary("你好", ctx), "你好,");
});

test("expandToBoundary: at very start of context with stop behind", () => {
  // 文档开头就是 raw, 后面有 stop
  const ctx = "你好，世界";
  assert.equal(expandToBoundary("你好", ctx), "你好，");
});

test("expandToBoundary: at very end of context with stop in front", () => {
  // raw 是文档末尾, 前面有 stop
  const ctx = "早上好，你好";
  assert.equal(expandToBoundary("你好", ctx), "你好");
});