import { test } from "node:test";
import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";
import type { BookBytesLoader } from "../../src/core/ports/BookReader";
import type { PagedTextContent } from "../../src/adapters/text/PagedTextSession";
import { PagedTextSession } from "../../src/adapters/text/PagedTextSession";
import { DEFAULT_READER_APPEARANCE } from "../../src/core/types/ReaderSettings";

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
const DOM_GLOBALS = [
  "document", "window", "Node", "NodeFilter", "DocumentFragment",
  "Range", "HTMLElement", "HTMLStyleElement", "Text", "requestAnimationFrame",
  "DOMParser"
];
for (const key of DOM_GLOBALS) {
  (globalThis as Record<string, unknown>)[key] = (dom.window as unknown as Record<string, unknown>)[key];
}

const makeContent = (pageCount: number): PagedTextContent => ({
  // PagedTextPage 的正文字段叫 `html` (显示用的 HTML), 不是 `text` ——
  // 之前这里写成 `text`, 端口一进类型检查就报 TS2322.
  pages: Array.from({ length: pageCount }, (_, i) => ({
    id: `chapter${(i + 1).toString().padStart(3, "0")}`,
    html: `page ${i + 1}`,
    css: []
  })),
  toc: [
    { id: "toc-0", label: "Chapter 1", depth: 0, locator: "0" },
    { id: "toc-1", label: "Chapter 2", depth: 0, locator: "1" },
    { id: "toc-2", label: "Chapter 3", depth: 0, locator: "2" }
  ],
  chapterStartPages: [0, 1, 2]
});

/**
 * 当前页的 0-based 下标.
 *
 * `PagedTextSession.currentPageIndex` 是 private, 外部读不到. 公开 API 里
 * `currentPage()` 返回的是 1-based 页码, 减 1 就是内部下标 —— 用公开 API
 * 推导, 不用 `as unknown as` 硬扒私有字段.
 */
const currentPageIndex = (session: PagedTextSession): number => (session.currentPage() ?? 1) - 1;

const makeSession = (pageCount: number): PagedTextSession => {
  const content = makeContent(pageCount);
  const host = document.createElement("div");
  document.body.append(host);
  const loader: BookBytesLoader = (async () => new ArrayBuffer(0)) as BookBytesLoader;
  return new PagedTextSession({
    content,
    host,
    appearance: DEFAULT_READER_APPEARANCE,
    loader
  });
};

test("PagedTextSession: goToSpineId turns to the matching page", async () => {
  const session = makeSession(5);
  await session.goToSpineId("chapter003");
  assert.equal(currentPageIndex(session), 2);
});

test("PagedTextSession: goToSpineId is a no-op for unknown id", async () => {
  const session = makeSession(5);
  await session.goToSpineId("chapter999");
  assert.equal(currentPageIndex(session), 0, "unknown id should not change current page");
});

test("PagedTextSession: goToSpineId strips #anchor suffix", async () => {
  const session = makeSession(5);
  await session.goToSpineId("chapter003#section-1");
  assert.equal(currentPageIndex(session), 2);
});

test("PagedTextSession: goToSpineId handles 9-digit MOBI spine ids", async () => {
  // Real MOBI spine ids are 9-digit padded numbers like "000000001".
  const content: PagedTextContent = {
    pages: Array.from({ length: 4 }, (_, i) => ({
      id: (i + 1).toString().padStart(9, "0"),
      html: `chapter ${i + 1}`,
      css: []
    })),
    toc: [],
    chapterStartPages: []
  };
  const host = document.createElement("div");
  document.body.append(host);
  const loader: BookBytesLoader = (async () => new ArrayBuffer(0)) as BookBytesLoader;
  const session = new PagedTextSession({
    content, host, appearance: DEFAULT_READER_APPEARANCE, loader
  });
  await session.goToSpineId("000000003");
  assert.equal(currentPageIndex(session), 2);
});

test("PagedTextSession: link-click event fires when an anchor with data-ez-reader-href is clicked", async () => {
  const session = makeSession(5);
  // Inject an anchor inside the rendered page.
  const stage = (session as unknown as { stageEl: HTMLElement }).stageEl;
  const anchor = document.createElement("a");
  anchor.setAttribute("data-ez-reader-href", "chapter003");
  anchor.textContent = "jump to chapter 3";
  stage.append(anchor);
  // Spy on session.element for "link-click" event.
  const element = session.element;
  let receivedHref: string | null = null;
  element.addEventListener("link-click", (event) => {
    receivedHref = (event as CustomEvent<{ href: string }>).detail.href;
  });
  // Click the anchor.
  anchor.click();
  assert.equal(receivedHref, "chapter003", "link-click should dispatch with href from data-ez-reader-href");
});

test("PagedTextSession: link-click is NOT dispatched for anchors without data-ez-reader-href", async () => {
  const session = makeSession(5);
  const stage = (session as unknown as { stageEl: HTMLElement }).stageEl;
  const anchor = document.createElement("a");
  anchor.setAttribute("href", "#some-anchor");
  anchor.textContent = "stay here";
  stage.append(anchor);
  const element = session.element;
  let fired = false;
  element.addEventListener("link-click", () => { fired = true; });
  anchor.click();
  assert.equal(fired, false, "anchors without data-ez-reader-href should not trigger link-click");
});
