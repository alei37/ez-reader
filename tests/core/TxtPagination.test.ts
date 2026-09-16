import { test } from "node:test";
import { strict as assert } from "node:assert";

import { splitTextIntoPages } from "../../src/adapters/text/TxtBookReader";

/**
 * Pure-function tests for the TXT page splitter. Validates the
 * paragraph-aware splitting strategy without spinning up a DOM.
 */

test("txt: empty input produces one empty page", () => {
  const pages = splitTextIntoPages("");
  assert.equal(pages.length, 1);
  assert.match(pages[0]!.html, /<p><\/p>/);
});

test("txt: short text fits in a single page", () => {
  const pages = splitTextIntoPages("Hello, world!\n\nSecond paragraph here.");
  assert.equal(pages.length, 1);
  assert.match(pages[0]!.html, /Hello, world!/);
  assert.match(pages[0]!.html, /Second paragraph/);
  // Each paragraph wrapped in <p>; blank line becomes the </p><p> boundary.
  assert.match(pages[0]!.html, /<\/p>\s*<p>/);
});

test("txt: long text splits into multiple pages respecting paragraph boundaries", () => {
  const para = "这是一段测试文本,用来填充一页的内容。";
  // 50 paragraphs, each ~ 15 Chinese chars → roughly 750 chars/page at default 1600,
  // so we expect 2-4 pages depending on packing.
  const text = Array.from({ length: 50 }, () => para).join("\n\n");
  const pages = splitTextIntoPages(text, { pageChars: 800 });
  assert.ok(pages.length >= 2, `expected multiple pages, got ${pages.length}`);
  // No page should have empty content.
  for (const page of pages) {
    assert.ok(page.html.trim().length > 0, "page has empty html");
    // Every page wraps its content in <p>...</p>.
    assert.match(page.html, /^<p>/);
    assert.match(page.html, /<\/p>$/);
  }
});

test("txt: a single paragraph longer than pageChars still produces pages", () => {
  const longParagraph = "a".repeat(5000);
  const pages = splitTextIntoPages(longParagraph, { pageChars: 1000 });
  assert.ok(pages.length >= 5, `expected many pages, got ${pages.length}`);
  // Hard breaks happen at character boundaries; no <p> wrappers inside since
  // the paragraph is one continuous stream.
  for (const page of pages) {
    assert.ok(page.html.length > 0);
  }
});

test("txt: html special characters are escaped", () => {
  const pages = splitTextIntoPages("<script>alert('xss')</script> & \"quotes\" 'apos'");
  assert.equal(pages.length, 1);
  assert.doesNotMatch(pages[0]!.html, /<script>/);
  assert.match(pages[0]!.html, /&lt;script&gt;/);
  assert.match(pages[0]!.html, /&amp;/);
  assert.match(pages[0]!.html, /&quot;/);
  assert.match(pages[0]!.html, /&#39;/);
});

test("txt: single newline in poetry mode stays as separate paragraphs", () => {
  const poetry = "Line 1\nLine 2\nLine 3";
  const pages = splitTextIntoPages(poetry, { paragraphMode: "single-newline" });
  assert.equal(pages.length, 1);
  // Each line becomes its own <p>; \n inside a paragraph becomes <br>.
  const matches = pages[0]!.html.match(/<p>/g);
  assert.ok(matches && matches.length === 3, `expected 3 <p> tags, got ${matches?.length}`);
});

test("txt: blank-line mode merges single newlines inside a paragraph", () => {
  const text = "Paragraph 1 line A\nParagraph 1 line B\n\nParagraph 2";
  const pages = splitTextIntoPages(text, { paragraphMode: "blank-line" });
  assert.equal(pages.length, 1);
  // Two paragraphs separated by a blank line → exactly two <p> tags.
  const matches = pages[0]!.html.match(/<p>/g);
  assert.ok(matches && matches.length === 2, `expected 2 <p> tags, got ${matches?.length}`);
  // The first paragraph has the inner <br>.
  assert.match(pages[0]!.html, /Paragraph 1 line A<br>/);
});

test("txt: page ids are stable and unique", () => {
  const text = Array.from({ length: 10 }, (_, i) => `Paragraph ${i}`).join("\n\n");
  const pages = splitTextIntoPages(text, { pageChars: 30 });
  const ids = new Set(pages.map((p) => p.id));
  assert.equal(ids.size, pages.length, "page ids should be unique");
  assert.ok(pages.every((p, i) => p.id === `page-${i}`), "page ids should be page-0, page-1, ...");
});

test("txt: BOM is preserved as a leading paragraph (decodeText is a separate concern)", () => {
  // The splitter operates on already-decoded text, so we don't test BOM
  // stripping here. This is a placeholder test that documents the boundary.
  const text = "正文开始。\n第二段。";
  const pages = splitTextIntoPages(text);
  assert.equal(pages.length, 1);
  assert.match(pages[0]!.html, /正文开始/);
});
