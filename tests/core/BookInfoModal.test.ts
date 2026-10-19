import { test } from "node:test";
import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";
import { BookInfoModal } from "../../src/ui/shelf/BookInfoModal";
import type { BookInfoModalDeps } from "../../src/ui/shelf/BookInfoModal";
import type { LibraryEntry, LibraryService, RichLibraryEntry } from "../../src/core/services/LibraryService";
import type { BookInfo } from "../../src/core/entities/BookInfo";
import type { ReadingSession, DailyReadingTime } from "../../src/core/entities/ReadingSession";
import type { App, Workspace } from "obsidian";
import { installObsidianDomHelpers } from "../stubs/obsidian-stub.mjs";

// ---------------------------------------------------------------------------
// jsdom setup (mirrors ReaderPanelPolish.test.ts)
// ---------------------------------------------------------------------------

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
const DOM_GLOBALS = [
  "document", "window", "Node", "NodeFilter", "DocumentFragment",
  "Range", "HTMLElement", "HTMLStyleElement", "Text", "requestAnimationFrame"
];
for (const key of DOM_GLOBALS) {
  (globalThis as Record<string, unknown>)[key] = (dom.window as unknown as Record<string, unknown>)[key];
}
installObsidianDomHelpers(globalThis.HTMLElement);

/**
 * BookInfoModal.renderSessionRow calls `createDiv({ cls: ... })` as a
 * GLOBAL helper (Obsidian runtime exposes it that way). Our DOM-helpers
 * install only adds the METHOD form `el.createDiv(...)`. Mirror Obsidian's
 * global helper here — same option shape, returns the element but doesn't
 * auto-append (caller does `list.append(row)` explicitly).
 */
(globalThis as Record<string, unknown>).createDiv = (options?: {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
}): HTMLElement => {
  const el = document.createElement("div");
  if (options?.cls) el.className = options.cls;
  if (options?.text != null) el.textContent = options.text;
  if (options?.attr) for (const k of Object.keys(options.attr)) {
    el.setAttribute(k, String(options.attr[k]));
  }
  return el;
};

// ---------------------------------------------------------------------------
// Test doubles — minimal LibraryService + App stub
// ---------------------------------------------------------------------------

const makeBookInfo = (overrides: Partial<BookInfo> = {}): BookInfo => ({
  schemaVersion: 1,
  title: "测试书籍",
  authors: ["Alice"],
  bookId: "book-x",
  format: "epub",
  filePath: "books/test.epub",
  fileSizeBytes: 1024,
  fileModifiedAt: 1,
  addedToLibraryAt: 1,
  lastOpenedAt: null,
  status: "reading",
  progressFraction: 0.42,
  totalReadingMs: 0,
  excerptCount: 0,
  bookmarkCount: 0,
  thoughtCount: 0,
  favorite: false,
  pinnedAt: null,
  coverPath: null,
  updatedAt: 1,
  ...overrides
});

const makeLibraryEntry = (): LibraryEntry => ({
  book: {
    id: "book-x",
    locator: { path: "books/test.epub", format: "epub", sizeBytes: 1024, modifiedAt: 1 },
    metadata: { title: "测试书籍", authors: ["Alice"], languages: ["zh-CN"], cachedAt: 0 },
    sourceModifiedAt: 1,
    addedToLibraryAt: 1,
    coverPath: null,
    pinnedAt: null
  },
  reading: {
    bookId: "book-x",
    position: null,
    status: "reading",
    favorite: false,
    lastOpenedAt: null,
    totalReadingMs: 0
  }
});

const makeSession = (startedAtMs: number, durationMs: number): ReadingSession => ({
  startedAt: startedAtMs,
  endedAt: startedAtMs + durationMs,
  durationMs,
  progressStart: 0,
  progressEnd: 0
});

