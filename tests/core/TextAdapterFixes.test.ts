import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";

import type { Book } from "../../src/core/entities/Book";
import type { BookBytesLoader } from "../../src/core/ports/BookReader";
import type { PagedTextContent } from "../../src/adapters/text/PagedTextSession";
import { PagedTextSession } from "../../src/adapters/text/PagedTextSession";
import { TxtBookReader, decodeText, planTxtPages, splitTextIntoPages } from "../../src/adapters/text/TxtBookReader";
import { DEFAULT_READER_APPEARANCE } from "../../src/core/types/ReaderSettings";
import { codeOnly } from "./codeOnly";

/**
 * 三个 bug 的回归覆盖(TXT / MOBI 共用的纯文本适配层):
 *
 *  Bug 1 — `PagedTextSession` 把 `selectionchange` 挂在 **元素** 上。
 *          规范里 `selectionchange` 是 `Document` 上的事件, 不会在 Element
 *          上 dispatch, 也不会从 document 冒泡到元素 → 那条监听永远收不到。
 *          桌面端因为同时监听了 mouseup 碰巧能用, 移动端(Android WebView
 *          划词后浮窗不弹)整条路径是死的。
 *
 *  Bug 2 — `TxtBookReader.decodeText` 的 GB18030 回退没有保护 `TextDecoder`
 *          构造本身。老 WebView 不注册该 label 时 `new TextDecoder("gb18030")`
 *          抛 RangeError; 就算构造成功, 坏编码表也会解出整页 U+FFFD。
 *
 *  Bug 3 — `detectChapterTitle` 拿渲染后的 `page.html`(单行)去找"章节标题行",
 *          对 TXT 而言是死代码: 每页 chapterTitle 恒等于书名, 目录面板全是
 *          同一个名字, 章节跳转 / 进度点全废。
 */

const TXT_SRC = readFileSync(
  fileURLToPath(new URL("../../../src/adapters/text/TxtBookReader.ts", import.meta.url)),
  "utf8"
);
const PAGED_SRC = readFileSync(
  fileURLToPath(new URL("../../../src/adapters/text/PagedTextSession.ts", import.meta.url)),
  "utf8"
);

/**
 * 剥掉注释再断言 —— 用项目共享的 `tests/core/codeOnly.ts`(见该文件顶部注释:
 * 各测试文件自己复制一份正则版本会吞掉真实代码)。本项目的注释里**故意**
 * 引用了它替换掉的旧代码,不剥的话断言就变成了"注释里有没有这句话"的检查。
 */

// ---------------------------------------------------------------------------
// jsdom 环境 —— PagedTextSession 需要真实的 DOM 容器才能实例化
// ---------------------------------------------------------------------------

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
const DOM_GLOBALS = [
  "document",
  "window",
  "Node",
  "NodeFilter",
  "DocumentFragment",
  "Range",
  "HTMLElement",
  "HTMLStyleElement",
  "Text",
  "requestAnimationFrame",
  "DOMParser"
] as const;
for (const key of DOM_GLOBALS) {
  (globalThis as Record<string, unknown>)[key] = (dom.window as unknown as Record<string, unknown>)[key];
}
// jsdom 不做布局, 所以 Range 上没有 getBoundingClientRect(真实浏览器一定有)。
// 打这个补丁只是为了**测试环境**能跑通选择路径 —— 不是产品代码的问题:
// dispatchSelection 里 rect 本来就允许是 undefined。
const rangeProto = dom.window.Range.prototype as unknown as Record<string, unknown>;
if (typeof rangeProto["getBoundingClientRect"] !== "function") {
  rangeProto["getBoundingClientRect"] = (): DOMRect => new dom.window.DOMRect(0, 0, 0, 0);
}

/**
 * 派发一个 jsdom 原生 Event。
 *
 * 注意 `bubbles`:真实的 `selectionchange` **不冒泡**。要在元素上模拟一次
 * "只发给这个元素的事件"(用来证明元素上已经没有监听),必须用 bubbles=false;
 * 用 bubbles=true 会冒泡到 document 上,反而把 document 那条路径也测到了。
 */
const fire = (target: Document | Element, type: string, bubbles = true): boolean =>
  target.dispatchEvent(new dom.window.Event(type, { bubbles }));

