import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { installObsidianDomHelpers } from "../stubs/obsidian-stub.mjs";
import { codeOnly } from "./codeOnly";
import {
  PdfOverlay,
  findPdfOverlayForLeaf,
  unmountAllPdfOverlays
} from "../../src/ui/reader/pdfOverlay";

/**
 * PdfOverlay 生命周期回归测试。
 *
 * 覆盖 4 个 review 发现的缺陷:
 *   1. mount() 中途抛异常 → disposers / MutationObserver / rAF / 6 个 body 级
 *      DOM 元素全部泄漏, 而且 ATTACHED 里留着一个半死不活的 overlay。
 *   2. unmount() 的幂等判断用错字段 (this.mounted 只在 mount 跑完才为 true)。
 *   3. 笔记面板整体重渲染会吞掉用户正在输入的 inline note。
 *   4. refreshNotesPanel() 是 async 但调用处大多 `void`, 失败时 unhandled
 *      rejection + 面板停在半渲染状态。
 *
 * 每个测试都先验证过「修复前因断言失败而红, 修复后变绿」。
 */

// ---------------------------------------------------------------------------
// jsdom 环境
// ---------------------------------------------------------------------------

// ⚠️ 不要开 `pretendToBeVisual`:它会在 jsdom 内部起一条永久的 16ms 定时器,
// node --test 的进程永远等不到 event loop 空, 直接挂住。这里自己用
// setTimeout 实现一对 rAF, 语义够用(只驱动 highlight 重定位), 又能被
// cancelAnimationFrame 干净地取消。
//
// 再加一层保险: 定时器 unref。PdfOverlay 的 rAF 循环是自续期的 —— 万一某个
// 测试在 unmount 之前就断言失败, 循环会一直排下一帧把 event loop 撑住,
// 表现成"整个测试文件卡住"而不是"一个用例红"。unref 让这条链永远不阻止
// Node 退出。
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "https://obsidian.md/"
});
dom.window.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
  const timer = setTimeout(() => cb(Date.now()), 16);
  (timer as unknown as { unref?: () => void }).unref?.();
  return timer as unknown as number;
}) as typeof dom.window.requestAnimationFrame;
dom.window.cancelAnimationFrame = ((handle: number): void => {
  clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
}) as typeof dom.window.cancelAnimationFrame;

const DOM_GLOBALS = [
  "document", "window", "Node", "NodeFilter", "TreeWalker", "Range", "Text",
  "Element", "HTMLElement", "MouseEvent", "KeyboardEvent", "FocusEvent",
  "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame", "CSS"
];
for (const key of DOM_GLOBALS) {
  const value = (dom.window as unknown as Record<string, unknown>)[key];
  if (value !== undefined) {
    (globalThis as Record<string, unknown>)[key] = value;
  }
}
installObsidianDomHelpers(globalThis.HTMLElement);

/**
 * 收尾时关掉 jsdom window。
 *
 * PdfOverlay 会往 `window.setTimeout` 里塞 30s 的静默 timer (阅读时长检测),
 * jsdom 的定时器是**真的 Node timer**, 会一直吊着 event loop, 于是整个测试
 * 文件明明跑完 0.2 秒, node --test 却要等 30 秒才退出。`window.close()` 是
 * jsdom 官方的拆除入口, 它会把窗口内所有 timer 清掉。
 *
 * 前提: 每个用例都在 finally 里 unmount 掉了自己的 overlay, 所以这里不会有
 * "半活的 overlay 被连带清掉" 的副作用。
 */
after(() => {
  dom.window.close();
});

/**
 * Obsidian 运行时给 HTMLElement.prototype 打的 `setCssProps` patch — 公共 stub
 * 里没有 (它只覆盖 createEl/createDiv 这些工厂方法), 而 PdfOverlay 到处在用。
 * 语义跟 Obsidian 一致: 把 camelCase key 转成 CSS 自定义属性名写进 style。
 * 注意 `setCssProps` 不是 Obsidian 公开 API 的稳定部分, 但 PDF overlay 现有
 * 代码已经全靠它, 测试必须跟上真实运行时。
 */
