/**
 * ShelfView 重渲染 + BookInfoModal 数据丢失三态的回归测试。
 *
 * 覆盖三个 bug:
 *  - Bug 1: ShelfView.renderRefresh 每次 empty() 重建 DOM, 浏览器把 scrollTop
 *           clamp 到 0 → 用户每敲一个搜索字符, 书架就弹回顶部.
 *  - Bug 2: LibraryService.getRichEntry 内部 catch {} 吞掉 sessions.jsonl 的
 *           IO 异常并返回空快照, BookInfoModal 却显示"暂无 session 记录" ——
 *           把"读取失败"谎报成"你没读过", 是会掩盖真实数据丢失的一类 bug.
 *  - Bug 3: getRichEntry reject(加载失败) 和 getRichEntry 返回 null(书被删)
 *           之前共用同一个 `missing` 标记, 结果加载失败也显示"找不到这本书".
 *
 * jsdom 注意事项: jsdom 没有 layout engine, 删掉子节点后 scrollTop 不会被
 * 浏览器那样自动归零。本文件在 `simulateBrowserScrollClamp` 里显式补上这段
 * 浏览器行为, 否则 Bug 1 在 jsdom 里根本测不出来(测了也是假绿)。
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { ShelfView } from "../../src/ui/shelf/ShelfView";
import { BookInfoModal } from "../../src/ui/shelf/BookInfoModal";
import type { BookInfoModalDeps } from "../../src/ui/shelf/BookInfoModal";
import type { LibraryEntry, LibraryService, RichLibraryEntry } from "../../src/core/services/LibraryService";
import type { BookInfo } from "../../src/core/entities/BookInfo";
import type { ReadingSession, DailyReadingTime } from "../../src/core/entities/ReadingSession";
import type { App, Workspace, WorkspaceLeaf } from "obsidian";
import type { ShelfFilter, SortCriterion } from "../../src/core/types/ShelfFilter";
import { installObsidianDomHelpers } from "../stubs/obsidian-stub.mjs";

// ---------------------------------------------------------------------------
// jsdom setup
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
 * Obsidian 运行时还有 `setCssStyles` / `setAttr`, obsidian-stub 没装.
 * 书架封面的占位配色 (placeholderCoverStyle) 依赖它, 这里补上,
 * 避免"测试跑不起来"被误当成"测试通过"(BUILD ERROR 不算验证)。
 */
const HTMLElementProto = globalThis.HTMLElement.prototype as unknown as Record<string, unknown>;
if (typeof HTMLElementProto.setCssStyles !== "function") {
  Object.defineProperty(HTMLElementProto, "setCssStyles", {
    value: function (styles: Record<string, string>) {
      for (const key of Object.keys(styles)) this.style.setProperty(key, styles[key]);
      return this;
    },
    writable: true,
    configurable: true
  });
}

/**
 * BookInfoModal.renderSessionRow 调的是 **全局** createDiv (Obsidian runtime
 * 就是这么暴露的), 而 stub 只装了方法形式 el.createDiv。这里镜像一个全局版本。
 */
(globalThis as Record<string, unknown>).createDiv = (options?: {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
}): HTMLElement => {
  const el = document.createElement("div");
  if (options?.cls) el.className = options.cls;
  if (options?.text != null) el.textContent = options.text;
  if (options?.attr) for (const key of Object.keys(options.attr)) {
    el.setAttribute(key, String(options.attr[key]));
  }
  return el;
};

/**
 * 剥掉源码里的注释再断言。
 *
 * 为什么必须剥: 本文件有一类断言是"某段**不该再出现**的旧文案 / 旧注释"。
 * 而我们修 bug 时为了讲清"为什么"会在注释里引用旧代码 —— 不剥注释的话,
 * 这些测试会匹配到自己写的注释, 变成永远绿的假测试。
 *
 * 两种注释都要剥:
 *  - /* ... *\/ 块注释 (含 JSDoc)
 *  - // ... 行注释
 */
const codeOnly = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");

const SHELF_SOURCE = readFileSync(
  new URL("../../../src/ui/shelf/ShelfView.ts", import.meta.url),
  "utf8"
);
const BOOK_INFO_SOURCE = readFileSync(
  new URL("../../../src/ui/shelf/BookInfoModal.ts", import.meta.url),
  "utf8"
);