const makeSession = (
  pages: ReadonlyArray<{ id: string; html: string }>
): PagedTextSession => {
  const content: PagedTextContent = { pages, toc: [], chapterStartPages: [] };
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

/** 在 session 当前渲染的页面里造一个真实选区, 返回被选中的文本。 */
const selectInStage = (session: PagedTextSession, end = 4): string => {
  const stage = session.element.querySelector(".ez-reader__paged-text");
  const firstParagraph = stage?.querySelector("p");
  const textNode = firstParagraph?.firstChild;
  assert.ok(textNode instanceof Text, "stage 里应该有一个文本节点可供选区使用");
  const doc = stage!.ownerDocument;
  const range = doc.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, end);
  const selection = doc.getSelection();
  assert.ok(selection, "jsdom 必须提供 getSelection");
  selection.removeAllRanges();
  selection.addRange(range);
  return selection.toString();
};

const collectSelections = (session: PagedTextSession): string[] => {
  const fired: string[] = [];
  session.on("selection-change", (event) => {
    fired.push((event as CustomEvent<{ text: string }>).detail.text);
  });
  return fired;
};

// ===========================================================================
// Bug 1 — selectionchange 必须挂在 document 上
// ===========================================================================

const SENTENCE = "第一段文字内容。这是用来测试选词的一段中文文本。";

test("bug1: document 上的 selectionchange 能触发选词回调(移动端路径)", async () => {
  // 规范: selectionchange 只在 Document 上 dispatch。修复前监听挂在 stageEl
  // (一个 Element) 上, 浏览器永远不会往那儿发 —— 移动端划词浮窗因此不弹。
  const session = makeSession([{ id: "page-0", html: `<p>${SENTENCE}</p>` }]);
  const fired = collectSelections(session);
  const selected = selectInStage(session, 4);
  assert.equal(selected, "第一段文", "jsdom 选区本身要能工作, 否则本测试无意义");
  fire(document, "selectionchange");
  assert.deepEqual(fired, [selected], "document 上的 selectionchange 必须能驱动选词回调");
  await session.close();
});

test("bug1: selectionchange 不再挂在元素上(Element 上 dispatch 不应触发)", async () => {
  const session = makeSession([{ id: "page-0", html: `<p>${SENTENCE}</p>` }]);
  const fired = collectSelections(session);
  selectInStage(session, 4);
  const stage = session.element.querySelector(".ez-reader__paged-text")!;
  // bubbles=false:真实的 selectionchange 不冒泡,这里模拟"只发给这个元素
  // 的事件" —— 如果元素上还挂着监听,这条断言就会红。
  fire(stage, "selectionchange", false);
  assert.deepEqual(fired, [], "元素上不该再挂 selectionchange —— 那条路永远收不到事件");
  await session.close();
});

test("bug1: touchend 是移动端选词结束信号", async () => {
  // 修复前只有 mouseup, 移动端划词抬手(pointerup / touchend)完全没人听。
  const session = makeSession([{ id: "page-0", html: `<p>${SENTENCE}</p>` }]);
  const fired = collectSelections(session);
  const selected = selectInStage(session, 4);
  const stage = session.element.querySelector(".ez-reader__paged-text")!;
  fire(stage, "touchend");
  assert.deepEqual(fired, [selected], "touchend 应当作为选词结束信号派发选词回调");
  await session.close();
});

test("bug1: 翻页不会重复注册 document 上的 selectionchange 监听", async () => {
  const session = makeSession([
    { id: "page-0", html: `<p>${SENTENCE}</p>` },
    { id: "page-1", html: `<p>${SENTENCE}</p>` },
    { id: "page-2", html: `<p>${SENTENCE}</p>` }
  ]);
  for (let i = 0; i < 5; i++) {
    await session.goTo({ kind: "next" });
  }
  const fired = collectSelections(session);
  const selected = selectInStage(session, 4);
  fire(document, "selectionchange");
  assert.deepEqual(
    fired,
    [selected],
    "翻 5 次页后一次派发只应回调 1 次(修复前每页挂一个 → 回调 0 次, 因为挂在元素上; 若改成挂在 document 又每次重挂则会回调多次)"
  );
  await session.close();
});

