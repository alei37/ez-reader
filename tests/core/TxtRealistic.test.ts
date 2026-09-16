import { test } from "node:test";
import { strict as assert } from "node:assert";

import { splitTextIntoPages } from "../../src/adapters/text/TxtBookReader";

/**
 * Smoke test that exercises the splitter against a realistic-size input.
 * Catches O(n²) regressions and validates the algorithm holds on real
 * Chinese / mixed-language content (poetry / academic prose).
 *
 * The input is synthesised here (instead of being checked in) to keep the
 * repo small — but it's representative of what a 100KB Chinese novel or
 * a stack of academic paragraphs would look like.
 */

const SYNTHESIZED_CHAPTER = `
第一章 缘起

  清晨,城市的街道还没有完全醒来。远处传来隐约的车流声,像一条刚刚解冻的河流。
窗台上的盆栽在阳光里微微颤动,叶片上残留的露水折射出七彩光芒。

  她站在阳台上,手中握着一杯已经凉透的咖啡。思绪却停留在昨晚的那场对话里 —
那些关于生活、关于选择、关于未来的问题,像涟漪一样在心里荡漾开来。

  "人到底应该怎样活着?" 她喃喃自语,声音小得连自己都几乎听不见。

第二章 困惑

  或许,答案并不重要。重要的,是提出这个问题本身。

  街上行人匆匆,每个人都带着各自的目的。她忽然有一种冲动,想拉住一个路人,问问他:
"你快乐吗?你知道自己想要什么吗?"

  当然,她没有这么做。只是看着他们的背影,想象着那些各自不同的故事。
`.trim();

const generateLongText = (chapterCount: number): string => {
  return Array.from({ length: chapterCount }, (_, i) => `第 ${i + 1} 章\n\n${SYNTHESIZED_CHAPTER}`).join("\n\n");
};

test("txt: 50 chapters (~ 50KB) splits in under 100ms with no empty pages", () => {
  const text = generateLongText(50);
  // Synthesized chapter is ~600 bytes × 50 chapters = ~30KB total.
  // Default page size is 1600 chars → expect ≥ 15 pages.
  const start = Date.now();
  const pages = splitTextIntoPages(text);
  const elapsed = Date.now() - start;
  // Generous bound — splits are O(n) and a typical 30KB input completes
  // in single-digit ms on modern hardware. Anything above 100ms points
  // to an accidental O(n²) introduction.
  assert.ok(elapsed < 100, `split took ${elapsed}ms — likely O(n²) regression`);
  assert.ok(pages.length >= 10, `expected many pages, got ${pages.length}`);
  for (const page of pages) {
    assert.ok(page.html.trim().length > 0, "page has empty html");
    assert.match(page.html, /^<p>/, "page must start with <p>");
  }
});

test("txt: very long single line (100KB) splits without blowing up", () => {
  // Simulates a log dump or a one-line-per-paragraph export.
  const text = "x".repeat(100_000);
  const start = Date.now();
  const pages = splitTextIntoPages(text, { pageChars: 2000 });
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 200, `split took ${elapsed}ms`);
  assert.ok(pages.length >= 40, `expected many pages, got ${pages.length}`);
});

test("txt: short chinese novel excerpt from the synthesized chapter renders paragraphs as <p>", () => {
  const pages = splitTextIntoPages(SYNTHESIZED_CHAPTER);
  assert.ok(pages.length >= 1);
  // Multiple paragraphs (chapter headings + body paragraphs separated by blank lines).
  const paraCount = (pages[0]!.html.match(/<p>/g) ?? []).length;
  assert.ok(paraCount >= 3, `expected multiple paragraphs, got ${paraCount}`);
  // First paragraph should mention the chapter heading.
  assert.match(pages[0]!.html, /第一章 缘起/);
});