// ===========================================================================
// ShelfView 测试脚手架
// ===========================================================================

const makeEntry = (title: string): LibraryEntry => ({
  book: {
    id: `books/${title}.epub`,
    locator: {
      path: `books/${title}.epub`,
      format: "epub",
      sizeBytes: 1024,
      modifiedAt: 1
    },
    metadata: { title, authors: ["Alice"], languages: ["zh-CN"], cachedAt: 0 },
    sourceModifiedAt: 1,
    addedToLibraryAt: 1,
    coverPath: null,
    pinnedAt: null
  },
  reading: {
    bookId: `books/${title}.epub`,
    position: null,
    status: "reading",
    favorite: false,
    lastOpenedAt: null,
    totalReadingMs: 0
  }
});

/**
 * 书架测试用的 LibraryService 替身。只实现 ShelfView 真正调到的三个方法:
 * list / stats / subscribe。list 按 title 子串过滤, 好让搜索测试有意义。
 */
class FakeLibrary {
  entries: LibraryEntry[];
  listeners = new Set<() => void>();

  constructor(entries: LibraryEntry[]) {
    this.entries = entries;
  }

  list = (filter: ShelfFilter = {}, _sort?: SortCriterion): ReadonlyArray<LibraryEntry> => {
    const query = (filter.query ?? "").trim().toLocaleLowerCase();
    if (query.length === 0) return this.entries;
    return this.entries.filter((entry) =>
      (entry.book.metadata?.title ?? "").toLocaleLowerCase().includes(query)
    );
  };

  stats = (): {
    total: number; inLibrary: number;
    statuses: Record<string, number>; languages: ReadonlyMap<string, number>;
  } => ({
    total: this.entries.length,
    inLibrary: this.entries.length,
    statuses: { unread: 0, reading: this.entries.length, finished: 0, abandoned: 0 },
    languages: new Map<string, number>()
  });

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

/**
 * 补上 jsdom 缺的浏览器行为: 内容被清空后 scrollTop 归零。
 *
 * 真浏览器里 `element.empty()` 把子节点全删了, 元素的可滚动距离变成 0,
 * 规范要求 scrollTop 被 clamp 到 [0, scrollHeight - clientHeight] = [0, 0],
 * 于是 scrollTop 变成 0。jsdom 没有 layout engine, 删完子节点 scrollTop 原封不动 ——
 * 所以 Bug 1 在 jsdom 里"看起来是好的"。这里显式模拟, 让测试反映真实浏览器。
 */
const simulateBrowserScrollClamp = (el: HTMLElement): void => {
  Object.defineProperty(el, "empty", {
    value: function (this: HTMLElement) {
      while (this.firstChild) this.removeChild(this.firstChild);
      this.scrollTop = 0; // ← 浏览器 clamp, jsdom 不会做
      return this;
    },
    writable: true,
    configurable: true
  });
};

interface MountedShelf {
  readonly view: ShelfView;
  readonly body: HTMLElement;
  readonly containerEl: HTMLElement;
}

/** 造一个 ShelfView 并跑完 onOpen, 返回可操作的 body 滚动容器。 */
const mountShelf = async (entries: LibraryEntry[]): Promise<MountedShelf> => {
  const library = new FakeLibrary(entries);

  // Obsidian 的 ItemView.containerEl 结构: children[0] = view-header,
  // children[1] = view-content (ShelfView.onOpen 直接取 children[1])。
  const containerEl = document.createElement("div");
  containerEl.append(document.createElement("div"));
  const viewContent = document.createElement("div");
  containerEl.append(viewContent);

  const view = new ShelfView({} as WorkspaceLeaf, {
    app: {} as App,
    library: library as unknown as LibraryService,
    reading: {} as never,
    foliate: {} as never,
    openReader: async () => undefined
  });
  (view as unknown as { containerEl: HTMLElement }).containerEl = containerEl;

  await view.onOpen();

  const body = viewContent.querySelector(".ez-reader__shelf__body") as HTMLElement;
  assert.ok(body, "shelf body 应该被 onOpen 创建出来");
  simulateBrowserScrollClamp(body);
  return { view, body, containerEl };
};

/** 触发一次重渲染。renderRefresh 是 private, 测试直接强转调用。 */
const triggerRefresh = (view: ShelfView): void => {
  (view as unknown as { renderRefresh(): void }).renderRefresh();
};

/** 直接把搜索框的值设上并派发 input —— 走用户真实的输入路径(150ms debounce)。 */
const typeSearch = async (view: ShelfView, query: string): Promise<void> => {
  const input = (view as unknown as { containerEl: HTMLElement })
    .containerEl.querySelector("input[type=search]") as HTMLInputElement;
  assert.ok(input, "toolbar 应该有搜索框");
  input.value = query;
  input.dispatchEvent(new dom.window.Event("input"));
  // scheduleSearchRefresh 的 debounce 是 150ms, 多等 60ms 留余量。
  await new Promise<void>((resolve) => setTimeout(resolve, 260));
};

// ===========================================================================
// BookInfoModal 测试脚手架
// ===========================================================================

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

/** 造一个 rich entry, daily buckets 按 sessions 真实聚合, 避免假绿。 */
const makeRichEntry = (
  sessions: ReadonlyArray<ReadingSession>,
  days = 30
): RichLibraryEntry => {
  const now = new Date();
  now.setHours(12, 0, 0, 0);
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
  buckets.reverse(); // newest-first
  return {
    entry: makeLibraryEntry(),
    bookInfo: makeBookInfo(),
    dailyReadingTime: buckets,
    recentSessions: sessions.slice(-10).reverse(),
    readingStreakDays: buckets[0]?.totalMs ? 1 : 0,
    todayReadingMs: buckets[0]?.totalMs ?? 0,
    lastWeekReadingMs: buckets.slice(0, 7).reduce((acc, d) => acc + d.totalMs, 0),
    lastMonthReadingMs: buckets.reduce((acc, d) => acc + d.totalMs, 0)
  };
};

/**
 * 可编排的 LibraryService 替身。
 * `queue` 里每项是该次 getRichEntry 的返回值; `Error` 表示 reject。
 */
class ScriptedLibrary {
  queue: Array<RichLibraryEntry | null | Error>;
  calls = 0;

