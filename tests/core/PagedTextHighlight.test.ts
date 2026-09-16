import { test } from "node:test";
import { strict as assert } from "node:assert";

import { JSDOM } from "jsdom";

import type { BookBytesLoader, ReaderSession } from "../../src/core/ports/BookReader";
import type { PagedTextContent } from "../../src/adapters/text/PagedTextSession";
import { PagedTextSession } from "../../src/adapters/text/PagedTextSession";
import { DEFAULT_READER_APPEARANCE } from "../../src/core/types/ReaderSettings";

/**
 * Tests for PagedTextSession.applyHighlightOverlay — covers P0-2
 * (multi-paragraph highlights used to be silently dropped because
 * Range.surroundContents() throws when the range crosses element
 * boundaries). Runs under jsdom so we can drive a real DOM.
 */

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
const previousGlobals: Record<string, unknown> = {};
// Copy jsdom's DOM globals onto globalThis so PagedTextSession can
// reach them via `globalThis.document` etc. We snapshot the existing
// values first so the teardown test can restore them.
const DOM_GLOBALS = [
  "document",
  "window",
  "NodeFilter",
  "Node",
  "DocumentFragment",
  "Range",
  "HTMLElement",
  "HTMLStyleElement",
  "Text",
  "requestAnimationFrame"
];
for (const key of DOM_GLOBALS) {
  previousGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
for (const key of DOM_GLOBALS) {
  (globalThis as Record<string, unknown>)[key] = (dom.window as unknown as Record<string, unknown>)[key];
}

const makeSession = (pages: ReadonlyArray<{ id: string; html: string }>): ReaderSession => {
  const content: PagedTextContent = {
    pages,
    toc: [],
    chapterStartPages: []
  };
  const host = document.createElement("div");
  document.body.append(host);
  const session = new PagedTextSession({
    content,
    host,
    appearance: DEFAULT_READER_APPEARANCE,
    loader: (async () => new ArrayBuffer(0)) as BookBytesLoader
  });
  return session;
};

const countHighlightMarks = (session: ReaderSession, id: string): number => {
  const stage = session.element.querySelector(".ez-reader__paged-text");
  if (!stage) return 0;
  return stage.querySelectorAll(`mark[data-ez-reader-highlight-id="${id}"]`).length;
};

const sessionTextContent = (session: ReaderSession): string => {
  const stage = session.element.querySelector(".ez-reader__paged-text");
  return stage?.textContent ?? "";
};

test("highlight: single-paragraph highlight wraps a <mark>", async () => {
  const session = makeSession([
    { id: "p1", html: "<p>第一段文字内容。</p><p>第二段文字内容。</p>" }
  ]);
  await session.highlight({
    id: "ex-1",
    text: "第一段文字",
    locator: "paged-text:0",
    color: "yellow",
    createdAt: 0
  });
  assert.equal(countHighlightMarks(session, "ex-1"), 1, "expected exactly one <mark>");
  // The mark should contain exactly the matched text.
  const mark = session.element.querySelector("mark[data-ez-reader-highlight-id='ex-1']");
  assert.ok(mark);
  assert.equal(mark?.textContent, "第一段文字");
  await session.close();
});

test("highlight: multi-paragraph highlight wraps multiple <mark>s", async () => {
  // P0-2 fix: the highlight text spans two <p> elements. The old
  // surroundContents() approach would throw and drop the highlight;
  // the new join-and-split approach should produce TWO marks (one per
  // paragraph) with the same data-ez-reader-highlight-id.
  const session = makeSession([
    { id: "p1", html: "<p>第一段文字内容。</p><p>第二段文字内容。</p><p>第三段文字内容。</p>" }
  ]);
  await session.highlight({
    id: "ex-2",
    text: "第一段文字内容。第二段文字内容。",
    locator: "paged-text:0",
    color: "blue",
    createdAt: 0
  });
  assert.equal(countHighlightMarks(session, "ex-2"), 2, "expected two <mark>s spanning the boundary");
  // Surrounding text should be intact — neither paragraph was dropped.
  const text = sessionTextContent(session);
  assert.ok(text.includes("第三段文字"), "third paragraph should still be present");
  assert.ok(text.includes("第一段"), "first paragraph preserved");
  assert.ok(text.includes("第二段"), "second paragraph preserved");
  await session.close();
});

test("highlight: cross-page highlight only renders on the page where the text lives", async () => {
  const session = makeSession([
    { id: "p0", html: "<p>第 1 页内容。</p>" },
    { id: "p1", html: "<p>第 2 页内容。</p>" }
  ]);
  await session.highlight({
    id: "ex-3",
    text: "第 2 页内容。",
    locator: "paged-text:1",
    color: "yellow",
    createdAt: 0
  });
  // Page 0 has no mark for this excerpt.
  assert.equal(countHighlightMarks(session, "ex-3"), 0);
  // Navigate to page 1 — mark should be present.
  await session.goTo({ kind: "identifier", value: 1 });
  assert.equal(countHighlightMarks(session, "ex-3"), 1);
  await session.close();
});

test("highlight: removeHighlight strips multi-segment marks and rejoins text", async () => {
  const session = makeSession([
    { id: "p1", html: "<p>第一段ABC。</p><p>第二段DEF。</p>" }
  ]);
  await session.highlight({
    id: "ex-4",
    text: "ABC。第二段DEF",
    locator: "paged-text:0",
    color: "yellow",
    createdAt: 0
  });
  assert.equal(countHighlightMarks(session, "ex-4"), 2);
  await session.removeHighlight("ex-4");
  assert.equal(countHighlightMarks(session, "ex-4"), 0, "all marks removed");
  // After removal the page text should match the original (modulo whitespace).
  const text = sessionTextContent(session);
  assert.ok(text.includes("第一段ABC"), "first paragraph rejoined");
  assert.ok(text.includes("第二段DEF"), "second paragraph rejoined");
  await session.close();
});

test("highlight: empty / unknown text is a no-op", async () => {
  const session = makeSession([
    { id: "p1", html: "<p>only this content</p>" }
  ]);
  await session.highlight({
    id: "ex-5",
    text: "",
    locator: "paged-text:0",
    color: "yellow",
    createdAt: 0
  });
  assert.equal(countHighlightMarks(session, "ex-5"), 0);
  await session.highlight({
    id: "ex-6",
    text: "not on this page",
    locator: "paged-text:0",
    color: "yellow",
    createdAt: 0
  });
  assert.equal(countHighlightMarks(session, "ex-6"), 0);
  await session.close();
});

// Restore global state so subsequent tests in the same process aren't polluted.
test("teardown: restore globals", () => {
  for (const key of DOM_GLOBALS) {
    (globalThis as Record<string, unknown>)[key] = previousGlobals[key];
  }
});