/** Build a rich entry with the given info + sessions. */
const makeRichEntry = (
  bookInfo: BookInfo,
  sessions: ReadonlyArray<ReadingSession>,
  days = 30
): RichLibraryEntry => {
  // We compute daily buckets + aggregates the same way LibraryService does,
  // so the modal renders them the same way it would in production.
  const now = new Date();
  now.setHours(12, 0, 0, 0); // noon — easy to bucket
  const todayMidnight = (() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets: DailyReadingTime[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const dayMsAbs = todayMidnight - i * dayMs;
    const date = new Date(dayMsAbs).toLocaleDateString("en-CA");
    const dayBucket = sessions.filter((s) => {
      const sd = new Date(s.startedAt);
      sd.setHours(0, 0, 0, 0);
      return sd.getTime() === dayMsAbs;
    });
    buckets.push({
      date,
      totalMs: dayBucket.reduce((acc, s) => acc + s.durationMs, 0),
      sessionCount: dayBucket.length
    });
  }
  // Newest-first per spec
  buckets.reverse();
  return {
    entry: makeLibraryEntry(),
    bookInfo,
    dailyReadingTime: buckets,
    recentSessions: sessions.slice(-10).reverse(),
    readingStreakDays: buckets[0]?.totalMs ? 1 : 0,
    todayReadingMs: buckets[0]?.totalMs ?? 0,
    lastWeekReadingMs: buckets.slice(0, 7).reduce((acc, b) => acc + b.totalMs, 0),
    lastMonthReadingMs: buckets.reduce((acc, b) => acc + b.totalMs, 0)
  };
};

/**
 * Spy-able fake library. Tracks calls to `getRichEntry` and lets each test
 * choose what to return (or throw).
 */
class FakeLibrary {
  richEntry: RichLibraryEntry | null;
  getRichEntryCalls = 0;

  constructor(richEntry: RichLibraryEntry | null) {
    this.richEntry = richEntry;
  }

  getRichEntry = async (_bookId: string): Promise<RichLibraryEntry | null> => {
    this.getRichEntryCalls += 1;
    if (this.richEntry === "THROW" as unknown as RichLibraryEntry) {
      throw new Error("getRichEntry failed");
    }
    return this.richEntry;
  };
}

/** Minimal App stub — only what BookInfoModal actually calls. */
const makeApp = (): App => {
  const workspace = {
    openLinkText: (_path: string, _source: string, _newLeaf: boolean): void => undefined
  } as unknown as Workspace;
  const app = {
    workspace,
    vault: {
      adapter: {
        getResourcePath: (_path: string): string => "app://fake/cover.jpg"
      }
    }
  } as unknown as App;
  return app;
};

/**
 * Construct a BookInfoModal and run through the full open lifecycle:
 * 1. Construct (which fires load() async)
 * 2. Wire up contentEl / modalEl / titleEl on the Modal stub
 * 3. Wait for the load promise to settle
 * 4. Call onOpen() to render
 *
 * Returns the rendered contentEl so the test can assert against innerHTML.
 */
const mountModal = async (
  deps: BookInfoModalDeps,
  bookId = "book-x"
): Promise<HTMLElement> => {
  const modal = new BookInfoModal(makeApp(), bookId, deps);
  // The Modal stub has empty constructor — set up the DOM props the
  // BookInfoModal methods use. Real Obsidian wires these in `open()`.
  const contentEl = document.createElement("div");
  const modalEl = document.createElement("div");
  const titleEl = document.createElement("h2");
  (modal as unknown as { contentEl: HTMLElement }).contentEl = contentEl;
  (modal as unknown as { modalEl: HTMLElement }).modalEl = modalEl;
  (modal as unknown as { titleEl: HTMLElement }).titleEl = titleEl;
  document.body.append(contentEl);

  // Drain microtasks so the load() chain resolves before we call onOpen().
  // load() awaits deps.library.getRichEntry(...) which itself awaits
  // internal Promises — setTimeout(0) gives us a few queue drains.
  for (let i = 0; i < 3; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  modal.onOpen();
  return contentEl;
};

// ===========================================================================
// Tests
// ===========================================================================

test("BookInfoModal: loading state (getRichEntry still in-flight) shows '加载中…'", async () => {
  // Library that never resolves — modal renders the loading placeholder.
  const neverResolve = new Promise<RichLibraryEntry>(() => undefined);
  const lib = {
    getRichEntry: () => neverResolve
  } as unknown as LibraryService;
  const deps: BookInfoModalDeps = {
    app: makeApp(),
    library: lib,
    openReader: async () => undefined
  };

  // We need to construct, set up DOM, then call onOpen. But the load()
  // promise is still pending — render() will see rich === null and render
  // the loading view.
  const modal = new BookInfoModal(makeApp(), "book-x", deps);
  const contentEl = document.createElement("div");
  const modalEl = document.createElement("div");
  const titleEl = document.createElement("h2");
  (modal as unknown as { contentEl: HTMLElement }).contentEl = contentEl;
  (modal as unknown as { modalEl: HTMLElement }).modalEl = modalEl;
  (modal as unknown as { titleEl: HTMLElement }).titleEl = titleEl;
  document.body.append(contentEl);

  modal.onOpen();

  assert.match(contentEl.innerHTML, /加载中/, "loading text shown");
});

test("BookInfoModal: loaded entry renders title, authors, progress, bar chart, sessions", async () => {
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const todayMidnight = (() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const sessions = [
    makeSession(todayMidnight + 9 * 60_000, 30 * 60_000),
    makeSession(todayMidnight - 1 * 24 * 60 * 60_000 + 14 * 60_000, 60 * 60_000)
  ];
  const rich = makeRichEntry(makeBookInfo({ title: "测试书名", authors: ["Author A"] }), sessions);
  const fakeLibrary = new FakeLibrary(rich);
  const deps: BookInfoModalDeps = {
    app: makeApp(),
    library: fakeLibrary as unknown as LibraryService,
    openReader: async () => undefined
  };

  const contentEl = await mountModal(deps);
  const html = contentEl.innerHTML;

  // Header
  assert.match(html, /测试书名/, "title rendered");
  assert.match(html, /Author A/, "authors rendered");
  // Progress section
  assert.match(html, /ez-reader__book-info-progress/, "progress section rendered");
  // Bar chart (30 buckets)
  assert.match(html, /ez-reader__book-info-bar-chart/, "bar chart rendered");
  assert.match(html, /ez-reader__book-info-bar-chart__bar/, "individual bars rendered");
  // Sessions list
  assert.match(html, /ez-reader__book-info-sessions/, "sessions section rendered");
  // Time stats
  assert.match(html, /ez-reader__book-info-time-stats/, "time stats tiles rendered");
});

test("BookInfoModal: missing optional fields render '—'", async () => {
  const info = makeBookInfo({
    title: "Empty Info",
    authors: [],
    published: undefined,
    publisher: undefined,
    isbn: undefined,
    language: undefined,
    pageCount: undefined,
    description: undefined
  });
  const rich = makeRichEntry(info, []);
  const deps: BookInfoModalDeps = {
    app: makeApp(),
    library: new FakeLibrary(rich) as unknown as LibraryService,
    openReader: async () => undefined
  };

  const contentEl = await mountModal(deps);
  const html = contentEl.innerHTML;

  // Multiple "—" should appear (one per missing meta field)
  const dashCount = (html.match(/—/g) || []).length;
  assert.ok(dashCount >= 3, `expected ≥ 3 dashes for missing fields; got ${dashCount}`);
  // Author unknown
  assert.match(html, /作者未知/, "unknown authors fallback rendered");
});

test("BookInfoModal: empty sessions shows placeholder text", async () => {
  const rich = makeRichEntry(makeBookInfo(), []);
  const deps: BookInfoModalDeps = {
    app: makeApp(),
    library: new FakeLibrary(rich) as unknown as LibraryService,
    openReader: async () => undefined
  };

  const contentEl = await mountModal(deps);
  const html = contentEl.innerHTML;
  assert.match(html, /暂无 session 记录/, "sessions placeholder rendered");
  // Also bar chart should be empty
  assert.match(html, /ez-reader__book-info-bar-chart is-empty/, "bar chart empty class");
  assert.match(html, /暂无阅读记录/, "bar chart placeholder rendered");
});

test("BookInfoModal: bar chart renders 30 bars, today bar has 'is-today' class", async () => {
  const sessions = [
    makeSession(Date.now(), 30 * 60_000)
  ];
  const rich = makeRichEntry(makeBookInfo(), sessions);
  const deps: BookInfoModalDeps = {
    app: makeApp(),
    library: new FakeLibrary(rich) as unknown as LibraryService,
    openReader: async () => undefined
  };

  const contentEl = await mountModal(deps);
  const bars = contentEl.querySelectorAll(".ez-reader__book-info-bar-chart__bar");
  assert.equal(bars.length, 30, "30 bars in the chart");

  // Today's bar = the bar after reversal (last in DOM order)
  const todayBar = contentEl.querySelector(".ez-reader__book-info-bar-chart__bar.is-today");
  assert.ok(todayBar, "today bar has is-today class");
});

test("BookInfoModal: progress bar width reflects progressFraction", async () => {
  const rich = makeRichEntry(makeBookInfo({ progressFraction: 0.42 }), []);
  const deps: BookInfoModalDeps = {
    app: makeApp(),
    library: new FakeLibrary(rich) as unknown as LibraryService,
    openReader: async () => undefined
  };

  const contentEl = await mountModal(deps);
  const fill = contentEl.querySelector<HTMLElement>(".ez-reader__book-info-progress__fill");
  assert.ok(fill, "progress fill exists");
  // width = "42.0%"
  assert.match(fill?.style.width ?? "", /^42%/, `expected 42% width; got ${fill?.style.width}`);
  // Label says "42%"
  assert.match(contentEl.innerHTML, /42%/, "progress label shows 42%");
});

test("BookInfoModal: footer has notes.md and info.md buttons", async () => {
  const rich = makeRichEntry(makeBookInfo({ title: "Footer Book" }), []);
  const deps: BookInfoModalDeps = {
    app: makeApp(),
    library: new FakeLibrary(rich) as unknown as LibraryService,
    openReader: async () => undefined
  };

  const contentEl = await mountModal(deps);
  const html = contentEl.innerHTML;
  assert.match(html, /📝 打开 notes\.md/, "notes.md button rendered");
  assert.match(html, /📊 打开 info\.md/, "info.md button rendered");
  assert.match(html, /ez-reader__book-info-footer/, "footer container rendered");
});

test("BookInfoModal: openReader dependency fires when 打开 button clicked", async () => {
  const rich = makeRichEntry(makeBookInfo(), []);
  let opened: LibraryEntry | null = null;
  const deps: BookInfoModalDeps = {
    app: makeApp(),
    library: new FakeLibrary(rich) as unknown as LibraryService,
    openReader: async (entry) => { opened = entry; }
  };

  const contentEl = await mountModal(deps);
  const openBtn = Array.from(contentEl.querySelectorAll<HTMLElement>("button"))
    .find((b) => b.textContent?.includes("📖 打开"));
  assert.ok(openBtn, "open button exists");
  openBtn?.dispatchEvent(new dom.window.Event("click"));
  assert.ok(opened, "openReader was called");
});

test("BookInfoModal: getRichEntry returns null → missing state", async () => {
  const lib = new FakeLibrary(null); // null → "missing"
  const deps: BookInfoModalDeps = {
    app: makeApp(),
    library: lib as unknown as LibraryService,
    openReader: async () => undefined
  };

  const contentEl = await mountModal(deps);
  assert.match(contentEl.innerHTML, /找不到这本书/, "missing state rendered");
});

test("BookInfoModal: getRichEntry throws → 报读取失败, 不谎报「找不到这本书」", async () => {
  // v0.3.3 行为变更。这条断言以前写的是 "missing state after throw" ——
  // 也就是**把 bug 编码进了测试**:`load()` 的 catch 里置 `missing = true`,
  // 于是 vault IO 挂掉(权限 / 磁盘 / 同步冲突)时, 用户看到的是"找不到这本书
  // — 可能已被移除或刷新过库"。用户会跑去 vault 翻文件, 甚至以为自己误删了书。
  //
  // v0.3.3 起 `missing` 只表示"getRichEntry 正常返回了 null"(书真被删),
  // 抛异常走独立的 `loadError` 通道。
  const throwingLibrary = {
    getRichEntry: async () => { throw new Error("vault IO 挂了"); }
  } as unknown as LibraryService;
  const deps: BookInfoModalDeps = {
    app: makeApp(),
    library: throwingLibrary,
    openReader: async () => undefined
  };

  const contentEl = await mountModal(deps);
  assert.doesNotMatch(
    contentEl.innerHTML,
    /找不到这本书/,
    "读取失败绝不能显示成书被删了 —— 那会让用户以为自己的数据没了"
  );
  assert.match(contentEl.innerHTML, /vault IO 挂了/, "底层错误要透出来, 便于排查");
  assert.match(contentEl.innerHTML, /重试/, "要有重试按钮 —— IO 挂掉常常是暂时的");
});