// `HTMLElement.prototype` 没有 index signature,直接 cast 到 `Record<string, unknown>`
// 会被 TS 拒(TS2352)。先过 `unknown` —— 这里就是要在 prototype 上探测一个非公开
// 的 patch 方法,TS 的类型信息对它没有发言权。
if (
  typeof (globalThis.HTMLElement.prototype as unknown as Record<string, unknown>).setCssProps !==
  "function"
) {
  Object.defineProperty(globalThis.HTMLElement.prototype, "setCssProps", {
    writable: true,
    configurable: true,
    value: function setCssProps(this: HTMLElement, props: Record<string, string | null>) {
      for (const key of Object.keys(props)) {
        const value = props[key];
        const cssName = `ezReader${key.charAt(0).toUpperCase()}${key.slice(1)}`;
        if (value === null) this.style.removeProperty(cssName);
        else this.style.setProperty(cssName, String(value));
      }
      return this;
    }
  });
}

// jsdom 没实现 scrollIntoView —— PdfOverlay.focusExcerptInPanel 直接调它。
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}

// jsdom 默认 `visibilityState === "prerender"` → `document.hidden === true`,
// 于是 tryStartPdfActiveSession 永远早退, 阅读时长 session 测不到。
// 钉成"可见 tab", 跟 PdfOverlay 在真实 Obsidian 里被 mount 的状态一致。
Object.defineProperty(dom.window.Document.prototype, "visibilityState", {
  configurable: true,
  get: () => "visible"
});
Object.defineProperty(dom.window.Document.prototype, "hidden", {
  configurable: true,
  get: () => false
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const ROOT = new URL("../../../", import.meta.url).pathname;
const readSource = (rel: string): string => readFileSync(`${ROOT}${rel}`, "utf8");

/** 让所有已排队的 promise / 定时器回调跑完。 */
const settle = async (turns = 3): Promise<void> => {
  for (let i = 0; i < turns; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
};

interface FakeExcerpt {
  id: string;
  bookId: string;
  text: string;
  note: string;
  tags: string[];
  locator: { position: { kind: "pdf"; page: number; selection?: string }; chapter: string };
  createdAt: number;
}

const makeExcerpt = (id: string, note: string, text = "地震波"): FakeExcerpt => ({
  id,
  bookId: "book-x",
  text,
  note,
  tags: [],
  locator: { position: { kind: "pdf", page: 3, selection: "#page=3" }, chapter: "" },
  createdAt: 1_700_000_000_000
});

class FakeReading {
  bookmarks: Array<{ id: string; bookId: string; label: string; locator: { position: { kind: "pdf"; page: number }; chapter: string }; createdAt: number }> = [];
  excerpts: FakeExcerpt[] = [];
  failListBookmarks = false;
  failRemoveExcerpt = false;
  failRemoveBookmark = false;
  failUpdateNote = false;
  failTranslationLocale = false;
  recordedSessions: unknown[] = [];
  noteUpdates: Array<{ id: string; note: string }> = [];

  async listBookmarks(_bookId: string): Promise<unknown[]> {
    if (this.failListBookmarks) throw new Error("data.json 读失败");
    return this.bookmarks;
  }

  async listExcerpts(_bookId: string): Promise<FakeExcerpt[]> {
    return this.excerpts;
  }

  async removeExcerpt(_bookId: string, id: string): Promise<void> {
    if (this.failRemoveExcerpt) throw new Error("写盘失败");
    this.excerpts = this.excerpts.filter((e) => e.id !== id);
  }

  async removeBookmark(_bookId: string, id: string): Promise<void> {
    if (this.failRemoveBookmark) throw new Error("写盘失败");
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id);
  }

  /**
   * 故意「记录但不回写」—— 测试要证明的是 DOM 里用户正在输入的文本没被重渲染
   * 吞掉, 如果这里顺手把 store 也改了, 重渲染就会"碰巧"显示新文本, 掩盖缺陷。
   */
  async updateExcerptNote(_bookId: string, id: string, patch: { note?: string }): Promise<void> {
    if (this.failUpdateNote) throw new Error("写盘失败");
    this.noteUpdates.push({ id, note: patch.note ?? "" });
  }

  async getTranslationLocale(): Promise<string> {
    // `failTranslationLocale` 用来触发 Plugin 那条
    // `new PdfOverlay() → await resolveBook() → mount()` 调用链的失败分支:
    // resolveBook 抛异常时 mount 永远不会跑, 构造函数挂在 body 上的 6 个元素
    // 就无人回收(而且此时不在 ATTACHED / ALL_ATTACHED 里, unmountAll 也扫不到)。
    if (this.failTranslationLocale) throw new Error("data.json 读不出来");
    return "zh-CN";
  }

  async updatePosition(): Promise<void> {}

  async addReadingTime(): Promise<void> {}

  async recordSession(...args: unknown[]): Promise<void> {
    this.recordedSessions.push(args);
  }

  async addExcerpt(): Promise<void> {}
}

const OVERLAY_SELECTORS = [
  ".ez-reader__pdf-overlay-menu",
  ".ez-reader__pdf-overlay-notes-btn",
  ".ez-reader__pdf-overlay-notes-panel",
  ".ez-reader__pdf-overlay-highlight-layer",
  ".ez-reader__pdf-overlay-search-bar",
  ".ez-reader__pdf-translation"
];

const overlayElementsInBody = (): number =>
  OVERLAY_SELECTORS.reduce((n, sel) => n + document.body.querySelectorAll(sel).length, 0);

/**
 * 清掉上一个用例残留的 overlay DOM。
 *
 * node --test 在**同一个进程**里跑完整个文件, 某个断言一旦先失败, 那个用例的
 * `unmount()` 就被跳过了 —— 于是它的 6 个 body 级元素留在 DOM 里, 下一个用例
 * 的 `querySelector(".ez-reader__pdf-overlay-notes-panel")` 会拿到上一个用例
 * 那个**没渲染过内容**的面板, 然后以"找不到 note 节点"假红。整轮下来这类
 * 级联假红比被测缺陷本身更难查, 所以每个用例搭环境前先清场。
 */
const purgeOverlayDom = (): void => {
  for (const sel of OVERLAY_SELECTORS) {
    document.body.querySelectorAll(sel).forEach((el) => el.remove());
  }
};

interface Harness {
  overlay: PdfOverlay;
  leaf: unknown;
  container: HTMLElement;
  reading: FakeReading;
}

/**
 * 搭一个能跑通 mount() 的最小 PDFView 环境。
 *
 * `opts.purge` 默认 true = 先清掉上一个用例残留的 overlay DOM (见
 * `purgeOverlayDom` 的说明)。测"多个 overlay 同时活着"的用例必须给第二个
 * harness 传 `{ purge: false }`, 否则它会把第一个 overlay 的 DOM 先清掉,
 * 断言 "两个 overlay × 6 个元素 = 12" 就只剩 6。
 */
const makeHarness = (excerpts: FakeExcerpt[] = [], opts: { purge?: boolean } = {}): Harness => {
  if (opts.purge !== false) purgeOverlayDom();
  const container = document.createElement("div");
  container.className = "pdf-view";
  container.appendChild(document.createElement("div")).className = "pdf-viewer";
  document.body.appendChild(container);

  const leaf = {
    detached: false,
    view: {
      containerEl: container,
      getViewType: () => "pdf",
      file: { path: "books/seismo.pdf" }
    }
  };

  const workspaceHandlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const workspace = {
    activeLeaf: leaf,
    on(event: string, handler: (...args: unknown[]) => void) {
      const set = workspaceHandlers.get(event) ?? new Set();
      set.add(handler);
      workspaceHandlers.set(event, set);
      return {};
    },
    off(event: string, handler: (...args: unknown[]) => void) {
      workspaceHandlers.get(event)?.delete(handler);
    },
    openLinkText: () => Promise.resolve()
  };

  const reading = new FakeReading();
  reading.excerpts = excerpts;

  const overlay = new PdfOverlay({
    app: { workspace },
    pdfLeaf: leaf,
    bookPath: "books/seismo.pdf",
    reading,
    translation: { translate: () => Promise.resolve({ text: "", detectedSource: null, providerId: "x" }) },
    library: {
      list: () => [
        {
          book: { id: "book-x", locator: { path: "books/seismo.pdf" }, metadata: { title: "地震学导论" } }
        }
      ]
    }
  } as unknown as ConstructorParameters<typeof PdfOverlay>[0]);

  return { overlay, leaf, container, reading };
};

/**
 * Plugin 装配 overlay 的真实顺序是 `await resolveBook(); overlay.mount();`
 * —— resolveBook 负责把 bookId 填上 (refreshNotesPanel / renderHighlights 都
 * 靠它), 漏掉这一步笔记面板会静默不渲染, 测试就会因为"找不到 note 节点"
 * 而假红。
 */
const mountOverlay = async (h: Harness): Promise<void> => {
  await h.overlay.resolveBook();
  h.overlay.mount();
  await settle();
};


// ---------------------------------------------------------------------------
// Bug 1: mount() 中途抛异常 → 资源全泄漏
// ---------------------------------------------------------------------------

test("Bug 1: mount() 中途抛异常时, 已注册的资源被完整清理且错误原样抛出", async () => {
  const h = makeHarness();
  await h.overlay.resolveBook();

  // 记录 document / window 上 add 与 remove 的配平情况 —— 有 listener 加了没删,
  // 就等于漏了一个活着的回调 (下一次选词会跑进一个已经不存在的 overlay)。
  const docAdds: string[] = [];
  const docRemoves: string[] = [];
  const winAdds: string[] = [];
  const winRemoves: string[] = [];
  const origDocAdd = document.addEventListener.bind(document);
  const origDocRemove = document.removeEventListener.bind(document);
  const origWinAdd = dom.window.addEventListener.bind(dom.window);
  const origWinRemove = dom.window.removeEventListener.bind(dom.window);
  const cancelRafCalls: number[] = [];
  const origCancelRaf = dom.window.cancelAnimationFrame.bind(dom.window);

  document.addEventListener = ((type: string, ...rest: unknown[]) => {
    docAdds.push(type);
    return (origDocAdd as (...a: unknown[]) => unknown)(type, ...rest);
  }) as typeof document.addEventListener;
  document.removeEventListener = ((type: string, ...rest: unknown[]) => {
    docRemoves.push(type);
    return (origDocRemove as (...a: unknown[]) => unknown)(type, ...rest);
  }) as typeof document.removeEventListener;
  dom.window.addEventListener = ((type: string, ...rest: unknown[]) => {
    winAdds.push(type);
    return (origWinAdd as (...a: unknown[]) => unknown)(type, ...rest);
  }) as typeof dom.window.addEventListener;
  dom.window.removeEventListener = ((type: string, ...rest: unknown[]) => {
    winRemoves.push(type);
    return (origWinRemove as (...a: unknown[]) => unknown)(type, ...rest);
  }) as typeof dom.window.removeEventListener;
  dom.window.cancelAnimationFrame = ((handle: number) => {
    cancelRafCalls.push(handle);
    return origCancelRaf(handle);
  }) as typeof dom.window.cancelAnimationFrame;

  // 第二个 MutationObserver.observe 抛异常 —— 模拟 PDF++ 之类插件改了 PDFView
  // 的 DOM 结构后观察失败。第一个 observer 已经 observe 成功 (disposer 也已入列),
  // 第二个的 disposer 还没来得及 push 就炸了。
  //
  // ⚠️ 计数器必须是**跨实例**的: mount() 里是两个独立的 `new MutationObserver`,
  // 每个实例自带 calls 的话第二次 observe 又从 1 开始数, 永远不炸。
  const observed: Array<{ disconnected: boolean }> = [];
  let observeCalls = 0;
  class ExplodingMutationObserver {
    constructor(_callback: MutationCallback) {}
    observe(): void {
      observeCalls += 1;
      if (observeCalls === 2) throw new Error("PDFView DOM 被第三方插件改写");
      observed.push({ disconnected: false });
    }
    disconnect(): void {
      const last = observed[observed.length - 1];
      if (last) last.disconnected = true;
    }
    takeRecords(): MutationRecord[] {
      return [];
    }
  }
  const origObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = ExplodingMutationObserver as unknown as typeof MutationObserver;

  const before = overlayElementsInBody();
  assert.equal(before, 6, "构造函数已经把 6 个 overlay 元素挂到 document.body");

  let thrown: unknown = null;
  try {
    h.overlay.mount();
  } catch (error) {
    thrown = error;
  }

  globalThis.MutationObserver = origObserver;
  document.addEventListener = origDocAdd as typeof document.addEventListener;
  document.removeEventListener = origDocRemove as typeof document.removeEventListener;
  dom.window.addEventListener = origWinAdd as typeof dom.window.addEventListener;
  dom.window.removeEventListener = origWinRemove as typeof dom.window.removeEventListener;
  dom.window.cancelAnimationFrame = origCancelRaf as typeof dom.window.cancelAnimationFrame;

  assert.ok(thrown instanceof Error, "mount() 必须把原始错误抛出去, 不能静默吞");
  assert.match((thrown as Error).message, /PDFView DOM 被第三方插件改写/);

  assert.deepEqual(
    [...docAdds].sort(),
    [...docRemoves].sort(),
    `document listener 泄漏: 加了 ${docAdds.join(",")} 但只删了 ${docRemoves.join(",")}`
  );
  assert.deepEqual(
    [...winAdds].sort(),
    [...winRemoves].sort(),
    `window listener 泄漏: 加了 ${winAdds.join(",")} 但只删了 ${winRemoves.join(",")}`
  );
  assert.equal(observed.length, 1, "第一个 observer observe 成功");
  assert.equal(observed[0]!.disconnected, true, "已 observe 的 MutationObserver 必须被 disconnect");
  assert.equal(cancelRafCalls.length, 1, "rAF 循环必须被 cancelAnimationFrame 取消");
  assert.equal(overlayElementsInBody(), 0, "6 个 overlay 元素必须从 document.body 移除");
  assert.equal(
    findPdfOverlayForLeaf(h.leaf as never),
    undefined,
    "ATTACHED 不能留一个半死不活的 overlay, 否则 attachOverlayToPdfLeafIfLibraryBook 会误判已挂载"
  );

  // 显式再调一次 unmount 也必须是 no-op, 不能抛。
  h.overlay.unmount();
  await settle();
});

// ---------------------------------------------------------------------------
// Bug 2: unmount() 幂等判断用错字段
// ---------------------------------------------------------------------------

test("Bug 2: 从没 mount 过的实例 unmount() 是安全的 no-op", async () => {
  const h = makeHarness();
  const before = overlayElementsInBody();
  assert.equal(before, 6, "构造函数已把 6 个 overlay 元素挂上 body");

  h.overlay.unmount();

  assert.equal(
    overlayElementsInBody(),
    before,
    "unmount() 不能对从没 mount 过的实例乱拆 DOM —— 那是构造器的产物, 由 mount 的 catch 负责"
  );
  assert.equal(findPdfOverlayForLeaf(h.leaf as never), undefined);

  // 清场, 免得这个实例的元素影响后续测试的计数。
  for (const sel of OVERLAY_SELECTORS) {
    document.body.querySelectorAll(sel).forEach((el) => el.remove());
  }
  await settle();
});

test("Bug 2: resolveBook 失败时构造函数挂在 body 上的 6 个元素被回收", async () => {
  // Plugin 的调用顺序是 `new PdfOverlay(...) → await resolveBook() → mount()`。
  // resolveBook 自己抛异常时 `mountStarted` 还是 false:
  //   - 调 `unmount()` 会被门槛挡住(那是"从没 mount 过"的 no-op 分支)
  //   - 实例也不在 ATTACHED / ALL_ATTACHED 里,`unmountAllPdfOverlays()` 扫不到
  // 所以这条路径只能由 resolveBook 自己兜底。真实触发来源是
  // `reading.getTranslationLocale()` 读 data.json 失败(权限 / 磁盘 / 同步冲突)。
  const h = makeHarness();
  h.reading.failTranslationLocale = true;
  const before = overlayElementsInBody();
  assert.equal(before, 6, "构造函数已把 6 个 overlay 元素挂上 body");

  await assert.rejects(
    () => h.overlay.resolveBook(),
    /data.json 读不出来/,
    "错误要原样抛出去 —— Plugin 的 catch 依赖它做日志,静默吞会变成无线索的失败"
  );

  assert.equal(
    overlayElementsInBody(),
    0,
    "resolveBook 失败后 body 上不应残留任何 overlay 元素"
  );
  // 未挂载的实例不该出现在任何注册表里 —— 否则 unmountAll 会去拆它没建的东西。
  assert.equal(findPdfOverlayForLeaf(h.leaf as never), undefined);

  await settle();
});

test("Bug 2: 重复 unmount() 不抛, 且阅读时长 session 只被 flush 一次", async () => {
  const h = makeHarness();
  await mountOverlay(h);

  // 让 active session 真正计费 (delta >= 1000ms), 这样 flushPdfActiveSession
  // 一定会走到 recordSession —— 重复 unmount 若重复 flush, 这里就会 > 1。
  const future = Date.now() + 5_000;
  const realNow = Date.now;
  Date.now = () => future;

  let threw: unknown = null;
  try {
    h.overlay.unmount();
    h.overlay.unmount();
    h.overlay.unmount();
  } catch (error) {
    threw = error;
  } finally {
    Date.now = realNow;
  }
  await settle();

  assert.equal(threw, null, `重复 unmount 不能抛: ${String(threw)}`);
  assert.equal(
    h.reading.recordedSessions.length,
    1,
    `会话只能 flush 一次, 实际 ${h.reading.recordedSessions.length} 次`
  );
  assert.equal(overlayElementsInBody(), 0, "overlay 元素必须全部移除");
  assert.equal(findPdfOverlayForLeaf(h.leaf as never), undefined);
  await settle();
});

// ---------------------------------------------------------------------------
// Bug 3: 重渲染吞掉用户正在输入的想法
// ---------------------------------------------------------------------------

test("Bug 3: 笔记面板重渲染时, 正在编辑的 inline note 文本不丢", async () => {
  const h = makeHarness([makeExcerpt("ex-1", "旧想法")]);
  await mountOverlay(h);
  try {
    // 打开面板 (toggleNotesPanel → refreshNotesPanel)。
    const btn = document.body.querySelector<HTMLElement>(".ez-reader__pdf-overlay-notes-btn");
    assert.ok(btn, "笔记按钮应已挂载");
    btn!.click();
    await settle();

    const panel = document.body.querySelector<HTMLElement>(".ez-reader__pdf-overlay-notes-panel");
    assert.ok(panel, "笔记面板应已挂载");
    const noteSel = ".ez-reader__pdf-overlay-notes-panel__note";
    let noteEl = panel!.querySelector<HTMLElement>(noteSel);
    assert.ok(noteEl, "摘录行里应有 note 节点");

    // 用户点进编辑态并输入 (fake store 不回写, 重渲染只可能靠 DOM 恢复)。
    noteEl!.click();
    assert.equal(noteEl!.getAttribute("data-editing"), "1", "click 后应进入编辑态");
    noteEl!.textContent = "边读边想: 走时函数其实是个微分方程";

    // 触发一次重渲染 (highlight 点击 / 加新摘录 / 删除摘录等 9 个触发点之一)。
    const refresh = (h.overlay as unknown as { refreshNotesPanel(): Promise<void> }).refreshNotesPanel;
    await refresh.call(h.overlay);
    await settle();

    noteEl = panel!.querySelector<HTMLElement>(noteSel);
    assert.ok(noteEl, "重渲染后 note 节点应重新生成");
    assert.equal(
      noteEl!.textContent,
      "边读边想: 走时函数其实是个微分方程",
      "用户正在输入的想法被重渲染吞掉了"
    );
    assert.equal(
      noteEl!.getAttribute("data-editing"),
      "1",
      "重渲染后应仍在编辑态, 否则用户的光标和输入焦点也一并丢失"
    );
  } finally {
    h.overlay.unmount();
    await settle();
  }
});

test("Bug 3: 用户把想法清空后重渲染, 空文本也不能被 store 的旧值盖回去", async () => {
  const h = makeHarness([makeExcerpt("ex-1", "之前存的想法")]);
  await mountOverlay(h);
  try {
    const btn = document.body.querySelector<HTMLElement>(".ez-reader__pdf-overlay-notes-btn");
    assert.ok(btn, "笔记按钮应已挂载");
    btn!.click();
    await settle();

    const panel = document.body.querySelector<HTMLElement>(".ez-reader__pdf-overlay-notes-panel");
    assert.ok(panel, "笔记面板应已挂载");
    const noteSel = ".ez-reader__pdf-overlay-notes-panel__note";
    const noteEl = panel!.querySelector<HTMLElement>(noteSel);
    assert.ok(noteEl, "摘录行里应有 note 节点");
    noteEl!.click();
    // 用户全选删除 —— 草稿是空串。这是最容易被"非空才保护"的实现漏掉的一档:
    // 空草稿一旦回落到 store 的旧值, 用户就看到自己刚删掉的想法又回来了。
    noteEl!.textContent = "";

    const refresh = (h.overlay as unknown as { refreshNotesPanel(): Promise<void> }).refreshNotesPanel;
    await refresh.call(h.overlay);
    await settle();

    const after = panel!.querySelector<HTMLElement>(noteSel);
    assert.ok(after, "重渲染后 note 节点应重新生成");
    assert.equal(after!.textContent, "", "空草稿被 store 的旧值盖回去了 —— 用户会以为删除没生效");
    assert.equal(after!.getAttribute("data-editing"), "1", "仍在编辑态");
  } finally {
    h.overlay.unmount();
    await settle();
  }
});

test("Bug 3: 恢复草稿时必须同时恢复 contentEditable (jsdom 观察不到, 源码级兜住)", () => {
  // 为什么只能源码级断言: jsdom 完全没有实现 contentEditable —— 设了不落到
  // attribute 上, `isContentEditable` 恒为 undefined (AGENTS.md §11.13 记过同款
  // 坑)。但这一行恰恰是"用户能不能接着敲"的关键: 只恢复 data-editing 的话,
  // 节点看着像在编辑, 实际点不进去输字。变异测试确认过: 删掉它, 本文件里
  // 没有任何 DOM 级断言会红。
  const src = codeOnly(readSource("src/ui/reader/pdfOverlay.ts"));
  const start = src.indexOf("const restoreNoteDraft = ");
  assert.ok(start > 0, "应存在 restoreNoteDraft helper");
  const body = src.slice(start, src.indexOf("const renderNotesPanelContent =", start));
  assert.match(
    body,
    /noteEl\.contentEditable = "true";/,
    "restoreNoteDraft 必须把 contenteditable 恢复成 true, 否则重渲染后用户没法接着敲"
  );
  assert.match(body, /setCaretIn\(noteEl, draft\.caretOffset\)/, "光标位置也要恢复");
});

// ---------------------------------------------------------------------------
// Bug 4: refreshNotesPanel 是 async 但调用处大多 void
// ---------------------------------------------------------------------------

test("Bug 4: 删除摘录失败不会产生 unhandled rejection", async () => {
  const h = makeHarness([makeExcerpt("ex-1", "")]);
  h.reading.failRemoveExcerpt = true;
  await mountOverlay(h);
  try {
    const btn = document.body.querySelector<HTMLElement>(".ez-reader__pdf-overlay-notes-btn");
    assert.ok(btn, "笔记按钮应已挂载");
    btn!.click();
    await settle();

    const panel = document.body.querySelector<HTMLElement>(".ez-reader__pdf-overlay-notes-panel");
    assert.ok(panel, "笔记面板应已挂载");
    const del = panel!.querySelector<HTMLElement>('[data-excerpt-id="ex-1"] .remove');
    assert.ok(del, "摘录行应有 × 删除按钮");

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    del!.click();
    await settle(5);
    process.off("unhandledRejection", onUnhandled);

    assert.deepEqual(
      unhandled,
      [],
      `fire-and-forget 的删除回调产生了 unhandled rejection: ${unhandled.map(String).join(" | ")}`
    );
  } finally {
    h.overlay.unmount();
    await settle();
  }
});

test("Bug 4: 删除书签失败不会产生 unhandled rejection", async () => {
  const h = makeHarness([makeExcerpt("ex-1", "")]);
  h.reading.bookmarks = [
    {
      id: "bm-1",
      bookId: "book-x",
      label: "关键论点 · 42%",
      locator: { position: { kind: "pdf", page: 3 }, chapter: "" },
      createdAt: 1_700_000_000_000
    }
  ];
  h.reading.failRemoveBookmark = true;
  await mountOverlay(h);
  try {
    const btn = document.body.querySelector<HTMLElement>(".ez-reader__pdf-overlay-notes-btn");
    assert.ok(btn, "笔记按钮应已挂载");
    btn!.click();
    await settle();

    const panel = document.body.querySelector<HTMLElement>(".ez-reader__pdf-overlay-notes-panel");
    assert.ok(panel, "笔记面板应已挂载");
    // 书签区渲染在摘录区之前, 所以第一个 .remove 就是书签的 ×。
    const del = panel!.querySelector<HTMLElement>(".remove");
    assert.ok(del, "书签行应有 × 删除按钮");
    assert.equal(
      panel!.querySelectorAll(".remove").length,
      2,
      "应同时有书签和摘录各一个删除按钮"
    );

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    del!.click();
    await settle(5);
    process.off("unhandledRejection", onUnhandled);

    assert.deepEqual(
      unhandled,
      [],
      `fire-and-forget 的书签删除产生了 unhandled rejection: ${unhandled.map(String).join(" | ")}`
    );
  } finally {
    h.overlay.unmount();
    await settle();
  }
});

test("Bug 4: 保存想法失败不会产生 unhandled rejection", async () => {
  const h = makeHarness([makeExcerpt("ex-1", "旧")]);
  h.reading.failUpdateNote = true;
  await mountOverlay(h);
  try {
    const btn = document.body.querySelector<HTMLElement>(".ez-reader__pdf-overlay-notes-btn");
    assert.ok(btn, "笔记按钮应已挂载");
    btn!.click();
    await settle();

    const panel = document.body.querySelector<HTMLElement>(".ez-reader__pdf-overlay-notes-panel");
    assert.ok(panel, "笔记面板应已挂载");
    const noteEl = panel!.querySelector<HTMLElement>(".ez-reader__pdf-overlay-notes-panel__note");
    assert.ok(noteEl, "摘录行里应有 note 节点");
    noteEl!.click();
    noteEl!.textContent = "写盘炸了也要保住用户输入";

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    noteEl!.dispatchEvent(new dom.window.FocusEvent("blur"));
    await settle(5);
    process.off("unhandledRejection", onUnhandled);

    assert.deepEqual(
      unhandled,
      [],
      `inline note 保存失败产生了 unhandled rejection: ${unhandled.map(String).join(" | ")}`
    );
  } finally {
    h.overlay.unmount();
    await settle();
  }
});

test("Bug 4: 每一个 refreshNotesPanel() 调用点都被 await 或 .catch 包住", () => {
  const src = codeOnly(readSource("src/ui/reader/pdfOverlay.ts"));
  // 逐个调用点看上下文: 前面是 `await ` 或者后面紧跟 `.catch` 才算被兜住。
  // 比"grep 有没有裸 void"更耐改 —— 以后有人写成 `.then()` 或换成别的收口
  // 名字, 这个断言依然成立; 而漏掉一个 `void` 它立刻红。
  const callSites = [...src.matchAll(/(.{0,6})this\.refreshNotesPanel\(\)(.{0,8})/gs)];
  assert.ok(callSites.length >= 4, `应至少找得到全部刷新触发点, 实际 ${callSites.length}`);
  const unguarded = callSites.filter(
    ([, before, after]) => !/await $/.test(before) && !/^\s*\.catch/.test(after)
  );
  assert.deepEqual(
    unguarded.map((m) => m[0]),
    [],
    "refreshNotesPanel() 是 async, 裸 void 会让失败变成 unhandled rejection; 必须走统一入口"
  );
  assert.match(
    src,
    /private requestNotesPanelRefresh\(\): void/,
    "应有一个吞错 + Notice 的 fire-and-forget 入口"
  );
});

// ---------------------------------------------------------------------------
// 卸载入口: unmountAllPdfOverlays()
// ---------------------------------------------------------------------------

test("unmountAllPdfOverlays: 把所有已挂载的 overlay 全部拆干净并返回个数", async () => {
  // 先确保上一次残留不在集合里 —— makeHarness 只清 DOM, 不碰 overlay 实例。
  unmountAllPdfOverlays();

  const first = makeHarness([makeExcerpt("ex-1", "第一条书")]);
  const firstLeaf = first.leaf;
  await mountOverlay(first);
  const second = makeHarness([makeExcerpt("ex-2", "第二条书")], { purge: false });
  const secondLeaf = second.leaf;
  await mountOverlay(second);

  assert.equal(overlayElementsInBody(), 12, "两个 overlay × 6 个 body 级元素");
  assert.ok(findPdfOverlayForLeaf(firstLeaf as never), "第一个 overlay 已登记");
  assert.ok(findPdfOverlayForLeaf(secondLeaf as never), "第二个 overlay 已登记");

  const unmounted = unmountAllPdfOverlays();
  await settle();

  assert.equal(unmounted, 2, "应报告卸载了 2 个 overlay");
  assert.equal(overlayElementsInBody(), 0, "两个 overlay 的 DOM 必须全部离开 document.body");
  assert.equal(findPdfOverlayForLeaf(firstLeaf as never), undefined, "ATTACHED 应被清空");
  assert.equal(findPdfOverlayForLeaf(secondLeaf as never), undefined, "ATTACHED 应被清空");

  // 幂等: 再调一次应该是 0, 而不是重复拆一遍或抛异常。
  assert.equal(unmountAllPdfOverlays(), 0, "重复调用应返回 0");
  await settle();
});

test("unmountAllPdfOverlays: 只算真正挂载过的, 不动从没 mount 过的实例", async () => {
  unmountAllPdfOverlays();
  const mounted = makeHarness([makeExcerpt("ex-1", "挂上了")]);
  await mountOverlay(mounted);
  const orphan = makeHarness([], { purge: false });
  const before = overlayElementsInBody();
  assert.equal(before, 12, "1 个已挂载 + 1 个只构造没挂载");

  const unmounted = unmountAllPdfOverlays();
  await settle();

  assert.equal(unmounted, 1, "只统计真正 attach 过的 overlay");
  assert.equal(
    overlayElementsInBody(),
    6,
    "从没 mount 过的实例不该被 unmountAllPdfOverlays 拆 —— 它的 DOM 是构造器的产物"
  );
  // 清场, 别把 6 个残留元素留给后面的用例。
  purgeOverlayDom();
  await settle();
});