test("bug1: document 监听只注册一次, close() 用同一函数引用解绑", async () => {
  const doc = document as unknown as {
    addEventListener: (type: string, listener: unknown, options?: unknown) => void;
    removeEventListener: (type: string, listener: unknown, options?: unknown) => void;
  };
  type Record_ = { type: string; listener: unknown };
  const added: Record_[] = [];
  const removed: Record_[] = [];
  const realAdd = doc.addEventListener;
  const realRemove = doc.removeEventListener;
  doc.addEventListener = (type, listener, options) => {
    if (type === "selectionchange") added.push({ type, listener });
    realAdd(type, listener, options);
  };
  doc.removeEventListener = (type, listener, options) => {
    if (type === "selectionchange") removed.push({ type, listener });
    realRemove(type, listener, options);
  };
  let session: PagedTextSession;
  try {
    session = makeSession([{ id: "page-0", html: `<p>${SENTENCE}</p>` }]);
    assert.equal(added.length, 1, "document 上只应注册一个 selectionchange 监听(不能每次翻页重挂)");
    await session.close();
  } finally {
    doc.addEventListener = realAdd;
    doc.removeEventListener = realRemove;
  }
  assert.equal(removed.length, 1, "close() 必须解绑 selectionchange");
  assert.equal(
    removed[0]?.listener,
    added[0]?.listener,
    "解绑必须用注册时那个函数引用(匿名函数 removeEventListener 是 no-op)"
  );
});