  constructor(queue: Array<RichLibraryEntry | null | Error>) {
    this.queue = queue;
  }

  getRichEntry = async (_bookId: string): Promise<RichLibraryEntry | null> => {
    const step = this.queue[Math.min(this.calls, this.queue.length - 1)];
    this.calls += 1;
    if (step instanceof Error) throw step;
    return step ?? null;
  };
}

/**
 * 可编排的 vault.adapter。BookInfoModal 现在会自己再探一次
 * ezreader/{sessions,info}/ 下的文件 IO 状态, 所以测试必须能精确控制
 * exists / read 各自成功、失败还是"文件不存在"。
 *
 * 按**目录**路由而不是硬编码完整文件名: BookInfoModal 自己算 stem
 * (sanitizeFileBase(title) + bookIdTag(bookId) 的 SHA-1 前 10 位), 测试里
 * 再抄一遍这个算法只会得到一个假绿(路径对不上 → 一律 exists:false →
 * 全部走"没读过"分支, 探测代码一行都没被测到)。
 */
interface ProbeFileSpec {
  /** 文件内容; null / 缺省 = 文件不存在。 */
  readonly content?: string | null;
  readonly readThrows?: boolean;
  readonly existsThrows?: boolean;
}

interface VaultStubOptions {
  readonly sessions?: ProbeFileSpec;
  readonly info?: ProbeFileSpec;
  /** 完全不提供 exists / read(模拟老 adapter, 探测应保持 unknown)。 */
  readonly noAdapter?: boolean;
  /** 收集 modal 实际请求过的路径, 供断言用。 */
  readonly requested?: string[];
}

const makeVaultAdapter = (options: VaultStubOptions): Record<string, unknown> => {
  if (options.noAdapter) {
    return { getResourcePath: (_p: string): string => "app://fake/cover.jpg" };
  }
  const requested = options.requested ?? [];
  const pick = (path: string): ProbeFileSpec | null => {
    if (path.includes("/sessions/")) return options.sessions ?? null;
    if (path.includes("/info/")) return options.info ?? null;
    return null;
  };
  return {
    getResourcePath: (_p: string): string => "app://fake/cover.jpg",
    exists: async (path: string): Promise<boolean> => {
      requested.push(path);
      const spec = pick(path);
      if (spec?.existsThrows) throw new Error(`EACCES: ${path}`);
      return spec !== null && typeof spec.content === "string";
    },
    read: async (path: string): Promise<string> => {
      requested.push(path);
      const spec = pick(path);
      if (spec?.readThrows) throw new Error(`parse failure: ${path}`);
      return typeof spec?.content === "string" ? spec.content : "";
    }
  };
};

const makeApp = (vaultOptions: VaultStubOptions = {}): App => {
  const workspace = {
    openLinkText: (_path: string, _source: string, _newLeaf: boolean): void => undefined
  } as unknown as Workspace;
  const app = {
    workspace,
    vault: { adapter: makeVaultAdapter(vaultOptions) }
  } as unknown as App;
  return app;
};

/** A sessions.jsonl body that parses as "the user did read this book". */
const SESSION_FILE_BODY = '{"startedAt":1,"endedAt":2,"durationMs":1800000}\n';

/**
 * 跑完 BookInfoModal 的完整生命周期并返回渲染结果。
 *
 * sessionsPath 用通配方式传入: BookInfoModal 自己算 stem
 * (sanitizeFileBase(title) + bookIdTag(bookId)), 断言里不该把实现细节
 * 重新硬编码一遍 —— 所以这里用正则从 modal 实际请求的路径里抓 sessions 文件。
 */
const mountModal = async (
  deps: BookInfoModalDeps,
  bookId = "book-x"
): Promise<{ readonly contentEl: HTMLElement; readonly titleEl: HTMLElement }> => {
  const modal = new BookInfoModal(deps.app, bookId, deps);
  const contentEl = document.createElement("div");
  const modalEl = document.createElement("div");
  const titleEl = document.createElement("h2");
  (modal as unknown as { contentEl: HTMLElement }).contentEl = contentEl;
  (modal as unknown as { modalEl: HTMLElement }).modalEl = modalEl;
  (modal as unknown as { titleEl: HTMLElement }).titleEl = titleEl;
  document.body.append(contentEl);

  // 探测 (adapter.exists / adapter.read) 也挂在 load() 的 await 链上,
  // 多 drain 几轮保证全部 settle。
  for (let i = 0; i < 5; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  modal.onOpen();
  return { contentEl, titleEl };
};

/** Assert the modal probed the per-book files under the right directories. */
const probedDirs = (requested: string[]): string[] =>
  Array.from(new Set(requested.map((p) => p.split("/").slice(0, 2).join("/")))).sort();

// ===========================================================================
// Bug 1 — ShelfView 重渲染清零滚动位置
// ===========================================================================

test("Bug1: scrollTop=300 时重渲染, 渲染后仍然是 300", async () => {
  const { view, body } = await mountShelf([makeEntry("三体"), makeEntry("活着")]);

  body.scrollTop = 300;
  assert.equal(body.scrollTop, 300, "前置条件: 重渲染前确实滚到了 300");

  triggerRefresh(view);

  assert.equal(
    body.scrollTop,
    300,
    `重渲染后 scrollTop 应保持 300, 实际 ${body.scrollTop} —— empty() 把滚动位置冲掉了`
  );
});

test("Bug1: 反复重渲染(模拟连续搜索)不会累积漂移", async () => {
  const { view, body } = await mountShelf([makeEntry("三体"), makeEntry("活着"), makeEntry("解忧")]);

  body.scrollTop = 512;
  for (let i = 0; i < 5; i += 1) {
    triggerRefresh(view);
  }
  assert.equal(body.scrollTop, 512, "连续 5 次重渲染后滚动位置仍应是 512");
});

test("Bug1: 用户真实敲搜索框触发重渲染, 滚动位置不丢", async () => {
  const { view, body } = await mountShelf([makeEntry("三体"), makeEntry("活着"), makeEntry("解忧")]);

  body.scrollTop = 300;
  await typeSearch(view, "活");

  // 过滤后还剩一本书, 内容没被清空到 0 条
  assert.equal(body.querySelectorAll(".ez-reader__shelf-grid__item").length, 1, "应只剩 1 本匹配");
  assert.equal(
    body.scrollTop,
    300,
    `搜索重渲染后 scrollTop 应保持 300, 实际 ${body.scrollTop}`
  );
});

test("Bug1: 空结果时回到顶部(不是保留越界 scrollTop)", async () => {
  const { view, body } = await mountShelf([makeEntry("三体"), makeEntry("活着")]);

  body.scrollTop = 300;
  await typeSearch(view, "不存在的书名xyz");

  assert.equal(
    body.querySelectorAll(".ez-reader__shelf-grid__item").length,
    0,
    "应该没有任何匹配项"
  );
  assert.equal(
    body.scrollTop,
    0,
    "结果为空时回到顶部是对的 —— 保留一个越界的 300 只会让空态看起来像被截断"
  );
});

test("Bug1: renderRefresh 在 empty() 之前取 scrollTop, 渲染完成之后才写回", () => {
  // 源码级断言: 顺序错了就白搭(比如先 empty 再取, 取到的永远是 0)。
  const methodBody = SHELF_SOURCE.slice(
    SHELF_SOURCE.indexOf("private renderRefresh"),
    SHELF_SOURCE.indexOf("private renderEmptyState")
  );
  const code = codeOnly(methodBody);
  const saveIndex = code.indexOf("scrollTop");
  const emptyIndex = code.indexOf(".empty()");
  const restoreIndex = code.lastIndexOf("scrollTop");

  assert.notEqual(saveIndex, -1, "renderRefresh 里应该出现 scrollTop");
  assert.notEqual(emptyIndex, -1, "renderRefresh 里应该仍有 body.empty()");
  assert.ok(
    saveIndex < emptyIndex,
    "必须在 body.empty() **之前** 读 scrollTop, 否则读到的已经被浏览器重置成 0"
  );
  assert.ok(
    restoreIndex > emptyIndex,
    "必须在 DOM 重建之后才写回 scrollTop"
  );
});

// ===========================================================================
// Bug 2 — BookInfoModal 把"读取失败"谎报成"你没读过"
// ===========================================================================

test("Bug2: sessions.jsonl 读失败 → 红色警告, 绝不说'暂无 session 记录'", async () => {
  const requested: string[] = [];
  const deps: BookInfoModalDeps = {
    app: makeApp({
      requested,
      sessions: { content: SESSION_FILE_BODY, readThrows: true }
    }),
    library: new ScriptedLibrary([makeRichEntry([])]) as unknown as LibraryService,
    openReader: async () => undefined
  };

  const { contentEl } = await mountModal(deps);
  const html = contentEl.innerHTML;

  assert.deepEqual(
    probedDirs(requested),
    ["ezreader/info", "ezreader/sessions"],
    "modal 应该去 v0.3.0 的扁平目录里探测这两个文件"
  );
  assert.doesNotMatch(
    html,
    /暂无 session 记录/,
    "读取失败时还说'暂无 session 记录'就是把 IO 故障谎报成'你没读过'"
  );
  assert.match(html, /is-error/, "读取失败必须渲染成警告样式(is-error)");
  assert.match(html, /读取失败/, "文案要明确说'读取失败'");
});

test("Bug2: sessions.jsonl 文件真不存在 → 正常空态, 不报警告", async () => {
  const deps: BookInfoModalDeps = {
    app: makeApp({ sessions: { content: null } }),
    library: new ScriptedLibrary([makeRichEntry([])]) as unknown as LibraryService,
    openReader: async () => undefined
  };

  const { contentEl } = await mountModal(deps);
  const html = contentEl.innerHTML;

  assert.match(html, /暂无 session 记录/, "真的没读过就显示空态");
  assert.doesNotMatch(
    html,
    /读取失败/,
    "文件不存在是正常情况, 不该吓用户"
  );
  assert.doesNotMatch(html, /is-error/, "正常空态不该带警告 class");
});

test("Bug2: 有 session 数据 → 显示记录, 不报警告", async () => {
  const todayMidnight = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const sessions = [makeSession(todayMidnight + 9 * 60_000, 30 * 60_000)];

  const deps: BookInfoModalDeps = {
    app: makeApp({ sessions: { content: SESSION_FILE_BODY } }),
    library: new ScriptedLibrary([makeRichEntry(sessions)]) as unknown as LibraryService,
    openReader: async () => undefined
  };

  const { contentEl } = await mountModal(deps);
  const html = contentEl.innerHTML;

  assert.match(html, /ez-reader__book-info-session-row/, "应该渲染出 session 行");
  assert.doesNotMatch(html, /读取失败/, "有数据就不该报读取失败");
});

test("Bug2: 文件里明明有内容但 recentSessions 为空 → 判定为读取失败(上游吞异常)", async () => {
  // 这是最关键的一格: LibraryService.getRichEntry 内部 catch {} 吞掉
  // loadReadingSessions 的异常后返回空数组。磁盘上的文件其实有数据。
  // 这种情况下 UI 如果还说"暂无 session 记录", 就等于告诉用户
  // "你的阅读记录没了" —— 而真相是"我们没读到"。
  const deps: BookInfoModalDeps = {
    app: makeApp({ sessions: { content: SESSION_FILE_BODY } }),
    library: new ScriptedLibrary([makeRichEntry([])]) as unknown as LibraryService,
    openReader: async () => undefined
  };

  const { contentEl } = await mountModal(deps);
  const html = contentEl.innerHTML;

  assert.doesNotMatch(
    html,
    /暂无 session 记录/,
    "磁盘上有记录但 UI 显示'暂无' = 掩盖数据丢失, 必须改口"
  );
  assert.match(html, /读取失败/, "应该判定为读取失败");
});

test("Bug2: 读取失败时柱状图也必须提示, 不能画成'从未阅读'", async () => {
  const deps: BookInfoModalDeps = {
    app: makeApp({ sessions: { content: SESSION_FILE_BODY, readThrows: true } }),
    library: new ScriptedLibrary([makeRichEntry([])]) as unknown as LibraryService,
    openReader: async () => undefined
  };

  const { contentEl } = await mountModal(deps);
  const chart = contentEl.querySelector(".ez-reader__book-info-bar-chart") as HTMLElement;
  assert.ok(chart, "柱状图容器应该存在");
  assert.ok(
    chart.classList.contains("is-empty"),
    "没读到数据时图表确实是空的"
  );
  assert.match(
    chart.innerHTML,
    /读取失败|没读出来/,
    "但 placeholder 必须说明是没读出来, 而不是'暂无阅读记录'"
  );
  assert.doesNotMatch(chart.innerHTML, /暂无阅读记录/, "不能画成用户没读过");
});

test("Bug2: 空态文案不再拿实现细节当解释", () => {
  const code = codeOnly(BOOK_INFO_SOURCE);
  assert.doesNotMatch(
    code,
    /在第一次关闭阅读器时创建/,
    "sessions.jsonl 的文件生命周期是实现细节, 不是给用户的解释"
  );
  assert.match(
    code,
    /暂无 session 记录/,
    "但正常的'没读过'文案要保留"
  );
});

test("Bug2: 探测失败不能牵连其他文件(一个失败不等于全部失败)", async () => {
  // info.md 读失败时, sessions 正常为空 → 只有 info 那条报警,
  // sessions 段仍然显示正常的"暂无 session 记录"。
  const deps: BookInfoModalDeps = {
    app: makeApp({
      info: { content: "title: x\n", readThrows: true }
    }),
    library: new ScriptedLibrary([makeRichEntry([])]) as unknown as LibraryService,
    openReader: async () => undefined
  };

  const { contentEl } = await mountModal(deps);
  const html = contentEl.innerHTML;

  assert.match(html, /读取失败/, "info.md 读失败要被报出来");
  assert.match(
    html,
    /书籍信息 \(info\)/,
    "横幅要点名是哪个文件失败了, 否则用户不知道该去看哪个"
  );
  assert.match(
    html,
    /暂无 session 记录/,
    "sessions 没读过就是没读过, 保持正常空态"
  );
});

test("Bug2: adapter 没有 exists/read 时保持沉默, 不制造假警报", async () => {
  const deps: BookInfoModalDeps = {
    app: makeApp({ noAdapter: true }),
    library: new ScriptedLibrary([makeRichEntry([])]) as unknown as LibraryService,
    openReader: async () => undefined
  };

  const { contentEl } = await mountModal(deps);
  const html = contentEl.innerHTML;

  assert.match(html, /暂无 session 记录/, "探测不了就退回普通空态");
  assert.doesNotMatch(
    html,
    /读取失败/,
    "探测不可用 ≠ 读取失败, 报假警报比不报更糟"
  );
});

// ===========================================================================
// Bug 3 — 加载失败 vs 书被删
// ===========================================================================

test("Bug3: getRichEntry reject → 显示加载失败, 不是'找不到这本书'", async () => {
  const deps: BookInfoModalDeps = {
    app: makeApp(),
    library: new ScriptedLibrary([new Error("vault IO exploded")]) as unknown as LibraryService,
    openReader: async () => undefined
  };

  const { contentEl } = await mountModal(deps);
  const html = contentEl.innerHTML;

  assert.doesNotMatch(
    html,
    /找不到这本书/,
    "加载失败跟'书被删了'是两回事, 报成'找不到'会让用户以为是自己误删的"
  );
  assert.match(html, /加载|读取|失败/, "应该明确说是加载/读取失败");
});

test("Bug3: 加载失败时给出原因 + 非用户责任的排查指引", async () => {
  const deps: BookInfoModalDeps = {
    app: makeApp(),
    library: new ScriptedLibrary([new Error("vault IO exploded")]) as unknown as LibraryService,
    openReader: async () => undefined
  };

  const { contentEl } = await mountModal(deps);
  const html = contentEl.innerHTML;

  assert.match(html, /vault IO exploded/, "把底层错误信息透出来, 方便用户/排障");
  assert.match(
    html,
    /同步|权限|冲突|ezreader/,
    "要告诉用户往 vault 同步 / 权限方向排查, 而不是让他怀疑自己的数据"
  );
});

test("Bug3: 加载失败状态带 is-error 警告样式", async () => {
  const deps: BookInfoModalDeps = {
    app: makeApp(),
    library: new ScriptedLibrary([new Error("boom")]) as unknown as LibraryService,
    openReader: async () => undefined
  };

  const { contentEl } = await mountModal(deps);
  assert.match(
    contentEl.innerHTML,
    /is-error/,
    "加载失败是异常态, 必须用警告样式, 不能长得跟正常空态一样"
  );
});

test("Bug3: 加载失败可以重试, 重试成功后恢复正常详情", async () => {
  const library = new ScriptedLibrary([
    new Error("transient"),
    makeRichEntry([makeSession(Date.now(), 60_000)])
  ]);
  const deps: BookInfoModalDeps = {
    app: makeApp(),
    library: library as unknown as LibraryService,
    openReader: async () => undefined
  };

  const { contentEl } = await mountModal(deps);
  assert.match(contentEl.innerHTML, /加载|读取|失败/, "第一次是失败态");

  const retry = Array.from(contentEl.querySelectorAll<HTMLElement>("button"))
    .find((b) => (b.textContent ?? "").includes("重试"));
  assert.ok(retry, "失败态应该提供重试按钮, 否则用户只能关掉重开");

  retry.dispatchEvent(new dom.window.Event("click"));
  for (let i = 0; i < 5; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  assert.match(contentEl.innerHTML, /ez-reader__book-info-session-row/, "重试后应渲染出 session 行");
  assert.equal(library.calls, 2, "重试应该真的重新请求了一次");
});

test("Bug3: getRichEntry 返回 null(书被删)仍然显示'找不到这本书'", async () => {
  const deps: BookInfoModalDeps = {
    app: makeApp(),
    library: new ScriptedLibrary([null]) as unknown as LibraryService,
    openReader: async () => undefined
  };

  const { contentEl } = await mountModal(deps);
  assert.match(
    contentEl.innerHTML,
    /找不到这本书/,
    "null 才是'书不在库里', 这条文案是对的, 不能被 Bug 3 的修复误伤"
  );
  assert.doesNotMatch(contentEl.innerHTML, /重试/, "书被删了, 重试没意义");
});

test("Bug3: null 与 reject 是两条互不相干的状态路径", () => {
  // 源码级: 之前 load() 的 catch 把 missing 置 true, 两条路径合并了。
  const loadBody = BOOK_INFO_SOURCE.slice(
    BOOK_INFO_SOURCE.indexOf("private async load"),
    BOOK_INFO_SOURCE.indexOf("onOpen(): void")
  );
  const code = codeOnly(loadBody);
  const missingSet = code.indexOf("missing");
  const errorSet = code.indexOf("loadError");
  assert.notEqual(missingSet, -1, "missing 标记应该还在(书被删的路径)");
  assert.notEqual(errorSet, -1, "应该新增一个独立的 loadError 通道");
  assert.ok(
    errorSet > 0 && code.slice(0, errorSet).includes("missing"),
    "loadError 必须跟 missing 分开存, 不能复用同一个标记"
  );
});