test("bug1: 源码里 selectionchange 不再挂在 stageEl / element 上", () => {
  const code = codeOnly(PAGED_SRC);
  assert.doesNotMatch(
    code,
    /stageEl\.addEventListener\(\s*"selectionchange"/,
    "selectionchange 不能挂在 stageEl(元素)上 —— 规范只在 Document 上 dispatch 它"
  );
  assert.doesNotMatch(
    code,
    /element\.addEventListener\(\s*"selectionchange"/,
    "selectionchange 不能挂在 this.element(元素)上 —— 规范只在 Document 上 dispatch 它"
  );
  assert.match(
    code,
    /ownerDocument\.addEventListener\(\s*"selectionchange"/,
    "selectionchange 必须注册到 Document(ownerDocument) 上"
  );
  assert.match(code, /addEventListener\(\s*"touchend"/, "移动端选词结束信号 touchend 必须存在");
});

// ===========================================================================
// Bug 2 — decodeText 的编码降级链必须对 TextDecoder 构造本身做保护
// ===========================================================================

/** "你好，世界!" 的 GBK/GB18030 字节(strict UTF-8 一定解不出来)。 */
const GBK_BYTES = new Uint8Array([
  0xc4, 0xe3, 0xba, 0xc3, 0xa3, 0xac, 0xca, 0xc0, 0xbd, 0xe7, 0x21
]);

interface DecoderStubSpec {
  /** 构造时抛 RangeError 的 label —— 模拟老 WebView 根本没注册 gb18030。 */
  readonly unsupported?: readonly string[];
  /** 构造成功但解出来全是 U+FFFD 的 label —— 模拟半吊子 polyfill / 坏编码表。 */
  readonly broken?: readonly string[];
  /** 会忽略 `{ fatal: true }` 选项的 label —— 模拟老 WebView 不支持该选项。 */
  readonly ignoresFatal?: readonly string[];
}

/**
 * 用一个假的全局 TextDecoder 跑一段代码, 返回结果。
 * `decodeText` 直接用全局 `TextDecoder`, 所以替换 `globalThis.TextDecoder`
 * 就能精确模拟各类 WebView 行为。
 */
const withDecoderStub = <T,>(spec: DecoderStubSpec, body: () => T): T => {
  const RealDecoder = globalThis.TextDecoder;
  const globals = globalThis as unknown as { TextDecoder: unknown };
  class StubTextDecoder {
    private readonly fatal: boolean;
    private readonly label: string;
    constructor(label: string, options?: { fatal?: boolean }) {
      this.label = String(label).toLowerCase();
      if ((spec.unsupported ?? []).includes(this.label)) {
        throw new RangeError(`The encoding label provided ('${label}') is invalid`);
      }
      this.fatal = options?.fatal === true && !(spec.ignoresFatal ?? []).includes(this.label);
    }
    decode(input?: ArrayBuffer | ArrayBufferView): string {
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(0);
      if ((spec.broken ?? []).includes(this.label)) return "\uFFFD".repeat(bytes.length);
      if (this.fatal) return new RealDecoder(this.label, { fatal: true }).decode(input);
      return new RealDecoder(this.label).decode(input);
    }
  }
  globals.TextDecoder = StubTextDecoder;
  try {
    return body();
  } finally {
    globals.TextDecoder = RealDecoder;
  }
};

test("bug2: 老 WebView 忽略 fatal 选项时, GBK 书仍能走 GB18030 降级链", () => {
  // 老 Android WebView 的 TextDecoder 不认 `{ fatal: true }`, 于是"严格 UTF-8"
  // 那一步静默成功并返回乱码, gb18030 回退**根本没机会跑** → 用户看到 mojibake。
  const result = withDecoderStub({ ignoresFatal: ["utf-8"] }, () =>
    decodeText(GBK_BYTES.buffer)
  );
  assert.equal(result, "你好，世界!");
});

test("bug2: gb18030 构造成功但解出全 U+FFFD 时不再返回整页豆腐块", () => {
  // 有些环境注册了 label 但编码表是坏的 —— 构造不抛, 解出来全是替换字符。
  // 修复前这里会把这个"成功"结果直接返回, 整页 U+FFFD, 一个字都读不出来。
  const result = withDecoderStub({ broken: ["gb18030", "gbk"] }, () =>
    decodeText(GBK_BYTES.buffer)
  );
  assert.ok(typeof result === "string" && result.length > 0, "必须返回非空文本");
  assert.ok(
    !result.includes("\uFFFD"),
    `坏编码表的输出必须被拒绝并继续降级, 实际返回 ${JSON.stringify(result)}`
  );
});

test("bug2: TextDecoder 对所有 label 都抛时 decodeText 仍不抛异常", () => {
  // 最坏情况: 运行时里的 TextDecoder 本身坏了 / 被 polyfill 覆盖成抛异常版。
  // 契约是"宁可给一段有损文本, 也不要整本书打不开"。
  const result = withDecoderStub(
    { unsupported: ["utf-8", "utf-16le", "utf-16be", "gb18030", "gbk", "windows-1252"] },
    () => decodeText(GBK_BYTES.buffer)
  );
  assert.ok(typeof result === "string" && result.length > 0, "最后的兜底必须给回一个非空字符串");
});

test("bug2 回归: 现代环境 GB18030 / UTF-16 解码行为不变", () => {
  assert.equal(decodeText(GBK_BYTES.buffer), "你好，世界!");
  const utf16: number[] = [0xff, 0xfe];
  for (const ch of "第一章") {
    const code = ch.codePointAt(0)!;
    utf16.push(code & 0xff, (code >> 8) & 0xff);
  }
  const result = decodeText(new Uint8Array(utf16).buffer);
  assert.ok(result.includes("第一章"), `UTF-16LE BOM 路径不能被降级链破坏, 实际 ${JSON.stringify(result)}`);
});

// ===========================================================================
// Bug 3 — TXT 的章节检测必须在"渲染前的原始行"上做
// ===========================================================================

// 每章 = 标题行 + 3 个 ~560 字段落。DEFAULT_PAGE_CHARS=1600 装不下整章,
// 所以章节标题一定落在**某一页的开头**(而不是和下一章挤在同一页里)——
// 一页只记一个 chapterTitle,两章挤一页时后一个会盖掉前一个。
const PARA = "这是一段用来凑够一页长度的正文,重复若干次以触发分页逻辑。".repeat(20);
const CHAPTER = (title: string): string[] => [title, "", PARA, "", PARA, "", PARA, ""];

const buildChapteredText = (): string =>
  ["演示之书", "", ...CHAPTER("第一章 天地的开端"), ...CHAPTER("第二章 山海的记忆"), ...CHAPTER("第三章 归途")].join("\n");

const makeBook = (path: string): Book => ({
  id: "book-text-adapter-fixes",
  locator: { path, format: "txt", sizeBytes: 1024, modifiedAt: 0 },
  metadata: null,
  sourceModifiedAt: 0,
  addedToLibraryAt: null,
  coverPath: null,
  pinnedAt: null
});

const openTxtBook = async (text: string, path = "/books/demo.txt"): Promise<PagedTextSession> => {
  const bytes = new TextEncoder().encode(text);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const loader: BookBytesLoader = async () => buffer;
  const host = document.createElement("div");
  document.body.append(host);
  return (await new TxtBookReader().open(
    makeBook(path),
    host,
    DEFAULT_READER_APPEARANCE,
    loader
  )) as PagedTextSession;
};

const chaptersOfEveryPage = async (session: PagedTextSession): Promise<Array<string | null>> => {
  const total = session.totalPages() ?? 0;
  const chapters: Array<string | null> = [];
  for (let i = 0; i < total; i++) {
    await session.goTo({ kind: "identifier", value: String(i) });
    chapters.push(session.currentChapter());
  }
  return chapters;
};

test("bug3: 有章节的 TXT 各页 chapterTitle 不再恒等于书名", async () => {
  const session = await openTxtBook(buildChapteredText());
  const chapters = await chaptersOfEveryPage(session);
  assert.ok(chapters.length >= 3, `测试书至少要分 3 页, 实际 ${chapters.length} 页`);
  const distinct = new Set(chapters);
  assert.ok(
    distinct.size >= 3,
    `至少要识别出 3 个不同章节, 实际 ${JSON.stringify(chapters)}`
  );
  assert.ok(
    distinct.has("第一章 天地的开端"),
    `第 1 页应识别出章节名, 实际 ${JSON.stringify(chapters)}`
  );
  assert.ok(
    distinct.has("第二章 山海的记忆") && distinct.has("第三章 归途"),
    `后两章也应识别出来, 实际 ${JSON.stringify(chapters)}`
  );
  assert.ok(
    chapters.some((c) => c !== "演示之书"),
    "各页 chapterTitle 不能全是书名"
  );
  await session.close();
});

test("bug3: TXT 目录不再是单条 txt-root, 章节可跳转", async () => {
  const session = await openTxtBook(buildChapteredText());
  const toc = await session.tableOfContents();
  const labels = toc.map((item) => item.label);
  assert.ok(toc.length >= 4, `目录应有 书名 + 3 章, 实际 ${JSON.stringify(labels)}`);
  const third = toc.find((item) => item.label.includes("第三章"));
  assert.ok(third, `目录里应该有第三章, 实际 ${JSON.stringify(labels)}`);
  await session.goToToc(third!.id);
  assert.ok(
    (session.currentChapter() ?? "").includes("第三章"),
    `跳到第三章后 currentChapter 应是第三章, 实际 ${session.currentChapter()}`
  );
  await session.close();
});

test("bug3 回归: 没有章节标记的散文仍回落到书名且不抛异常", async () => {
  const session = await openTxtBook(`随笔\n\n${PARA}\n\n${PARA}\n\n${PARA}`);
  const chapters = await chaptersOfEveryPage(session);
  assert.ok(chapters.length >= 1);
  assert.ok(
    chapters.every((c) => typeof c === "string" && c.length > 0),
    `没有章节时也要有可显示的章节名, 实际 ${JSON.stringify(chapters)}`
  );
  const toc = await session.tableOfContents();
  assert.ok(toc.length >= 1, "至少要有书名那一条");
  await session.close();
});

test("bug3 回归: 加了章节检测之后分页结果与 splitTextIntoPages 逐字相同", () => {
  // planTxtPages 只是多带了一个 chapterTitle 字段,分页规则本身不能动 ——
  // MOBI 侧和 TxtPagination 的既有断言都依赖这一套边界计算。
  const samples: Array<{ text: string; options?: { pageChars?: number; paragraphMode?: "blank-line" | "single-newline" } }> = [
    { text: "" },
    { text: "Hello\n\nWorld" },
    { text: buildChapteredText() },
    { text: PARA.repeat(20), options: { pageChars: 400 } },
    { text: "a".repeat(5000), options: { pageChars: 1000 } },
    { text: "第一行\n第二行\n第三行", options: { paragraphMode: "single-newline" } }
  ];
  for (const sample of samples) {
    const legacy = splitTextIntoPages(sample.text, sample.options ?? {});
    const planned = planTxtPages(sample.text, "fallback", sample.options ?? {});
    assert.deepEqual(
      planned.pages.map((p) => p.html),
      legacy.map((p) => p.html),
      `分页 HTML 不一致 (${sample.text.slice(0, 12)}…)`
    );
    assert.deepEqual(
      planned.pages.map((p) => p.id),
      legacy.map((p) => p.id),
      "page id 不一致"
    );
  }
});

test("bug3: 源码里不再从渲染后的单行 HTML 反推章节标题", () => {
  const code = codeOnly(TXT_SRC);
  assert.doesNotMatch(
    code,
    /page\.html\.replace/,
    "章节检测必须基于分页前的原始行, 不能对 page.html 做 strip 之后再找标题行"
  );
  assert.match(
    code,
    /chapterTitle/,
    "分页结果仍然要带 chapterTitle(章节名要给工具栏 / TOC 用)"
  );
});
