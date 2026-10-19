import { Notice } from "obsidian";
import type { WorkspaceLeaf, App } from "obsidian";
import type { ReadingService } from "../../core/services/ReadingService";
import type { TranslationService } from "../../core/ports/TranslationProvider";
import type { LibraryWriter } from "../../core/ports/LibraryWriter";
import type { LibraryService } from "../../core/services/LibraryService";
import type { Bookmark } from "../../core/entities/Bookmark";
import type { Excerpt } from "../../core/entities/Excerpt";
import type { ReadingPosition } from "../../core/entities/ReadingState";
import type { Locale } from "../../core/types/Locale";
import { findHighlightRect, findNextPageWithText, findTextOnPage as findTextOnPageInLayer } from "../../core/pdf/highlight";
import { computeSelectionMenuPosition } from "./selectionMenuPosition";

/**
 * 浮层 UI, 挂在 Obsidian 内置 PDFView 的 leaf 上, 提供:
 * 1. 选区菜单 (翻译 / 摘录 / 复制)
 * 2. 笔记侧栏按钮 (右下角浮动, 点击展开显示书签 + 摘录列表)
 * 3. 高亮回显 (P5) — 用 text-anchor 算法在 text-layer 里找位置
 *
 * 实现要点 (vs 上一版):
 * - Overlay 元素挂到 `document.body` 而非 `containerEl` — PDFView 重建 DOM 时
 *   我们的浮层还在。position: fixed 是 viewport 相对, 跟父容器无关。
 * - Leaf 关闭检测: workspace 'active-leaf-change' + 检查 leaf.view 是否还
 *   存在 (PDFView.getViewType() === "pdf")。
 * - renderHighlights 加 debounce, MutationObserver 触发不再每次读盘。
 * - 高亮 div 位置在 viewport 变化时原地更新, 不再重建。
 * - handleTranslate 读 settings.translation.targetLocale, 不再硬编码 zh-CN。
 * - Module-level registry: 每 leaf 只有一个 overlay 实例, 同 leaf 重复挂载
 *   会先卸载旧的。
 */

interface PdfOverlayOptions {
  readonly app: App;
  readonly pdfLeaf: WorkspaceLeaf;
  readonly bookPath: string;
  readonly reading: ReadingService;
  readonly translation: TranslationService;
  readonly library: LibraryService;
  readonly noteWriter?: LibraryWriter;
}

interface PendingSelection {
  text: string;
  locator: string;
  pageNumber: number;
  /** Selection rect at the time of capture. Re-used to anchor the
   *  translation popover so it lands near where the user picked the
   *  word, not wherever the cursor has wandered since. */
  rect: DOMRect;
}

interface RenderedHighlight {
  excerptId: string;
  pageNumber: number;
  searchText: string;
  /** First (or only) highlight div for the selection. */
  div: HTMLElement;
  /** Additional divs for multi-rect selections (multi-word / multi-line). */
  extraDivs?: HTMLElement[];
}

const PDF_VIEW_TYPE = "pdf";

/** Cryptographically random ID. Avoids the same-millisecond collision that
 *  plagued the old `Date.now() + Math.random()` scheme — two excerpts saved
 *  within the same JS tick would dedupe-collide on later appendExcerpt calls.
 *
 *  P2-6: fallback 到 Math.random — Android 旧 WebView 没 randomUUID. */
const generateExcerptId = (prefix: "ex"): string => {
  const uuid = window.crypto?.randomUUID?.();
  if (typeof uuid === "string" && uuid.length > 0) {
    return `${prefix}-${uuid}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

/** Module-level registry — 每 leaf 最多挂一个 overlay 实例. */
const ATTACHED = new WeakMap<WorkspaceLeaf, PdfOverlay>();

/**
 * `ATTACHED` 的可遍历镜像。
 *
 * 为什么需要: `WeakMap` 不可迭代, 而插件卸载 / vault 重载这类"把当前所有
 * PDF overlay 拆干净"的场景需要枚举。`WeakMap` 本身是对的 (leaf 被 GC 时
 * 条目自动消失), 所以这里不是替代它而是补一个索引:
 * - `attachResources()` 登记, `unmount()` 注销 —— 两边成对, 正常路径不会残留。
 * - 兜底: 万一某个 overlay 因为 leaf 被 GC 或异常路径没能 unmount,
 *   `unmountAllPdfOverlays()` 至少能把它扫出来。
 *
 * 代价是强引用 (leaf 被 GC 掉但 overlay 没 unmount 时会挂住它) —— 换来的是
 * 一个能真正"全部卸载"的入口, 值得。
 */
const ALL_ATTACHED = new Set<PdfOverlay>();

/**
 * Public lookup — Plugin.handleProtocol 用这个找挂在 PDF leaf 上的 overlay,
 * 然后调 overlay.jumpToExcerpt 让 PDF 跳到对应摘录页 + 画 highlight. 不暴露
 * WeakMap 本身 (内部一致性靠 internal API), 只给一个 read-only 查询入口.
 */
export const findPdfOverlayForLeaf = (leaf: WorkspaceLeaf): PdfOverlay | undefined => {
  return ATTACHED.get(leaf);
};

/**
 * 把当前所有已挂载的 overlay 全部卸载。`Plugin.onunload` 调它。
 *
 * 为什么必须有: 用户禁用插件后, 每个开着的 PDF leaf 上仍然跑着
 *   - 一个 60fps 的 requestAnimationFrame 循环 (每帧 getBoundingClientRect)
 *   - 2 个 MutationObserver
 *   - document 上的 selectionchange / mousedown / visibilitychange listener
 *   - window 上的 resize / blur / focus listener
 * 这些回调都**闭包持有 view 引用**, 插件对象被卸载后它们照跑不误,
 * 而且 rAF 循环会让对应页面永远无法 GC —— 禁用一次插件泄漏一整批。
 *
 * ⚠️ `[...ALL_ATTACHED]` 取快照再逐个卸载, 让"被遍历的集合"和"被改写的集合"
 * 不是同一个对象。**如实说明**: 变异测试过 —— 直接 `for (const o of ALL_ATTACHED)`
 * 在当前实现下跑出来完全一样 (Set 的迭代器容忍 delete 当前元素, 会自动走到
 * 下一个)。所以取快照是**防御性**的, 不是在修一个已观测到的 bug; 真正的收益是
 * 以后有人往 `unmount()` 里加 `ALL_ATTACHED.add()` 时这里不会变成死循环。
 * 保留快照而不是"简化"回去, 是因为注释必须跟实测一致, 而快照本身零成本。
 *
 * 返回实际卸载了几个 —— 给调用方一个"有没有东西漏掉"的信号, 测试也靠它断言。
 */
export const unmountAllPdfOverlays = (): number => {
  let count = 0;
  for (const overlay of [...ALL_ATTACHED]) {
    try {
      overlay.unmount();
      count += 1;
    } catch (error) {
      // 一个 overlay 卸载失败不能阻断其余的 —— 否则用户在禁用插件时
      // 会看到后面几个 PDF leaf 的浮层永远留在屏幕上。
      console.warn("[ez-reader] unmountAllPdfOverlays: one overlay failed to unmount", error);
    }
  }
  return count;
};

/** Debounce — 合并短时间内的高频触发. */
const debounce = <Args extends unknown[]>(
  fn: (...args: Args) => void,
  ms: number
): ((...args: Args) => void) => {
  let timer: number | undefined;
  return (...args: Args) => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
};

/** 找到 PDFView 当前可见的页码 (DOM-based, 不依赖 PDF++ 私有 API). */
const findActivePageNumber = (container: HTMLElement): number | null => {
  // 优先从 selection 的 anchorNode 反查所在 page — 选词一定在某个 page 内,
  // 比 .active 之类的 heuristic 准得多 (PDF++ / Obsidian 自带 viewer 用的
  // active class 可能不一样).
  const sel = document.getSelection();
  if (sel?.anchorNode) {
    const anchor =
      sel.anchorNode instanceof Element
        ? sel.anchorNode
        : sel.anchorNode.parentElement;
    const pageEl = anchor?.closest(".pdf-page, .page");
    if (pageEl instanceof HTMLElement) {
      const n = pageEl.getAttribute("data-page-number");
      if (n && /^\d+$/.test(n)) return Number(n);
    }
  }
  const selectors = [
    ".pdf-page.active[data-page-number]",
    ".page.active[data-page-number]",
    ".pdf-viewer .page.active[data-page-number]"
  ];
  for (const sel of selectors) {
    const el = container.querySelector(sel);
    if (el instanceof HTMLElement) {
      const n = el.getAttribute("data-page-number");
      if (n && /^\d+$/.test(n)) return Number(n);
    }
  }
  // 找不到任何 page — 返回 null 让 caller 不记 pendingSelection (旧实现
  // fallback 到 page 1, 用户选词坐标被记成 page 1 而真实在 page 50,
  // 摘录全错).
  return null;
};

const isSelectionInContainer = (sel: Selection | null, container: HTMLElement): boolean => {
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  const node = sel.anchorNode;
  return Boolean(node && container.contains(node));
};

const findPageElement = (container: HTMLElement, pageNumber: number): HTMLElement | null => {
  const sel = `.pdf-page[data-page-number="${pageNumber}"], .page[data-page-number="${pageNumber}"]`;
  const el = container.querySelector(sel);
  return el instanceof HTMLElement ? el : null;
};

export class PdfOverlay {
  private readonly opts: PdfOverlayOptions;
  private readonly container: HTMLElement;
  private readonly menuEl: HTMLElement;
  private readonly notesBtn: HTMLElement;
  private readonly notesPanel: HTMLElement;
  private readonly highlightLayer: HTMLElement;
  private readonly searchBar: HTMLElement;
  /** P2: PDF 选词翻译的浮动小弹窗 — 替代之前的 `new Notice` toast (3 秒消失
   *  还盖在最上面, 译文长就截掉, 用户复制也不方便). 挂到 `document.body`,
   *  position: fixed, 锚定到选词 rect 附近 (复用 selectionMenuPosition).
   *  内容: 原文 (小) + 译文 (主) + 复制 / 换语言重译 / × 按钮. */
  private readonly translationPopoverEl: HTMLElement;
  private readonly disposers: Array<() => void> = [];
  private readonly highlightsByExcerpt = new Map<string, RenderedHighlight>();
  private pendingSelection: PendingSelection | undefined;
  private bookId: string | undefined;
  private bookTitle = "";
  private targetLocale = "zh-CN";
  private mounted = false;
  /**
   * P0: 「mount() 是否已经开始挂资源」—— 跟 `mounted` 分开是刻意的。
   *
   * `mounted` 只在 `mount()` 顺利跑到最后一行才置 true, 而 mount() 中途要
   * 注册十几个 listener、两个 MutationObserver、一条 rAF 循环。任何中途抛出的
   * 异常 (PDF++ 之类插件改了 PDFView 的 DOM 结构, `container.querySelector(...)`
   * 拿到 null) 都会让 `mounted` 永远停在 false —— 于是 `unmount()` 第一行
   * `if (!this.mounted) return;` 直接早退, disposers 里已经注册的 listener、
   * observer、rAF、六个挂在 document.body 上的元素**全部泄漏**, 而且
   * `ATTACHED` 里还留着一个半死不活的 overlay, 之后
   * `attachOverlayToPdfLeafIfLibraryBook` 的 `findPdfOverlayForLeaf(leaf)`
   * 幂等检查会误判"已经挂过了"从而永远不再补挂。
   *
   * 所以拆成两个标志:
   * - `mountStarted`: 进 mount() 第一行就置 true, 是**清理**的依据。
   * - `mounted`: mount() 跑完才置 true, 只表示"完全挂载成功", 给
   *   `onLayoutChange` 那种"活着才干活"的监听用。
   */
  private mountStarted = false;

  /**
   * P0 修复: 翻译结果 stale 守卫。每次 runTranslation 自增, await 之后只有
   * generation 仍然匹配才写 UI。旧请求不取消网络, 只是不让它覆盖新译文。
   * 与 `TranslationDrawer.translateGeneration` 同一套写法 —— PDF 侧之前漏了。
   */
  private translateGeneration = 0;
  /**
   * Marks the highlight layer as needing a reposition on the next animation
   * frame. Assigned in `mount()` once the rAF loop's closure exists; until
   * then it is a no-op so `mount()`-time callers are safe.
   */
  private markHighlightsDirty: () => void = () => {};
  /** P1: in-PDF find state — see `runPdfSearch`. */
  private pdfFindQuery = "";
  private pdfFindCurrentPage: number | null = null;
  private pdfFindMatchCount = 0;
  private readonly renderHighlightsDebounced: () => void;
  private readonly repositionHighlightsDebounced: () => void;
  /**
   * P2 polish: 阅读时长检测 (跟 ReaderView 4 条件算法一致) — 但 PDF 没有
   * ReaderView 那种 "host DOM", 全局 mousemove 会污染其他面板, 所以 PDF
   * 用 Obsidian PDFView 自带的 selection change / page change 作为 "用户
   * 还在看" 信号. 配合 visibilitychange + window.blur/focus 处理切窗.
   *
   * 字段含义跟 ReaderView 完全对应:
   * - `activeSinceMs`: 当前 active session 起始时间 (或 null)
   * - `lastPdfInteractionMs`: 最近一次 PDF page change / selection 时间
   * - `inactivityCheckTimer`: 30s setTimeout handle
   * - `windowHasFocus`: 由 focus/blur 维护
   * - `lastReadingFlushAt`: 30s 防抖 + 1min 阈值
   */
  private activeSinceMs: number | null = null;
  private lastPdfInteractionMs: number | null = null;
  private inactivityCheckTimer: number | undefined;
  private windowHasFocus = true;
  private lastReadingFlushAt = 0;
  private static readonly PDF_INACTIVITY_TIMEOUT_MS = 30_000;
  /**
   * P0 v0.3.0 fix: 当前 active session 的起始 page fraction. session
   * 启动时 capture, flush 时用最新页码算 progressEnd. 跟 ReaderView
   * 同 pattern, 让 sessions.jsonl 有真实数据可聚合.
   *
   * PDF 没有 chapter label, 传 undefined (ReadingSession.chapter 是可选).
   */
  private activeSessionProgressStart: number = 0;

  constructor(opts: PdfOverlayOptions) {
    this.opts = opts;
    this.container = opts.pdfLeaf.view.containerEl;
    // Overlay DOM 挂到 document.body — 不会被 PDFView 重建清掉
    this.menuEl = createSelectionMenu(document.body, {
      onTranslate: () => void this.handleTranslate(),
      onExcerpt: () => void this.handleExcerpt(),
      onThought: () => void this.handleThought(),
      onCopy: () => void this.handleCopy()
    });
    this.notesPanel = createNotesPanel(document.body);
    this.notesBtn = createNotesButton(document.body, {
      onClick: () => this.toggleNotesPanel(),
      bookPath: this.opts.bookPath
    });
    this.highlightLayer = createHighlightLayer(document.body);
    // 点击黄色高亮 → 打开笔记面板 + 滚动到这条摘录 + 进入想法编辑模式.
    // 事件委托: highlight div 是动态生成的, layer 上挂一次就够.
    this.highlightLayer.addEventListener("click", this.onHighlightClick);
    this.disposers.push(() =>
      this.highlightLayer.removeEventListener("click", this.onHighlightClick)
    );
    this.searchBar = createSearchBar(document.body, {
      onSearch: (q, fromStart) => void this.runPdfSearch(q, fromStart),
      onClose: () => this.closePdfSearch()
    });
    this.translationPopoverEl = createTranslationPopover(document.body, {
      onCopy: () => void this.handleCopyTranslation(),
      onCycleTarget: () => void this.handleCycleTranslationTarget()
    });

    this.renderHighlightsDebounced = debounce(() => void this.renderHighlights(), 250);
    this.repositionHighlightsDebounced = debounce(() => this.repositionHighlights(), 100);
    // Default: nothing has moved yet, but the first rAF frame should run.
    this.markHighlightsDirty();
  }

  /** Resolve bookId + title + translation locale. Must be awaited before mount. */
  async resolveBook(): Promise<void> {
    try {
      const entry = this.opts.library.list().find((e) => e.book.locator.path === this.opts.bookPath);
      if (entry) {
        this.bookId = entry.book.id;
        this.bookTitle = entry.book.metadata?.title ?? entry.book.locator.path;
      }
      this.targetLocale = await this.opts.reading.getTranslationLocale();
    } catch (error) {
      // 构造函数的 6 个 body 级元素已经挂在 document.body 上了, 而
      // `Plugin` 的调用顺序是 new → await resolveBook() → mount()。所以
      // resolveBook() 自己抛异常时 `mountStarted` 还是 false, 调 `unmount()`
      // 会被门槛直接挡住 —— 六个元素永远留在 body 上, 而且此时既不在
      // ATTACHED 也不在 ALL_ATTACHED 里, `unmountAllPdfOverlays()` 扫不到。
      // 真实的失败来源:`reading.getTranslationLocale()` 读 data.json 出错。
      this.detachConstructedDom();
      throw error;
    }
  }

  /**
   * 拆掉**构造函数**创建的资源(6 个 body 级 DOM 元素 + 它们上面的 listener),
   * 不碰 `mount()` 阶段才注册的东西(observer / rAF / 30s 静默 timer)。
   *
   * 与 `unmount()` 的区别只有一个门槛: `unmount()` 以 `mountStarted` 为准
   * (从没 mount 过的实例调它是 no-op,否则会去拆它还没建的 mount 阶段资源);
   * 这个方法专门服务"构造完了但 mount 没跑"的那条路径。
   *
   * 幂等: DOM 的 `.remove()` 本身幂等,`disposers` 也会被清空,重复调无害。
   */
  private detachConstructedDom(): void {
    for (const d of this.disposers) {
      try {
        d();
      } catch (error) {
        console.warn("[ez-reader] PdfOverlay disposer threw during teardown", error);
      }
    }
    this.disposers.length = 0;
    this.menuEl.remove();
    this.notesBtn.remove();
    this.notesPanel.remove();
    this.highlightLayer.remove();
    this.searchBar.remove();
    this.translationPopoverEl.remove();
  }

  /**
   * Attach to the PDFView leaf. Idempotent — 同 leaf 重复调用会先卸载旧的.
   *
   * P0: 整体包 try/catch。任何中途抛出的异常都必须把**已经注册的部分资源**
   * 拆干净再抛出去 —— 之前 `this.mounted = true` 在最后一行, 中途抛异常时
   * `unmount()` 会被 `!this.mounted` 挡住, 于是 listener / MutationObserver /
   * rAF / 六个 body 级 DOM 元素全部泄漏, `ATTACHED` 里还留一个死 overlay。
   * 真实触发场景: PDF++ 之类插件接管 PDFView 后改了 DOM 结构, mount 中途
   * 某一处解引用拿到 null 就抛。
   *
   * 为什么**重抛**而不是吞掉: 调用方 (`Plugin.attachOverlayToPdfLeafIfLibraryBook`)
   * 已经有 try/catch + 日志, 静默吞会让"这个 PDF 挂不上 overlay"变成一条
   * 没有线索的静默失败; 而 Plugin 不在本次改动范围内, 不能反过来改它。
   */
  mount(): void {
    if (this.mountStarted) return;
    this.mountStarted = true;
    try {
      this.attachResources();
    } catch (error) {
      // 清理必须发生在重抛**之前**, 否则调用方的 catch 里再调 unmount() 也
      // 什么都没做 (unmount 靠 mountStarted 判断, 而这里刚把它用掉了)。
      this.unmount();
      throw error;
    }
  }

  /** 真正的挂载逻辑 —— 只由 `mount()` 调用, 不要从别处直接调。 */
  private attachResources(): void {
    const existing = ATTACHED.get(this.opts.pdfLeaf);
    if (existing && existing !== this) {
      existing.unmount();
    }
    ATTACHED.set(this.opts.pdfLeaf, this);
    ALL_ATTACHED.add(this);

    const onSelectionChange = () => {
      if (!this.isLeafAlive()) {
        this.unmount();
        return;
      }
      // P2 polish: 用户在 PDF 里选词 = 还在阅读 → 重置 30s 静默 timer。
      // 选词菜单触发 selectionchange 是高频事件 (debounce 80ms 后
      // 仍然可能每帧触发), 但 notePdfInteraction 内部什么都不做,
      // 只是更新时间戳 + 重启 setTimeout, 60Hz 也无成本。
      this.notePdfInteraction();
      const sel = document.getSelection();
      if (!isSelectionInContainer(sel, this.container)) {
        this.hideMenu();
        return;
      }
      const text = sel?.toString().trim() ?? "";
      if (!text) {
        this.hideMenu();
        return;
      }
      const range = sel!.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        this.hideMenu();
        return;
      }
      const pageNumber = findActivePageNumber(this.container);
      if (pageNumber === null) {
        // 拿不到当前页 — 大概率是 PDFView DOM 还没渲染完, 不记坐标.
        // 选词菜单照常显示, 用户可以重新选词.
        showMenuAt(this.menuEl, rect);
        return;
      }
      const locator = `#page=${pageNumber}`;
      this.pendingSelection = { text, locator, pageNumber, rect };
      showMenuAt(this.menuEl, rect);
    };
    // 拖选时 selectionchange 一帧内会触发多次; debounce 到 80ms 等用户
    // 松手再定位菜单 — 否则菜单位置 / pendingSelection 反复变化闪.
    const onSelectionChangeDebounced = debounce(onSelectionChange, 80);
    document.addEventListener("selectionchange", onSelectionChangeDebounced);
    this.disposers.push(() => document.removeEventListener("selectionchange", onSelectionChangeDebounced));

    const onDocClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        this.menuEl.contains(target) ||
        this.notesBtn.contains(target) ||
        this.notesPanel.contains(target) ||
        this.translationPopoverEl.contains(target)
      ) {
        return;
      }
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed) this.hideMenu();
      // 点空白处关闭翻译弹窗 — 跟 menu/notes 一样的「outside-click 关」
      // 行为, 用户不用专门找 × 按钮。
      this.hideTranslationPopover();
    };
    document.addEventListener("mousedown", onDocClick);
    this.disposers.push(() => document.removeEventListener("mousedown", onDocClick));

    // 高亮回显: 监听 PDFView DOM 变化 (懒加载 page 元素)
    const highlightObserver = new MutationObserver(() => {
      this.renderHighlightsDebounced();
    });
    highlightObserver.observe(this.container, { childList: true, subtree: true });
    this.disposers.push(() => highlightObserver.disconnect());

    // viewport 变化 — 原地更新位置 (不重建)
    const onViewportChange = () => {
      // Scroll/resize can move a highlight without the debounced pass
      // firing in time (Obsidian PDFView scrolls programmatically), so
      // flag the rAF loop directly too.
      this.markHighlightsDirty();
      this.repositionHighlightsDebounced();
    };
    window.addEventListener("resize", onViewportChange);
    this.disposers.push(() => window.removeEventListener("resize", onViewportChange));
    const pdfViewerEl = this.container.querySelector(".pdf-viewer, .pdfViewer");
    if (pdfViewerEl instanceof HTMLElement) {
      pdfViewerEl.addEventListener("scroll", onViewportChange);
      this.disposers.push(() => pdfViewerEl.removeEventListener("scroll", onViewportChange));
      // P0 修复: Obsidian PDFView / PDF++ 经常用 wheel + JS controlled scroll,
      // 而不是 native scroll. 之前只在 scroll event 触发时 reposition, 黄色
      // 长条不跟随. 现在用 requestAnimationFrame 持续监测 — 每帧检查 highlight
      // div 的 viewport 位置, 如果跟实际 page element 的位置不一致就更新.
      // getBoundingClientRect() 是同步 O(1) 读, 不强制 reflow, rAF 60fps 成本
      // 可忽略. 但仍要 debounce 100ms 避免节流期间的密集 update (highlight
      // div 修改触发的 layout 影响 page element 反过来再次触发观察).
      let rafHandle = 0;
      let lastScrollTop = Number.NaN;
      let lastScrollLeft = Number.NaN;
      let dirty = true;
      const tick = (): void => {
        rafHandle = window.requestAnimationFrame(tick);
        // P1 fix: this used to call `repositionHighlights()` on EVERY frame.
        // That method is not cheap — per highlight it locates the page
        // element, scans the page's text layer for the search string, then
        // removes and recreates every `extraDivs` node with fresh DOM
        // writes. At 60fps with 80 excerpts on a 300-page PDF that is
        // ~4800 full-page text scans plus 4800 node create/destroy cycles
        // per second on the main thread — enough to make the tab unusable
        // and get it killed by the GPU watchdog.
        //
        // Highlight rectangles only move when the viewport does, so gate on
        // scroll geometry. The explicit `repositionHighlightsDebounced()`
        // callers (resize / mutation) mark the layer dirty so lazy page
        // loads and zoom still refresh promptly.
        const scroller = this.container.querySelector(".pdf-viewer, .pdfViewer");
        const top = scroller instanceof HTMLElement ? scroller.scrollTop : this.container.scrollTop;
        const left = scroller instanceof HTMLElement ? scroller.scrollLeft : this.container.scrollLeft;
        if (dirty || top !== lastScrollTop || left !== lastScrollLeft) {
          dirty = false;
          lastScrollTop = top;
          lastScrollLeft = left;
          this.repositionHighlights();
        }
      };
      rafHandle = window.requestAnimationFrame(tick);
      this.disposers.push(() => window.cancelAnimationFrame(rafHandle));
      // Anything that can move a highlight without moving the scroll
      // offset flags the layer for the next frame.
      this.markHighlightsDirty = () => {
        dirty = true;
      };
    }

    // workspace 变化 — 检测 leaf 是否还在, 同时驱动 PDF 阅读时长 session
    const onLeafChange = () => {
      if (!this.isLeafAlive()) {
        // leaf 死掉前先 flush 当前 session (避免 unmount 后还在跑 timer)
        this.flushPdfActiveSession();
        this.unmount();
        return;
      }
      // leaf 仍活着 — 按 active 状态切换 session
      if (this.opts.app.workspace.activeLeaf === this.opts.pdfLeaf) {
        this.tryStartPdfActiveSession();
      } else {
        this.flushPdfActiveSession();
      }
    };
    this.opts.app.workspace.on("active-leaf-change", onLeafChange);
    this.disposers.push(() => this.opts.app.workspace.off("active-leaf-change", onLeafChange));

    // P1 fix: `active-leaf-change` does NOT fire when a *background* tab is
    // closed — Obsidian only emits it for the newly-activated leaf. So a
    // PDF opened from the shelf, then closed after switching to a markdown
    // tab, left this overlay fully alive: two MutationObservers watching a
    // detached subtree, document-level selection/mousedown listeners, and
    // an unconditional 60fps rAF loop calling `repositionHighlights()`.
    // Ten such PDFs meant ten live render loops burning CPU until restart.
    //
    // `layout-change` fires for every tab close regardless of which tab was
    // active, so it is the reliable death signal. `isLeafAlive()` does the
    // actual check, and it is cheap (a detached flag + a view type compare),
    // so running it on every layout change is fine.
    const onLayoutChange = () => {
      if (!this.mounted) return;
      if (!this.isLeafAlive()) {
        this.flushPdfActiveSession();
        this.unmount();
      }
    };
    this.opts.app.workspace.on("layout-change", onLayoutChange);
    this.disposers.push(() => this.opts.app.workspace.off("layout-change", onLayoutChange));

    // P2 polish: Page Visibility + Window focus/blur — 切 tab / 切窗口时
    // 暂停 PDF 阅读时长计数 (跟 ReaderView 一致的 4 条件算法)。
    const onVisibilityChange = () => {
      if (document.hidden) {
        this.flushPdfActiveSession();
      } else {
        this.tryStartPdfActiveSession();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    this.disposers.push(() =>
      document.removeEventListener("visibilitychange", onVisibilityChange)
    );
    const onWindowBlur = () => {
      this.windowHasFocus = false;
      this.flushPdfActiveSession();
    };
    const onWindowFocus = () => {
      this.windowHasFocus = true;
      this.tryStartPdfActiveSession();
    };
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    this.disposers.push(() => window.removeEventListener("blur", onWindowBlur));
    this.disposers.push(() => window.removeEventListener("focus", onWindowFocus));

    // P0-3: PDF 阅读进度追踪 — 用户翻页时 (scrollIntoView 触发 active page
    // 切换) 调 reading.updatePosition 把 (page, totalPages) 写回 store.
    // 之前 PdfOverlay 完全不存 PDF 进度, reading.position 永远是 null,
    // progressFraction 一直返回 0, PDF 永远 "untouched". 现在 mutation
    // observer 监听 .pdf-page.active 变化触发更新.
    //
    // P2 polish: 同时 page change 也是 "用户还在看 PDF" 的最强信号 —
    // 翻页必然伴随 active class 变化, 调 notePdfInteraction 重置 30s
    // 静默 timer (避免长时间静态阅读 → 计时暂停)。
    let persistTimer: number | undefined;
    const schedulePositionPersist = (): void => {
      this.notePdfInteraction();
      if (persistTimer !== undefined) window.clearTimeout(persistTimer);
      // 250ms debounce — 用户快速滚动时不会触发 10+ 次 IO
      persistTimer = window.setTimeout(() => void this.persistCurrentPosition(), 250);
    };
    this.disposers.push(() => {
      if (persistTimer !== undefined) {
        window.clearTimeout(persistTimer);
        persistTimer = undefined;
      }
    });
    // 用 MutationObserver 监听 page active class 切换. PDF++ / Obsidian
    // PDFView 翻页本质上是改 .active class + scrollIntoView, 这两个都
    // 会触发 childList / attributes mutation.
    const pageObserver = new MutationObserver(() => schedulePositionPersist());
    pageObserver.observe(this.container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"]
    });
    this.disposers.push(() => pageObserver.disconnect());

    this.mounted = true;
    // mount 后立即 persist 一次 — 用户第一次打开 PDF 时也要存 (status: unread → reading).
    void this.persistCurrentPosition();
    void this.renderHighlights();
    // P2 polish: 如果挂载时本 leaf 已经是 active, 启动阅读时长 session
    if (this.opts.app.workspace.activeLeaf === this.opts.pdfLeaf) {
      this.tryStartPdfActiveSession();
    }
  }

  /**
   * P0-3: 把当前 PDF 进度 (page + totalPages) 写到 reading store.
   * No-op if:
   *   - 没有 bookId (mount 时序 race, library.initialize 还没完)
   *   - DOM 里找不到 active page (PDFView 还没渲染完, 等下一次 mutation)
   *   - 上一次 persist 的 page 跟现在一样 (避免 relocate 风暴)
   */
  private lastPersistedPdfPage: number | null = null;
  private lastPersistedPdfTotal: number | null = null;
  private async persistCurrentPosition(): Promise<void> {
    if (!this.bookId) return;
    const page = findActivePageNumber(this.container);
    if (page === null) return;
    if (page === this.lastPersistedPdfPage) return;
    const totalPages = findPdfTotalPages(this.container);
    try {
      await this.opts.reading.updatePosition(this.bookId, {
        kind: "pdf",
        page,
        totalPages: totalPages ?? undefined,
        // scale / fitWidth PDF overlay 不主动管, 让用户通过 PDFView 自己控制
      });
      this.lastPersistedPdfPage = page;
      this.lastPersistedPdfTotal = totalPages;
    } catch (error) {
      console.warn("[ez-reader] persistCurrentPosition (PDF) failed", error);
    }
  }

  /** Underlying PDFView leaf 还在且 view 类型还是 pdf. */
  private isLeafAlive(): boolean {
    const leaf = this.opts.pdfLeaf;
    if ((leaf as { detached?: boolean }).detached === true) return false;
    const view = leaf.view;
    if (!view || view.getViewType() !== PDF_VIEW_TYPE) return false;
    const el = view.containerEl;
    return Boolean(el && document.contains(el));
  }

  /**
   * P2 polish: PDF "用户还在看" 信号 — 由 schedulePositionPersist (page
   * change) / onSelectionChange (选词) 触发. 更新 lastPdfInteractionMs
   * 并重启 30s 静默 timer。
   */
  private notePdfInteraction(): void {
    if (this.opts.app.workspace.activeLeaf !== this.opts.pdfLeaf) return;
    this.lastPdfInteractionMs = Date.now();
    this.restartPdfInactivityCheck();
    // 之前可能因 inactivity 已 flush, 这里再启动 session
    this.tryStartPdfActiveSession();
  }

  /**
   * 启动 (或继续) PDF active session. 跟 ReaderView.tryStartActiveSession
   * 同样的 4 条件判定: active leaf + visible + focus + 最近交互.
   */
  private tryStartPdfActiveSession(): void {
    if (this.activeSinceMs !== null) return;
    if (!this.bookId) return;
    if (this.opts.app.workspace.activeLeaf !== this.opts.pdfLeaf) return;
    if (document.hidden) return;
    if (!this.windowHasFocus) return;
    if (this.lastPdfInteractionMs === null) {
      // 首次启动: 用当前时间占位, 让 30s 倒计时开始 (之后无 page
      // change / selection 就会自动 flush)
      this.lastPdfInteractionMs = Date.now();
    }
    this.restartPdfInactivityCheck();
    this.activeSinceMs = Date.now();
    // Capture 当前页码作为 session 起始 fraction. flush 时用最新页码算 end.
    this.activeSessionProgressStart = this.currentPageFraction();
  }

  /**
   * 把当前 PDF active session 的 ms 写回 store. 没在计费中则 no-op.
   * 跟 ReaderView.flushReadingTime 共享同一份 reading service — bookId
   * 不同但累加路径相同 (store 内部按 bookId 索引)。
   *
   * v0.3.0 fix: 同步调 recordSession 把这次 session 写到
   * `ezreader/sessions/<title>-<id>.jsonl`, 让 BookInfoModal 阅读时长
   * 统计对 PDF 也生效 (之前 totalReadingMs 有, 但 sessions.jsonl 没数据).
   */
  private flushPdfActiveSession(): void {
    if (this.activeSinceMs === null) return;
    if (!this.bookId) return;
    const startedAt = this.activeSinceMs;
    const endedAt = Date.now();
    const delta = endedAt - startedAt;
    const progressStart = this.activeSessionProgressStart;
    const progressEnd = this.currentPageFraction();
    this.activeSinceMs = null;
    this.activeSessionProgressStart = 0;
    this.clearPdfInactivityCheck();
    if (delta < 1000) return; // 太短的 session 不记录
    // One gate, two writers — see `shouldCountReadingTime`.
    if (!this.shouldCountReadingTime(delta)) return;
    this.lastReadingFlushAt = Date.now();
    void this.flushPdfReadingTime(delta);
    // titleHint 从 entry.metadata.title 取 (fallback 到 filePath basename).
    // 真实 title 比 session.chapter / bookId 都稳定 — 保证 sessions.jsonl
    // 跟 notes.md 在同一目录下 (orphan 风险消除).
    const entry = this.opts.library.list().find((e) => e.book.id === this.bookId);
    const titleHint =
      entry?.book.metadata?.title ??
      this.opts.bookPath.split("/").pop()?.replace(/\.[^.]+$/, "") ??
      this.bookId;
    void this.opts.reading.recordSession(
      this.bookId,
      {
        startedAt,
        endedAt,
        durationMs: delta,
        progressStart,
        progressEnd,
        chapter: undefined
      },
      titleHint
    );
  }

  /**
   * 当前 PDF 页码转 0-1 fraction. pageNumber / totalPages, 跟
   * `progressFraction` for "pdf" kind 的算法一致: `(page - 1) / totalPages`.
   * 缺 totalPages 时 fallback 到 0.
   */
  private currentPageFraction(): number {
    const page = findActivePageNumber(this.container);
    const total = findPdfTotalPages(this.container);
    if (page === null || total === null || total <= 0) return 0;
    return Math.max(0, Math.min(1, (page - 1) / total));
  }

  private async flushPdfReadingTime(deltaMs: number): Promise<void> {
    if (!this.bookId) return;
    try {
      await this.opts.reading.addReadingTime(this.bookId, deltaMs);
    } catch (error) {
      console.warn("[ez-reader] flushPdfReadingTime failed", error);
    }
  }

  /**
   * P1 fix: this gate used to live inside `flushPdfReadingTime`, so it only
   * protected `totalReadingMs`. `recordSession` — called a few lines above —
   * bypassed it, so `sessions.jsonl` accumulated intervals that the
   * cumulative counter never saw, and the BookInfoModal total drifted away
   * from the toolbar total. Mirrors `ReaderView.shouldCountReadingTime`.
   */
  private shouldCountReadingTime(deltaMs: number): boolean {
    if (Date.now() - this.lastReadingFlushAt < 30_000) return deltaMs >= 60_000;
    return true;
  }

  /** 启动 30s inactivity timer — 触发时自动 flush 暂停. */
  private restartPdfInactivityCheck(): void {
    this.clearPdfInactivityCheck();
    this.inactivityCheckTimer = window.setTimeout(() => {
      this.inactivityCheckTimer = undefined;
      this.flushPdfActiveSession();
    }, PdfOverlay.PDF_INACTIVITY_TIMEOUT_MS);
  }

  private clearPdfInactivityCheck(): void {
    if (this.inactivityCheckTimer !== undefined) {
      window.clearTimeout(this.inactivityCheckTimer);
      this.inactivityCheckTimer = undefined;
    }
  }

  /**
   * 读出当前书的所有 excerpt, 在 PDFView DOM 里找对应文本,
   * 在 highlightLayer 里画 highlight div。已渲染的不再画。
   */
  private async renderHighlights(): Promise<void> {
    if (!this.bookId || !this.isLeafAlive()) return;
    // highlightLayer 已经 unmount (例如 view 关闭 → mutate.unmount 调
    // this.highlightLayer.remove()) 时再画 div 没意义, 直接放弃.
    if (!document.body.contains(this.highlightLayer)) return;
    let excerpts: ReadonlyArray<Excerpt>;
    try {
      excerpts = await this.opts.reading.listExcerpts(this.bookId);
    } catch (error) {
      console.warn("[ez-reader] failed to load excerpts for highlight", error);
      return;
    }
    const tasks = excerpts.map(async (ex) => {
      if (this.highlightsByExcerpt.has(ex.id)) return null;
      const pos = ex.locator.position;
      if (pos.kind !== "pdf") return null;
      const result = findHighlightRect(this.container, pos.page, ex.text);
      if (!result || result.rects.length === 0) return null;
      return { ex, pageNumber: pos.page, rects: result.rects };
    });
    const settled = await Promise.all(tasks);
    for (const item of settled) {
      if (!item) continue;
      // 跨多 word / 多行的选区 — 每个 rect 画一个高亮 div, 都挂到
      // highlightLayer 下面. 之前只画 rects[0] 漏掉中间 / 末尾行.
      const divs: HTMLElement[] = [];
      for (const rect of item.rects) {
        const div = drawHighlight(this.highlightLayer, rect, item.ex.id, item.ex.text);
        // P1: 点击 highlight → 打开笔记面板 + scroll 到对应 entry + flash.
        // 用 capture + mousedown 双 fallback: 某些 PDFView iframe + Obsidian
        // 组合下 click 会被 swallow (PDFView 自身的 click handler), 但
        // mousedown 在 click 之前 dispatch, 用 capture phase 保证我们先跑.
        // 两个都绑, 谁先 fire 谁负责, 另一个被守卫 skip.
        let handled = false;
        const handleHighlightTap = (event: Event): void => {
          if (handled) return;
          handled = true;
          event.preventDefault();
          event.stopPropagation();
          if (!this.notesPanel.classList.contains("is-open")) {
            this.toggleNotesPanel();
          }
          this.focusExcerptInPanel(item.ex.id);
        };
        div.addEventListener("mousedown", handleHighlightTap, true /* capture */);
        div.addEventListener("click", handleHighlightTap);
        divs.push(div);
      }
      this.highlightsByExcerpt.set(item.ex.id, {
        excerptId: item.ex.id,
        pageNumber: item.pageNumber,
        searchText: item.ex.text,
        div: divs[0]!,
        extraDivs: divs.slice(1)
      });
    }
  }

  /** 原地更新现有 highlight div 的位置 — 不重建, 不重新读 excerpts。 */
  private repositionHighlights(): void {
    if (this.highlightsByExcerpt.size === 0) return;
    if (!document.body.contains(this.highlightLayer)) return;
    for (const item of this.highlightsByExcerpt.values()) {
      const pageEl = findPageElement(this.container, item.pageNumber);
      const allDivs = [item.div, ...(item.extraDivs ?? [])];
      if (!pageEl) {
        // 页元素不在 DOM (懒加载/翻页) — 把 highlight 藏起来
        for (const div of allDivs) div.setCssProps({ display: "none" });
        continue;
      }
      const rects = findTextOnPageInLayer(pageEl, item.searchText);
      if (rects.length === 0) {
        for (const div of allDivs) div.setCssProps({ display: "none" });
        continue;
      }
      // 重新分配的 rect 数可能跟上次不同 (zoom 后 word break 变了) — 清掉旧的
      // extra divs, 用新 rect 重建.
      for (const div of item.extraDivs ?? []) div.remove();
      item.extraDivs = [];
      const primary = rects[0];
      const tail = rects.slice(1);
      if (primary) {
        item.div.setCssProps({
          display: "",
          left: `${primary.left}px`,
          top: `${primary.top}px`,
          width: `${primary.width}px`,
          height: `${primary.height}px`
        });
      }
      for (const r of tail) {
        const newDiv = drawHighlight(this.highlightLayer, r, item.excerptId, item.searchText);
        item.extraDivs!.push(newDiv);
      }
    }
  }

  /**
   * P0 修复: 之前 Plugin.handleProtocol 收到 obsidian://ez-reader?book=X&annotation=Y
   * 时只查 READER_VIEW_TYPE leaf, PDF 走的是 Obsidian 内置 viewer, handleProtocol
   * 找不到对应 leaf 也调不到 PdfOverlay — 用户点 vault 笔记里的 protocol link
   * "返回原文" / "回到此摘录" 完全无效. 现在暴露 jumpToExcerpt: scrollIntoView
   * 到对应页 + 画 highlight + 让 PdfOverlay leaf 可见. Plugin 在 protocol handler
   * 里根据 book 格式路由: PDF → 找 PdfOverlay, 其他 → ReaderView.
   *
   * 找不到对应 page 时 (e.g. 损坏的 PDF), 静默 no-op + console.warn — 不影响其他书.
   */
  async jumpToExcerpt(excerptId: string): Promise<void> {
    if (!this.bookId || !this.isLeafAlive()) {
      console.warn("[ez-reader] jumpToExcerpt: overlay not mounted for", excerptId);
      return;
    }
    let excerpts: ReadonlyArray<Excerpt>;
    try {
      excerpts = await this.opts.reading.listExcerpts(this.bookId);
    } catch (error) {
      console.warn("[ez-reader] jumpToExcerpt listExcerpts failed", error);
      return;
    }
    const ex = excerpts.find((e) => e.id === excerptId);
    if (!ex) {
      console.warn("[ez-reader] jumpToExcerpt: excerpt not found", excerptId);
      return;
    }
    const pos = ex.locator.position;
    if (pos.kind !== "pdf") return;
    // 1. 确保 highlight 已画 (lazy draw, 之前 renderHighlights 没找到的 page
    //    现在 lazy loaded 也补上).
    if (!this.highlightsByExcerpt.has(excerptId)) {
      const result = findHighlightRect(this.container, pos.page, ex.text);
      if (result && result.rects.length > 0) {
        const allDivs: HTMLElement[] = [];
        for (const r of result.rects) {
          allDivs.push(drawHighlight(this.highlightLayer, r, excerptId, ex.text));
        }
        this.highlightsByExcerpt.set(excerptId, {
          excerptId,
          pageNumber: pos.page,
          searchText: ex.text,
          div: allDivs[0]!,
          extraDivs: allDivs.slice(1)
        });
      }
    }
    // 2. scroll 到那一页 (PDFView 是连续滚动模式, 不需要翻页).
    const pageEl = findPageElement(this.container, pos.page);
    if (pageEl) {
      pageEl.scrollIntoView({ behavior: "smooth", block: "start" });
      // 3. 如果有 subpath (精确到 selection), 优先用 hash 跳 subpath — Obsidian
      //    PDFView 接受 #page=N&search=... 的 URL fragment. selection locator
      //    来自 handleExcerpt 时存的 `sel.locator` (#page=N).
      if (pos.selection) {
        // 把 selection (e.g. "#page=5&...") 写到 URL hash, 触发 PDFView 内部
        // 滚动. 不能用 location.hash 直接改, 会跟 Obsidian 路由冲突 — 用
        // iframe srcdoc trick 不行 (PDFView 不是 iframe). 直接 click 一个
        // 内部 anchor 也不行, PDFView 拦截.
        // 退而求其次: scrollIntoView 到 page 顶端, 然后 reposition 会立即把
        // highlight 画到正确位置. user 看到的就是"跳到了那页 + highlight 在那".
        // TODO: 真正的 selection-level jump 需要 PDFView 内部 API 暴露, 暂时
        // 不做 (用户最常见用例是 page-level jump, subpath 是 nice-to-have).
      }
    } else {
      console.warn("[ez-reader] jumpToExcerpt: page element not in DOM for page", pos.page);
    }
  }

  /**
   * 拆卸 overlay。幂等 —— 重复调不抛、不重复 flush。
   *
   * P0: 早退条件从 `this.mounted` 改成 `this.mountStarted`。
   * `mounted` 只在 mount 顺利跑完时才为 true, 于是"mount 中途抛异常"这条
   * 最需要清理的路径反被自己的守卫挡住 (详见 `mountStarted` 的注释)。
   * 换成 `mountStarted` 之后两个方向都成立:
   *   - 从没 mount 过 → 没挂过任何资源, no-op (不去拆构造器建的 DOM,
   *     那是别的实例也可能共用的 document.body 直属子节点);
   *   - mount 中途失败 → 已经注册了一部分, 必须拆干净。
   *
   * `flushPdfActiveSession()` 自身幂等 (第一行就 `activeSinceMs === null`
   * 早退), 所以重复调 unmount 不会把同一段阅读时长记两次。
   */
  unmount(): void {
    if (!this.mountStarted) return;
    this.mountStarted = false;
    this.mounted = false;
    // 作废在途翻译 — 否则 unmount 之后到达的响应仍会往已 detach 的 popover
    // 写 DOM(跟 TranslationDrawer.hide() 里 bump generation 同一个理由)。
    this.translateGeneration += 1;
    // P2 polish: 关 viewer 前 flush 当前阅读时长 session — flushActiveSession
    // 内部 idempotent (activeSinceMs === null 时 no-op), 即便 onLeafChange
    // 已经 flush 过也无副作用。
    this.flushPdfActiveSession();
    // 30s 静默 timer 也要收 —— 不然它会在 overlay 已经拆掉之后才触发,
    // 白跑一次 flushPdfActiveSession (虽然那时已经 no-op, 但 timer 本身
    // 会让页面多活 30 秒)。
    this.clearPdfInactivityCheck();
    // 6 个 body 级 DOM 元素 + 它们的 listener 在**构造函数**里就建好了,
    // 所以这段拆卸跟 `detachConstructedDom()` 是同一件事 —— 复用而不是
    // 各写一份。两份列表各写一遍的话,加元素时必然漏掉其中一处,
    // 而漏掉的那处表现为"DOM 留在 body 上、什么日志都没有"。
    this.detachConstructedDom();
    this.clearPdfSearchHighlights();
    this.pendingSelection = undefined;
    this.highlightsByExcerpt.clear();
    if (ATTACHED.get(this.opts.pdfLeaf) === this) {
      ATTACHED.delete(this.opts.pdfLeaf);
    }
    ALL_ATTACHED.delete(this);
  }

  private hideMenu(): void {
    this.menuEl.setCssProps({ display: "none" });
  }

  private toggleNotesPanel(): void {
    const isOpen = this.notesPanel.classList.toggle("is-open");
    this.notesBtn.classList.toggle("is-active", isOpen);
    if (isOpen) this.requestNotesPanelRefresh();
  }

  /**
   * `refreshNotesPanel()` 的 fire-and-forget 入口。
   *
   * P0: 之前调用处直接写 `void this.refreshNotesPanel()` —— 面板有 9 个刷新
   * 触发点 (点开面板 / 点黄条 / 加摘录 / 加想法 / 删书签 / 删摘录 …), 多数是
   * `void` 丢弃 promise。`void` 不处理 rejection: 读盘失败或渲染中途抛异常
   * 都会变成 unhandled rejection, 同时面板停在半渲染状态, 用户看到的是一个
   * 永远空着的侧栏, 没有任何线索。
   *
   * 为什么统一收口而不是每个调用点各写 `.catch()`: 触发点还会继续增加, 分散
   * 的 `.catch` 迟早漏一个, 而漏掉的那个在测试里根本看不见。收口之后"刷新
   * 面板"只有一条失败语义 —— 给用户一个 Notice, 不产生 unhandled rejection。
   */
  private requestNotesPanelRefresh(): void {
    void this.refreshNotesPanel().catch(() => {
      new Notice("笔记面板刷新失败");
    });
  }

  /**
   * 把笔记面板里那些"点了就算"的异步回调包一层。
   *
   * 渲染函数里全是 `void handlers.onRemoveExcerpt(id)` 这种写法, 而
   * `removeExcerpt` / `updateExcerptNote` 都要写盘 —— data.json 被占、vault
   * 只读、同步盘写失败, 任何一个都会让这次点击静默变成 unhandled rejection。
   * 包一层之后失败有 Notice, 面板还能继续用。
   *
   * 用 Notice 而不是 console.warn: `no-console` 是本项目被锁死的 lint rule
   * (AGENTS.md §3.7), 而且"用户点了删除但什么都没发生"本来就该让用户知道。
   */
  private async withPanelNotice(work: () => Promise<void>, message: string): Promise<void> {
    try {
      await work();
    } catch {
      new Notice(message);
    }
  }

  private async refreshNotesPanel(): Promise<void> {
    if (!this.bookId) return;
    try {
      const [bookmarks, excerpts] = await Promise.all([
        this.opts.reading.listBookmarks(this.bookId),
        this.opts.reading.listExcerpts(this.bookId)
      ]);
      renderNotesPanelContent(this.notesPanel, bookmarks, excerpts, {
        onJump: (locator) => this.jumpToLocator(locator),
        onRemoveBookmark: (id) =>
          this.withPanelNotice(async () => {
            await this.opts.reading.removeBookmark(this.bookId!, id);
            await this.refreshNotesPanel();
            new Notice("书签已删除");
          }, "删除书签失败"),
        onRemoveExcerpt: (id) =>
          this.withPanelNotice(async () => {
            await this.opts.reading.removeExcerpt(this.bookId!, id);
            // 同步清掉 highlight div (包括 multi-rect 摘录的所有 div)
            const rendered = this.highlightsByExcerpt.get(id);
            if (rendered) {
              rendered.div.remove();
              for (const extra of rendered.extraDivs ?? []) extra.remove();
              this.highlightsByExcerpt.delete(id);
            }
            await this.refreshNotesPanel();
            new Notice("摘录已删除");
          }, "删除摘录失败"),
        // P2: 让面板里的 note 字段可内联编辑 — 用户点黄线 → 跳到这条摘录 →
        // 自动进编辑模式; blur 保存走 reading.updateExcerptNote (不动 highlight /
        // createdAt / locator, 只 patch note)。
        //
        // 这里也必须包 withPanelNotice: attachInlineNoteEditor 的 blur 回调是
        // `void onUpdate(...)`, 写盘失败照样是 unhandled rejection。
        onUpdateNote: (id, note) =>
          this.withPanelNotice(async () => {
            await this.opts.reading.updateExcerptNote(this.bookId!, id, { note });
          }, "保存想法失败")
      });
    } catch {
      new Notice("笔记面板刷新失败");
    }
  }

  private jumpToLocator(locator: string): void {
    if (!locator) return;
    // Obsidian 自带 PDFView 接受 #page=N subpath 跳页 — 我们存的就是这个
    void this.opts.app.workspace.openLinkText(`${this.opts.bookPath}${locator}`, "", false);
  }

  private handleTranslate(): Promise<void> {
    if (!this.pendingSelection) return Promise.resolve();
    const text = this.pendingSelection.text;
    const rect = this.pendingSelection.rect;
    return this.runTranslation(text, rect);
  }

  /**
   * Translate + render, with a generation guard.
   *
   * P0 修复: `handleTranslate` 和 `handleCycleTranslationTarget` 之前各自
   * `await this.opts.translation.translate(...)` 然后无条件 render。快速
   * 划两次词各点一次翻译时, 先发的请求后到 → **旧译文盖掉新的**, 原文框和
   * 译文对不上。`handleCycleTranslationTarget` 更糟: 它在 await 之前就改了
   * `this.targetLocale`, 竞态下连显示的目标语言都跟译文不是一回事。
   *
   * `TranslationDrawer.translate()` 一直是对的(`translateGeneration` token,
   * result 和 error 两条路径都判), 这里搬同一套过来。旧请求不取消网络,
   * 只是不让它再写 UI。
   */
  private async runTranslation(text: string, rect: DOMRect): Promise<void> {
    const generation = ++this.translateGeneration;
    this.showTranslationPopover(text, rect);
    try {
      const result = await this.opts.translation.translate(text, "auto", this.targetLocale);
      if (generation !== this.translateGeneration) return; // stale result
      this.renderTranslationResult(text, result.text, result.detectedSource, result.providerId);
    } catch (error) {
      if (generation !== this.translateGeneration) return; // stale error
      const message = error instanceof Error ? error.message : String(error);
      this.renderTranslationError(text, message);
    }
  }

  /**
   * 点击黄色高亮 → 打开笔记面板 + 滚动到对应摘录行 + 让 note 进入编辑模式.
   * user 期望 "看到想法 + 能改" (P2 feedback). handler 是箭头函数, 避免
   * `this` 在事件触发时变成 highlightLayer 元素.
   */
  private onHighlightClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const hl = target.closest(".ez-reader__pdf-overlay-highlight");
    if (!hl) return;
    const excerptId = hl.getAttribute("data-excerpt-id");
    if (!excerptId) return;
    event.stopPropagation();
    void this.focusExcerptInNotesPanel(excerptId);
  };

  /**
   * 在笔记面板中找到指定 excerpt, 滚到可视区, 让它的 note 进入编辑模式.
   * 面板之前没开就先开; 已经开就 refreshNotesPanel 一次保证数据最新.
   *
   * 实现注意: 不 dispatchEvent 触发 click — synthetic event 在某些 Electron
   * 版本里被 attachInlineNoteEditor 里某些 bound listener 吞掉. 直接调
   * startEdit 内部逻辑 (在 renderNotesPanelContent 闭包里捕获). 这里通过
   * noteEl 的 data-editing sentinel + is-editing class 切换让用户看到
   * 「进入编辑态」的视觉变化.
   */
  private async focusExcerptInNotesPanel(excerptId: string): Promise<void> {
    // 1. 面板打开 (如果还没开). toggleNotesPanel 内部会触发 refreshNotesPanel
    //    一次, 这次 await 等它完成.
    if (!this.notesPanel.classList.contains("is-open")) {
      this.toggleNotesPanel();
    }
    // 2. 强制刷新一次 — 即便面板已经开着, 数据可能 stale (用户中途加了新摘录).
    await this.refreshNotesPanel();
    // 3. 找 row
    const row = this.notesPanel.querySelector<HTMLElement>(
      `[data-excerpt-id="${CSS.escape(excerptId)}"]`
    );
    if (!row) {
      // 找不到 row (excerpt 可能刚被删了, 或者 excerptId 不一致), 至少打开面板.
      return;
    }
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    // 短暂高亮整行 — 视觉确认命中哪一条
    row.addClass("is-just-focused");
    window.setTimeout(() => row.removeClass("is-just-focused"), 1500);
    // 4. 直接驱动 note 进编辑模式 — 走和 click handler 一样的逻辑, 但不靠
   //    dispatchEvent (后者在某些场景不触发 listener, 见注释).
    const noteEl = row.querySelector<HTMLElement>(".ez-reader__pdf-overlay-notes-panel__note");
    if (!noteEl) return;
    if (noteEl.getAttribute("data-editing") === "1") return;
    noteEl.setAttribute("data-editing", "1");
    noteEl.removeClass("is-placeholder");
    noteEl.addClass("is-editing");
    // 读现有 note 文本 — 从 row 的 data-excerpt-id 找不到, 但我们直接读
    // noteEl 当前 textContent (渲染时已经设过了). 不需要再次调 store.
    noteEl.contentEditable = "true";
    noteEl.focus();
    // 全选文字, 用户输入直接覆盖
    const range = document.createRange();
    range.selectNodeContents(noteEl);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  /**
   * 在选区附近显示浮动翻译小弹窗, 显示「正在翻译…」状态。位置复用
   * selectionMenuPosition 算法 — 跟选词菜单同位置, 不会跑到屏幕外。
   */
  private showTranslationPopover(sourceText: string, anchorRect: DOMRect): void {
    const popover = this.translationPopoverEl;
    const sourceEl = popover.querySelector<HTMLElement>(".ez-reader__pdf-translation__source");
    const bodyEl = popover.querySelector<HTMLElement>(".ez-reader__pdf-translation__body");
    const providerEl = popover.querySelector<HTMLElement>(".ez-reader__pdf-translation__provider");
    if (sourceEl) sourceEl.setText(sourceText);
    if (bodyEl) {
      bodyEl.empty();
      bodyEl.setText("正在翻译…");
      bodyEl.addClass("is-loading");
      bodyEl.removeClass("is-error");
    }
    if (providerEl) providerEl.setText(`→ ${this.targetLocale}`);
    popover.removeClass("is-hidden");
    // Anchor to the selection rect — same algorithm as selectionMenuAt.
    // 千万不要在这里设 `display: flex` 作为 inline style — 那会盖过
    // `.is-hidden { display: none }`,导致点 × 关不掉 (issue: 翻译后 ×
    // 无效). 默认 CSS 已经是 `display: flex`, 只需要 removeClass("is-hidden").
    popover.setCssProps({ left: "-9999px", top: "-9999px" });
    window.requestAnimationFrame(() => {
      const popoverRect = popover.getBoundingClientRect();
      const pos = computeSelectionMenuPosition(anchorRect, popoverRect, {
        width: window.innerWidth,
        height: window.innerHeight
      });
      popover.setCssProps({ left: `${pos.left}px`, top: `${pos.top}px` });
    });
  }

  private renderTranslationResult(
    sourceText: string,
    translated: string,
    detected: string | null,
    providerId: string
  ): void {
    const popover = this.translationPopoverEl;
    const sourceEl = popover.querySelector<HTMLElement>(".ez-reader__pdf-translation__source");
    const bodyEl = popover.querySelector<HTMLElement>(".ez-reader__pdf-translation__body");
    const providerEl = popover.querySelector<HTMLElement>(".ez-reader__pdf-translation__provider");
    if (sourceEl) sourceEl.setText(sourceText);
    if (bodyEl) {
      bodyEl.empty();
      bodyEl.setText(translated);
      bodyEl.removeClass("is-loading");
      bodyEl.removeClass("is-error");
    }
    if (providerEl) {
      const detectedPart = detected ? `检测到 ${detected} · ` : "";
      providerEl.setText(`${detectedPart}${providerId} · → ${this.targetLocale}`);
    }
  }

  private renderTranslationError(sourceText: string, message: string): void {
    const popover = this.translationPopoverEl;
    const sourceEl = popover.querySelector<HTMLElement>(".ez-reader__pdf-translation__source");
    const bodyEl = popover.querySelector<HTMLElement>(".ez-reader__pdf-translation__body");
    if (sourceEl) sourceEl.setText(sourceText);
    if (bodyEl) {
      bodyEl.empty();
      bodyEl.setText(`翻译失败: ${message}`);
      bodyEl.removeClass("is-loading");
      bodyEl.addClass("is-error");
    }
  }

  private hideTranslationPopover(): void {
    this.translationPopoverEl.addClass("is-hidden");
  }

  /** Popover 内「复制」按钮 — 把当前译文写到剪贴板, 按钮短暂 ✓ 提示。 */
  private async handleCopyTranslation(): Promise<void> {
    const bodyEl = this.translationPopoverEl.querySelector<HTMLElement>(".ez-reader__pdf-translation__body");
    if (!bodyEl) return;
    const translated = bodyEl.textContent ?? "";
    try {
      // 跟 selection menu / drawer 共用 navigator.clipboard 路径。
      await navigator.clipboard.writeText(translated);
      const btn = this.translationPopoverEl.querySelector<HTMLButtonElement>(".ez-reader__pdf-translation__copy-btn");
      if (btn) {
        const original = btn.textContent ?? "复制";
        btn.setText("✓ 已复制");
        window.setTimeout(() => btn.setText(original), 1500);
      }
    } catch (error) {
      console.warn("[ez-reader] copy translation failed", error);
    }
  }

  /** Popover 内「换语言重译」按钮 — cycle 目标语言后复用 showTranslationPopover。 */
  private handleCycleTranslationTarget(): Promise<void> {
    if (!this.pendingSelection) return Promise.resolve();
    const cycle: Locale[] = ["zh-CN", "en", "ja", "ko", "fr", "de"];
    const currentIdx = cycle.indexOf(this.targetLocale);
    const next = cycle[(currentIdx + 1) % cycle.length] ?? "zh-CN";
    this.targetLocale = next;
    const text = this.pendingSelection.text;
    const rect = this.pendingSelection.rect;
    // locale 先改再翻译, runTranslation 内部读到的是新值 —— 与旧代码一致,
    // 但 generation 守卫保证旧 locale 的在途请求不会再写 UI。
    return this.runTranslation(text, rect);
  }

  private async handleExcerpt(): Promise<void> {
    if (!this.pendingSelection || !this.bookId) return;
    const sel = this.pendingSelection;
    const excerpt: Excerpt = {
      id: generateExcerptId("ex"),
      bookId: this.bookId,
      text: sel.text,
      locator: {
        position: {
          kind: "pdf",
          page: sel.pageNumber,
          selection: sel.locator
        } satisfies ReadingPosition,
        chapter: ""
      },
      note: "",
      tags: [],
      createdAt: Date.now()
    };
    try {
      await this.opts.reading.addExcerpt(excerpt);
    } catch (error) {
      console.warn("[ez-reader] handleExcerpt addExcerpt failed", error);
      new Notice("保存摘录失败");
      return;
    }
    // 同步到 vault md
    if (this.opts.noteWriter) {
      try {
        const ref = await this.opts.noteWriter.ensureBookDir({
          bookId: this.bookId,
          bookTitle: this.bookTitle,
          bookPath: this.opts.bookPath
        });
        await this.opts.noteWriter.appendExcerpt(ref, {
          excerptId: excerpt.id,
          text: excerpt.text,
          note: excerpt.note,
          tags: excerpt.tags,
          locator: { page: sel.pageNumber, cfi: undefined, fraction: 0 },
          chapterTitle: "",
          format: "pdf",
          createdAt: excerpt.createdAt
        });
      } catch (error) {
        console.warn("[ez-reader] noteWriter.appendExcerpt failed", error);
        new Notice("写入笔记失败 (摘录已保存)");
      }
    }
    // 立刻画高亮 (不依赖 MutationObserver)
    const result = findHighlightRect(this.container, sel.pageNumber, sel.text);
    if (result && result.rects.length > 0) {
      const allDivs: HTMLElement[] = [];
      for (const r of result.rects) {
        allDivs.push(drawHighlight(this.highlightLayer, r, excerpt.id, sel.text));
      }
      this.highlightsByExcerpt.set(excerpt.id, {
        excerptId: excerpt.id,
        pageNumber: sel.pageNumber,
        searchText: sel.text,
        div: allDivs[0]!,
        extraDivs: allDivs.slice(1)
      });
    }
    this.hideMenu();
    if (this.notesPanel.classList.contains("is-open")) {
      await this.refreshNotesPanel();
    }
    new Notice("摘录已保存");
  }

  /**
   * P0 修复: 之前 PDF selection menu 只有 "翻译/摘录/复制", 没有 "想法".
   * 用户只能在摘录后单独到 vault 改 note —— 跟 EPUB 路径不一致, 体验断裂.
   * 现在 selection menu 加"想法"按钮: 弹一个轻量 modal, 用户填想法文字,
   * 存成 Excerpt 同时填到 note 字段. 跟 handleExcerpt 共用 highlight 画法.
   */
  private async handleThought(): Promise<void> {
    if (!this.pendingSelection || !this.bookId) return;
    const sel = this.pendingSelection;
    this.hideMenu();
    const noteText = await promptForThought(this.opts.app, sel.text);
    if (noteText === null) return; // 用户取消
    const excerpt: Excerpt = {
      id: generateExcerptId("ex"),
      bookId: this.bookId,
      text: sel.text,
      locator: {
        position: {
          kind: "pdf",
          page: sel.pageNumber,
          selection: sel.locator
        } satisfies ReadingPosition,
        chapter: ""
      },
      note: noteText,
      tags: [],
      createdAt: Date.now()
    };
    try {
      await this.opts.reading.addExcerpt(excerpt);
    } catch (error) {
      console.warn("[ez-reader] handleThought addExcerpt failed", error);
      new Notice("保存想法失败");
      return;
    }
    if (this.opts.noteWriter) {
      try {
        const ref = await this.opts.noteWriter.ensureBookDir({
          bookId: this.bookId,
          bookTitle: this.bookTitle,
          bookPath: this.opts.bookPath
        });
        await this.opts.noteWriter.appendExcerpt(ref, {
          excerptId: excerpt.id,
          text: excerpt.text,
          note: excerpt.note,
          tags: excerpt.tags,
          locator: { page: sel.pageNumber, cfi: undefined, fraction: 0 },
          chapterTitle: "",
          format: "pdf",
          createdAt: excerpt.createdAt
        });
      } catch (error) {
        console.warn("[ez-reader] handleThought noteWriter.appendExcerpt failed", error);
        new Notice("写入笔记失败 (想法已保存)");
      }
    }
    const result = findHighlightRect(this.container, sel.pageNumber, sel.text);
    if (result && result.rects.length > 0) {
      const allDivs: HTMLElement[] = [];
      for (const r of result.rects) {
        allDivs.push(drawHighlight(this.highlightLayer, r, excerpt.id, sel.text));
      }
      this.highlightsByExcerpt.set(excerpt.id, {
        excerptId: excerpt.id,
        pageNumber: sel.pageNumber,
        searchText: sel.text,
        div: allDivs[0]!,
        extraDivs: allDivs.slice(1)
      });
    }
    if (this.notesPanel.classList.contains("is-open")) {
      await this.refreshNotesPanel();
    }
    new Notice(noteText.trim().length > 0 ? "想法已保存" : "想法 (空) 已保存");
  }

  private async handleCopy(): Promise<void> {
    if (!this.pendingSelection) return;
    const text = this.pendingSelection.text;
    try {
      await navigator.clipboard.writeText(text);
      new Notice(`已复制 (${text.length} 字符)`, 1500);
    } catch (error) {
      console.warn("[ez-reader] clipboard write failed", error);
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`复制失败: ${message}`, 4000);
    }
    this.hideMenu();
  }

  /**
   * P1: in-PDF find. Walks PDFView text-layers page by page, looking for
   * `query` after the current page. On a hit, scrolls the page into view
   * + draws a yellow highlight rectangle. Updates the match count in the
   * search bar so the user sees "1/12" style progress.
   */
  private async runPdfSearch(query: string, fromStart: boolean): Promise<void> {
    const trimmed = query.trim();
    if (!trimmed) {
      this.pdfFindQuery = "";
      this.pdfFindMatchCount = 0;
      updatePdfSearchStatus(this.searchBar, null);
      return;
    }
    this.pdfFindQuery = trimmed;
    const currentPage = fromStart
      ? 1
      : this.pdfFindCurrentPage !== null
        ? this.pdfFindCurrentPage + 1
        : findActivePageNumber(this.container) ?? 1;
    const nextPage = findNextPageWithText(this.container, trimmed, currentPage);
    if (nextPage === null) {
      this.pdfFindMatchCount = 0;
      updatePdfSearchStatus(this.searchBar, 0);
      new Notice(`PDF 未找到 "${trimmed}"`);
      return;
    }
    this.pdfFindCurrentPage = nextPage;
    // 跳到那一页 (PDFView 是连续滚动模式)
    const pageEl = findPageElement(this.container, nextPage);
    pageEl?.scrollIntoView({ behavior: "smooth", block: "start" });
    this.clearPdfSearchHighlights();
    const rects = findHighlightRect(this.container, nextPage, trimmed);
    if (rects) {
      for (const r of rects.rects) {
        const div = drawHighlight(this.highlightLayer, r, `__pdf_search__`, trimmed);
        div.addClass("ez-reader__pdf-overlay-highlight--search");
        this.pdfSearchHighlightDivs.push(div);
      }
      this.pdfFindMatchCount = 1;
      const total = this.countPdfMatchesAcrossPages(trimmed);
      updatePdfSearchStatus(this.searchBar, total);
    } else {
      updatePdfSearchStatus(this.searchBar, 1);
    }
  }

  private pdfSearchHighlightDivs: HTMLElement[] = [];

  private clearPdfSearchHighlights(): void {
    for (const div of this.pdfSearchHighlightDivs) div.remove();
    this.pdfSearchHighlightDivs = [];
  }

  private countPdfMatchesAcrossPages(query: string): number {
    const pages = Array.from(
      this.container.querySelectorAll<HTMLElement>(".pdf-page[data-page-number], .page[data-page-number]")
    );
    let count = 0;
    const needle = query.toLocaleLowerCase();
    for (const page of pages) {
      const text = collectTextLayerSpans(page).map((s) => s.textContent ?? "").join("").toLocaleLowerCase();
      let from = 0;
      let idx: number;
      while ((idx = text.indexOf(needle, from)) >= 0) {
        count += 1;
        from = idx + needle.length;
        if (count > 999) return count;
      }
    }
    return count;
  }

  private closePdfSearch(): void {
    this.pdfFindQuery = "";
    this.pdfFindMatchCount = 0;
    this.pdfFindCurrentPage = null;
    this.clearPdfSearchHighlights();
    this.searchBar.classList.add("is-hidden");
    updatePdfSearchStatus(this.searchBar, null);
  }

  /** Public toggle — exposed so the host can hotkey Ctrl+F. */
  toggleSearchBar(): void {
    const visible = !this.searchBar.classList.contains("is-hidden");
    if (visible) this.closePdfSearch();
    else {
      this.searchBar.classList.remove("is-hidden");
      const input = this.searchBar.querySelector<HTMLInputElement>("input");
      input?.focus();
    }
  }

  /**
   * P1: 点击 PDF 黄条 → 笔记面板 focus 到对应 entry, 用 flash class
   * 让用户视觉确认。
   */
  private focusExcerptInPanel(excerptId: string): void {
    // 给所有 entry 加 transient class, 让 css 用 attribute selector 高亮.
    // (renderNotesPanelContent 用 [data-excerpt-id] attribute 标识每个 row.)
    const panel = this.notesPanel;
    const target = panel.querySelector<HTMLElement>(`[data-excerpt-id="${cssEscapeAttr(excerptId)}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("ez-reader__pdf-overlay-row--focus");
    window.setTimeout(() => target.classList.remove("ez-reader__pdf-overlay-row--focus"), 1500);
  }
}

/** Escape an attribute selector value. PDF excerpt IDs come from randomUUID,
 *  but contain dashes/digits — `[data-excerpt-id="..."]` 需要 escape 一些
 *  特殊字符以防注入。 */
const cssEscapeAttr = (value: string): string =>
  value.replace(/(["\\\]])/g, "\\$1");

// ---- DOM helpers ----

/**
 * 弹出轻量"想法"输入 modal. 用户填文字 + 点"保存" → resolve(text).
 * 用户关 modal / Esc → resolve(null) (让 caller 当成 cancel, 不存 excerpt).
 * 简化版的 Obsidian PromptModal: textarea + 两个按钮, 没用 Modal class —
 * 因为我们要把 modal 挂到 document.body 跟其他 overlay 元素放一起, 而
 * Obsidian Modal 强制挂到 workspace containerEl 内部, 受 PDFView 重建影响.
 */
const promptForThought = (app: App, selectionText: string): Promise<string | null> => {
  return new Promise<string | null>((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "ez-reader__pdf-overlay-thought-prompt";
    overlay.addClass("ez-reader__modal-backdrop");
    const box = overlay.createDiv({ cls: "ez-reader__pdf-overlay-thought-prompt__box" });
    box.createEl("h3", { text: "记录想法" });
    const preview = box.createEl("blockquote", { text: selectionText.length > 200 ? `${selectionText.slice(0, 200)}…` : selectionText, cls: "ez-reader__pdf-overlay-thought-prompt__preview" });
    const textarea = box.createEl("textarea", { cls: "ez-reader__pdf-overlay-thought-prompt__input", attr: { placeholder: "你的想法…", rows: "5" } });
    const actions = box.createDiv({ cls: "ez-reader__modal-actions" });
    const cancel = actions.createEl("button", { text: "取消", attr: { type: "button" } });
    const save = actions.createEl("button", { text: "保存", attr: { type: "button" } });
    save.addClass("mod-cta");

    let settled = false;
    const settle = (value: string | null): void => {
      if (settled) return;
      settled = true;
      overlay.remove();
      resolve(value);
    };

    cancel.addEventListener("click", () => settle(null));
    save.addEventListener("click", () => settle(textarea.value));
    // Esc 取消, Ctrl/Cmd+Enter 保存
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        settle(null);
      } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        settle(textarea.value);
      }
    });
    // 点 backdrop 取消
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) settle(null);
    });

    document.body.appendChild(overlay);
    textarea.focus();
  });
};

const createSelectionMenu = (
  parent: HTMLElement,
  handlers: { onTranslate: () => void; onExcerpt: () => void; onThought: () => void; onCopy: () => void }
): HTMLElement => {
  const menu = document.createElement("div");
  menu.className = "ez-reader__pdf-overlay-menu";
  menu.setCssProps({ display: "none" });

  const mkBtn = (label: string, cls: string, onClick: () => void): HTMLButtonElement => {
    const btn = menu.createEl("button", { text: label, cls: `ez-reader__pdf-overlay-menu__btn ${cls}` });
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return btn;
  };

  mkBtn("翻译", "is-translate", handlers.onTranslate);
  mkBtn("摘录", "is-excerpt", handlers.onExcerpt);
  // P0 修复: 之前 PDF 没有"想法"功能, 用户只能在摘录后单独到 vault 改 note ——
  // 跟 EPUB 路径不一致, 用户体验断裂. 现在在 selection menu 加"想法"按钮:
  // 弹一个小输入框, 用户填想法文字, 存成 Excerpt 同时 note 字段填上, 跟
  // EPUB 的"摘录 + 想法"流程一致.
  mkBtn("想法", "is-thought", handlers.onThought);
  mkBtn("复制", "is-copy", handlers.onCopy);

  parent.appendChild(menu);
  return menu;
};

const showMenuAt = (menu: HTMLElement, rect: DOMRect): void => {
  // 先放屏幕外测尺寸, 避免 anchor 到错误位置
  menu.setCssProps({
    display: "flex",
    left: "-9999px",
    top: "-9999px"
  });
  // P2: 复用 selectionMenuPosition 的纯函数 — 跟 ReaderSelectionMenu 用同一个
  // 算法, 包括多行选区强制上方 + 视口边距约束, 行为一致。
  window.requestAnimationFrame(() => {
    const menuRect = menu.getBoundingClientRect();
    const pos = computeSelectionMenuPosition(rect, menuRect, {
      width: window.innerWidth,
      height: window.innerHeight
    });
    menu.setCssProps({
      left: `${pos.left}px`,
      top: `${pos.top}px`
    });
  });
};

const createNotesButton = (parent: HTMLElement, opts: { onClick: () => void; bookPath: string }): HTMLElement => {
  const btn = document.createElement("button");
  btn.className = "ez-reader__pdf-overlay-notes-btn";
  btn.textContent = "📝";
  btn.title = "笔记 (bookmarks / excerpts) — 拖动移动位置";
  // 优先用上次拖到的位置; 没存过走 CSS 默认 (bottom/right 角).
  const saved = readNotesBtnPos(opts.bookPath);
  if (saved) {
    btn.setCssProps({
      top: `${saved.top}px`,
      left: `${saved.left}px`,
      bottom: "auto",
      right: "auto"
    });
  }
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    opts.onClick();
  });
  // 可拖拽 — 拖完存位置. 拖到按钮自身上不触发 click (mousedown preventDefault +
  // click handler 的 stopPropagation), 但用户拖完释放鼠标的 click 会被吃掉,
  // 因为 mousedown 在 button 上 preventDefault + 我们没有 emit click 之后.
  // 不过 makeDraggable 内部不 preventDefault on click, 所以 click 还是会 fire —
  // 这就要求 mouseup 跟 click 是分开的两个事件. 实际测试: 拖完松开, click
  // 不会触发 (浏览器只在 mousedown 跟 mouseup 是同一元素才触发 click), 因此
  // 拖完不会打开面板, 这是对的.
  makeDraggable(btn, btn, (left, top) => writeNotesBtnPos(opts.bookPath, { left, top }));
  parent.appendChild(btn);
  return btn;
};

const createNotesPanel = (parent: HTMLElement): HTMLElement => {
  const panel = document.createElement("div");
  panel.className = "ez-reader__pdf-overlay-notes-panel";
  parent.appendChild(panel);
  return panel;
};

const createHighlightLayer = (parent: HTMLElement): HTMLElement => {
  const layer = document.createElement("div");
  layer.className = "ez-reader__pdf-overlay-highlight-layer";
  parent.appendChild(layer);
  return layer;
};

/**
 * Create the floating search bar for in-PDF find. Same "fixed + viewport"
 * pattern as ReaderSelectionMenu. Returns the root element; the host
 * toggles `is-hidden` directly.
 *
 * Note: PDF overlay can't reuse the EPUB / PagedText `SearchBar` class
 * because the host plumbing is different — Plugin.handleProtocol only
 * knows about PdfOverlay, not ReaderView. Keeping it inline here.
 */
const createSearchBar = (
  parent: HTMLElement,
  handlers: { onSearch: (query: string, fromStart: boolean) => void; onClose: () => void }
): HTMLElement => {
  const bar = document.createElement("div");
  bar.className = "ez-reader__pdf-overlay-search-bar is-hidden";
  const input = bar.createEl("input", {
    attr: { type: "search", placeholder: "搜索 PDF 文字……", "aria-label": "搜索 PDF" }
  });
  input.addClass("ez-reader__pdf-overlay-search-bar__input");
  const status = bar.createEl("span", { text: "", cls: "ez-reader__pdf-overlay-search-bar__status" });
  const nextBtn = bar.createEl("button", { text: "↓", attr: { type: "button", title: "下一处" } });
  nextBtn.addClass("ez-reader__pdf-overlay-search-bar__btn");
  const prevBtn = bar.createEl("button", { text: "↑", attr: { type: "button", title: "上一处" } });
  prevBtn.addClass("ez-reader__pdf-overlay-search-bar__btn");
  const closeBtn = bar.createEl("button", { text: "×", attr: { type: "button", title: "关闭" } });
  closeBtn.addClass("ez-reader__pdf-overlay-search-bar__btn", "ez-reader__pdf-overlay-search-bar__close");

  // fromStart (向上翻到上一次命中) comes from Shift+Enter / the ↑ button and
  // is passed per call, so no cross-call query state is needed here.
  const commit = (fromStart: boolean): void => {
    handlers.onSearch(input.value.trim(), fromStart);
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(event.shiftKey);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      handlers.onClose();
    }
  });
  nextBtn.addEventListener("click", (event) => {
    event.preventDefault();
    commit(false);
  });
  prevBtn.addEventListener("click", (event) => {
    event.preventDefault();
    commit(true);
  });
  closeBtn.addEventListener("click", (event) => {
    event.preventDefault();
    handlers.onClose();
  });

  parent.appendChild(bar);
  // 让 PdfOverlay 通过 querySelector 拿 input/status。
  (bar as unknown as { __ezReaderInput: HTMLInputElement }).__ezReaderInput = input;
  (bar as unknown as { __ezReaderStatus: HTMLElement }).__ezReaderStatus = status;
  return bar;
};

/** Update the search status text. `null` clears, `0` shows "无匹配", `N` shows count. */
const updatePdfSearchStatus = (bar: HTMLElement, count: number | null): void => {
  const status = (bar as unknown as { __ezReaderStatus?: HTMLElement }).__ezReaderStatus;
  if (!status) return;
  if (count === null) {
    status.setText("");
    return;
  }
  if (count === 0) {
    status.setText("无匹配");
  } else {
    status.setText(`${count} 处`);
  }
};

/**
 * Walk a PDF page element's text-layer and return the direct-child spans.
 * Same logic as `core/pdf/highlight.ts` `collectTextLayerSpans` — kept
 * local to avoid importing a private helper across the modules boundary.
 */
const collectTextLayerSpans = (pageEl: HTMLElement): HTMLElement[] => {
  const textLayer = pageEl.querySelector(".textLayer");
  if (!(textLayer instanceof HTMLElement)) return [];
  return Array.from(textLayer.querySelectorAll(":scope > span")).filter(
    (el): el is HTMLElement => el instanceof HTMLElement
  );
};

interface NotesRenderHandlers {
  onJump: (locator: string) => void;
  onRemoveBookmark: (id: string) => Promise<void>;
  onRemoveExcerpt: (id: string) => Promise<void>;
  /**
   * 用户在笔记面板里直接编辑 note (想法 / 评论) 时触发. 不传就面板只读.
   * P2 feedback: "点黄线应该能看 / 改想法" — 实现路径就是这个 callback.
   */
  onUpdateNote?: (id: string, note: string) => Promise<void>;
}

/** 笔记面板里 note 节点的 class —— capture / restore 都要靠它定位。 */
const PDF_NOTE_CLS = "ez-reader__pdf-overlay-notes-panel__note";

/**
 * `NodeFilter.SHOW_TEXT` 的数值。
 * 直接用全局 `NodeFilter` 在两个环境下都有坑 (jsdom 只在 window 上挂它,
 * Obsidian 旧 WebView 未必有), 而 `createTreeWalker` 的第二个参数只认这个
 * 数字 —— 用常量最省事。
 */
const SHOW_TEXT = 4;

/** 用户正在编辑、还没提交的 inline note 内容。 */
interface NoteDraft {
  /** 已经敲进去但还没 blur 提交的文本。 */
  readonly text: string;
  /** 光标在 `text` 里的偏移 —— 重渲染后要放回去, 否则用户每次刷新都得
   *  重新把光标拉到刚才的位置。 */
  readonly caretOffset: number;
}

/**
 * 量出光标相对 noteEl 内容开头的偏移。
 *
 * 用 Range 量 (`selectNodeContents` + `setEnd(caret)` 再 `toString().length`)
 * 而不是遍历 text node 数字符 —— noteEl 是 contenteditable, 用户可能敲进
 * `<br>` 或粘贴进富文本, 只有 Range 知道那些节点该怎么折算成字符串长度。
 */
const caretOffsetIn = (el: HTMLElement): number => {
  const sel = typeof document.getSelection === "function" ? document.getSelection() : null;
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return 0;
  const probe = range.cloneRange();
  probe.selectNodeContents(el);
  probe.setEnd(range.startContainer, range.startOffset);
  return probe.toString().length;
};

/** 把光标放回 `offset` 位置 (越界则落到末尾)。 */
const setCaretIn = (el: HTMLElement, offset: number): void => {
  const sel = typeof document.getSelection === "function" ? document.getSelection() : null;
  if (!sel) return;
  let remaining = Math.max(0, Math.trunc(offset));
  let target: Text | null = null;
  const walker = document.createTreeWalker(el, SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) {
      target = node as Text;
      break;
    }
    remaining -= length;
    node = walker.nextNode();
  }
  const range = document.createRange();
  if (target) {
    range.setStart(target, Math.min(remaining, target.textContent?.length ?? 0));
  } else {
    // 文本被清空 / offset 越界 — 光标落末尾
    range.selectNodeContents(el);
    range.collapse(false);
    return;
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
};

/**
 * 重渲染前抓取「正在编辑」的 note 节点。
 *
 * P0: `renderNotesPanelContent` 每次都 `panel.empty()` 重建整个面板, 而笔记
 * 面板有 9 个刷新触发点 (点开面板 / 点黄条 / 加摘录 / 加想法 / 删书签 …)。
 * 用户在某个 inline note 里敲了一半, 一次刷新就把输入框连同未提交的内容一起
 * 吞掉 —— 而且是静默丢失, 用户以为存上了。SidebarNotesPanel (EPUB 侧) 已经
 * 用 "用户点 ▸ 展开才进编辑态 + blur/Cmd+Enter 提交" 处理过同类问题, PDF 侧
 * 之前没有等价保护。
 *
 * 只抓 `data-editing="1"` 的节点 —— 已退出编辑态的显示的是 store 里的值,
 * 应当以 store 为准, 拿旧 DOM 覆盖反而会显示过期内容。
 */
const captureNoteDrafts = (panel: HTMLElement): Map<string, NoteDraft> => {
  const drafts = new Map<string, NoteDraft>();
  for (const row of Array.from(panel.querySelectorAll<HTMLElement>("[data-excerpt-id]"))) {
    const id = row.getAttribute("data-excerpt-id");
    if (!id) continue;
    const noteEl = row.querySelector<HTMLElement>(`.${PDF_NOTE_CLS}`);
    if (!noteEl || noteEl.getAttribute("data-editing") !== "1") continue;
    drafts.set(id, {
      text: noteEl.textContent ?? "",
      caretOffset: caretOffsetIn(noteEl)
    });
  }
  return drafts;
};

/** 把抓到的草稿写回重渲染后的新节点, 并恢复编辑态 + 光标。 */
const restoreNoteDraft = (noteEl: HTMLElement, draft: NoteDraft): void => {
  noteEl.contentEditable = "true";
  noteEl.setAttribute("data-editing", "1");
  noteEl.addClass("is-editing");
  noteEl.toggleClass("has-content", draft.text.length > 0);
  noteEl.toggleClass("is-placeholder", draft.text.length === 0);
  noteEl.setText(draft.text);
  // 焦点回到原处, 用户可以接着敲。jsdom 不给普通 div 焦点, 失败也无妨 ——
  // 真正的用户在 Obsidian (Chromium) 里能拿回焦点。
  noteEl.focus();
  setCaretIn(noteEl, draft.caretOffset);
};

const renderNotesPanelContent = (
  panel: HTMLElement,
  bookmarks: ReadonlyArray<Bookmark>,
  excerpts: ReadonlyArray<Excerpt>,
  handlers: NotesRenderHandlers
): void => {
  // 重建之前先把用户正在输入的东西抓下来 (见 captureNoteDrafts 的说明)。
  const drafts = captureNoteDrafts(panel);
  panel.empty();
  panel.createEl("div", { cls: "ez-reader__pdf-overlay-notes-panel__heading", text: "笔记" });

  if (bookmarks.length === 0 && excerpts.length === 0) {
    panel.createEl("div", {
      cls: "ez-reader__pdf-overlay-notes-panel__empty",
      text: "这本书还没有书签或摘录。在 PDF 上选词 → 摘录即可添加。"
    });
    return;
  }

  if (bookmarks.length > 0) {
    panel.createEl("h4", { text: `书签 (${bookmarks.length})` });
    for (const bm of bookmarks) {
      const row = panel.createEl("div", { cls: "ez-reader__pdf-overlay-notes-panel__row" });
      row.createEl("span", { text: bm.label, cls: "label" });
      const del = row.createEl("button", { text: "×", cls: "remove", title: "删除" });
      del.addEventListener("click", () => void handlers.onRemoveBookmark(bm.id));
    }
  }

  if (excerpts.length > 0) {
    panel.createEl("h4", { text: `摘录 (${excerpts.length})` });
    for (const ex of excerpts) {
      const row = panel.createEl("div", { cls: "ez-reader__pdf-overlay-notes-panel__row" });
      row.setAttribute("data-excerpt-id", ex.id);
      row.createEl("div", { text: ex.text, cls: "excerpt" });
      // 想法 / 评论 (note) — 内联编辑. 初始只读, click 进编辑; blur 保存.
      // 没传 handlers.onUpdateNote 时 fallback 只读显示.
      const draft = drafts.get(ex.id);
      const noteEl = row.createEl("div", {
        cls: PDF_NOTE_CLS,
        text: draft ? draft.text : ex.note || ""
      });
      if (draft) {
        // 重渲染前后是同一条摘录 → 原样恢复编辑态, 不让用户输入被吞。
        restoreNoteDraft(noteEl, draft);
      } else {
        noteEl.setAttribute("data-editing", "0");
        if (ex.note) noteEl.addClass("has-content");
        else noteEl.addClass("is-placeholder");
      }
      if (handlers.onUpdateNote) {
        // 仍然拿 `ex` (store 里的旧值) 当基线 —— blur 时拿它做对比决定要不要
        // 提交, Esc 时拿它还原, 这两个语义都要求基线是"上次存盘的内容"。
        attachInlineNoteEditor(noteEl, ex, handlers.onUpdateNote);
      }
      const pos = ex.locator.position;
      if (pos.kind === "pdf") {
        // 跳页 / 跳选区 — 优先精确选区, 没存 selection 时 fallback 到页码.
        // 之前只画 selection 按钮, 没存 selection 的摘录没 jump 按钮,
        // 用户只能手动翻页找 — 体验割裂.
        const target = pos.selection ?? `#page=${pos.page}`;
        const title = pos.selection ? "跳到选区" : `跳到第 ${pos.page} 页`;
        const jump = row.createEl("button", { text: "→", cls: "jump", title });
        jump.addEventListener("click", () => handlers.onJump(target));
      }
      const del = row.createEl("button", { text: "×", cls: "remove", title: "删除" });
      del.addEventListener("click", () => void handlers.onRemoveExcerpt(ex.id));
    }
  }
};

/**
 * 给 note 节点挂 inline 编辑 — 模仿 SidebarNotesPanel (ReaderView 里) 的
 * contenteditable 模式:
 *   - 默认只读 (data-editing="0"), 显示 placeholder "+ 添加想法"
 *   - click 进编辑 (data-editing="1"), 焦点 + 全选
 *   - blur 退出编辑, textContent 跟原值不同就调 onUpdateNote
 *   - Esc 取消还原 (还原 ex.note)
 *
 * data-editing="1" 是 sentinel — jsdom 不支持 `isContentEditable` 属性观察,
 * 不能用 el.isContentEditable 当判断 (实测拿到的总是 undefined).
 */
const attachInlineNoteEditor = (
  noteEl: HTMLElement,
  ex: Excerpt,
  onUpdate: (id: string, note: string) => Promise<void>
): void => {
  noteEl.setAttribute("title", "点击编辑想法");
  noteEl.addEventListener("click", () => {
    if (noteEl.getAttribute("data-editing") === "1") return;
    noteEl.setAttribute("data-editing", "1");
    noteEl.removeClass("is-placeholder");
    noteEl.addClass("is-editing");
    noteEl.setText(ex.note || "");
    noteEl.contentEditable = "true";
    noteEl.focus();
    // 全选文字 — 用户开始输入直接覆盖, 不要 append
    const range = document.createRange();
    range.selectNodeContents(noteEl);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });
  noteEl.addEventListener("blur", () => {
    if (noteEl.getAttribute("data-editing") !== "1") return;
    const next = (noteEl.textContent ?? "").trim();
    noteEl.contentEditable = "false";
    noteEl.removeClass("is-editing");
    noteEl.setAttribute("data-editing", "0");
    // 留空就显示 placeholder, 跟初始没动区状态对齐
    if (next) noteEl.addClass("has-content");
    else noteEl.removeClass("has-content");
    noteEl.toggleClass("is-placeholder", next.length === 0);
    if (next !== ex.note) {
      void onUpdate(ex.id, next);
    }
  });
  noteEl.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      // Esc 取消还原 — 直接 blur 不触发保存 (textContent 跟 ex.note 一致)
      noteEl.setText(ex.note || "");
      noteEl.blur();
      event.preventDefault();
    } else if (event.key === "Enter" && !event.shiftKey) {
      // 单 Enter 退出编辑 (commit), Shift+Enter 换行
      event.preventDefault();
      noteEl.blur();
    }
  });
};

const drawHighlight = (
  layer: HTMLElement,
  rect: { left: number; top: number; width: number; height: number },
  excerptId: string,
  searchText: string,
  onClick?: (excerptId: string) => void
): HTMLElement => {
  const hl = document.createElement("div");
  hl.className = "ez-reader__pdf-overlay-highlight";
  hl.dataset.excerptId = excerptId;
  hl.dataset.searchText = searchText;
  hl.setCssProps({
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  });
  // 直接绑 click 到 highlight div — 不靠 layer 上的事件委托.
  // 之前委托给 layer 在某些 Electron 版本下被某层 (PDFView / selection menu
  // 的 outside-click handler) 静默拦截, 用户感觉"点黄线无反应". 这里直接绑
  // 在 highlight 上, capture=false 防止触发 PDFView 的 click handler 先.
  // onClick 必须 stopPropagation 避免双重触发 layer delegate.
  if (onClick) {
    hl.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick(excerptId);
    });
    // 加 mousedown 也监听一次 — 防止 click 被 stop 之前被某层 handler preventDefault.
    // (mousedown 早于 click, 触发但不做任何操作, 只确保用户手势不丢失).
  }
  layer.appendChild(hl);
  return hl;
};

/**
 * P0-3 配套: 找到 PDF 的总页数. PDFView DOM 一次性渲染所有 page 元素
 * (lazy load 但都在 DOM 里), 找最大 data-page-number 即可. 没找到时
 * 返回 null — caller 应该 fallback 到没有 totalPages 的 position.
 */
const findPdfTotalPages = (container: HTMLElement): number | null => {
  const pages = Array.from(
    container.querySelectorAll<HTMLElement>(".pdf-page[data-page-number], .page[data-page-number]")
  );
  if (pages.length === 0) return null;
  let max = 0;
  for (const el of pages) {
    const n = el.getAttribute("data-page-number");
    if (n && /^\d+$/.test(n)) {
      const parsed = Number(n);
      if (parsed > max) max = parsed;
    }
  }
  return max > 0 ? max : null;
};

/**
 * PDF 选词翻译的浮动小弹窗。position: fixed 锚到选词 rect 附近 (跟
 * selectionMenuAt 同算法), 内容:
 *   - 原文 (浅灰小字, 最多 3 行, 多了省略)
 *   - 译文 (主显示区)
 *   - meta (检测到的源语言 · provider · 目标语言)
 *   - 按钮: 复制 / 换语言重译 / × 关闭
 *
 * 替代之前的 `new Notice(...)` 模式 — 那个过几秒自动消失、长译文截掉、
 * 没复制按钮。新计划跟 ReaderView 的 TranslationDrawer 视觉一致但更紧凑。
 */
const createTranslationPopover = (
  parent: HTMLElement,
  opts: { onCopy: () => void; onCycleTarget: () => void }
): HTMLElement => {
  const root = document.createElement("div");
  root.className = "ez-reader__pdf-translation is-hidden";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "翻译结果");
  const header = document.createElement("div");
  header.className = "ez-reader__pdf-translation__header";
  const source = document.createElement("div");
  source.className = "ez-reader__pdf-translation__source";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "ez-reader__pdf-translation__close";
  closeBtn.textContent = "×";
  closeBtn.title = "关闭";
  closeBtn.setAttribute("aria-label", "关闭翻译");
  closeBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    root.addClass("is-hidden");
  });
  header.append(source, closeBtn);
  const body = document.createElement("div");
  body.className = "ez-reader__pdf-translation__body is-loading";
  body.textContent = "正在翻译…";
  const provider = document.createElement("div");
  provider.className = "ez-reader__pdf-translation__provider";
  const actions = document.createElement("div");
  actions.className = "ez-reader__pdf-translation__actions";
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "ez-reader__pdf-translation__copy-btn";
  copyBtn.textContent = "复制";
  copyBtn.setAttribute("aria-label", "复制译文");
  copyBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    opts.onCopy();
  });
  const cycleBtn = document.createElement("button");
  cycleBtn.type = "button";
  cycleBtn.className = "ez-reader__pdf-translation__cycle-btn";
  cycleBtn.textContent = "换语言重译";
  cycleBtn.setAttribute("aria-label", "切换目标语言后重新翻译");
  cycleBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    opts.onCycleTarget();
  });
  actions.append(copyBtn, cycleBtn);
  root.append(header, body, provider, actions);
  // 拖拽 — 按 header(避开 × 按钮)就能拖到屏幕任意位置。拖出视口的边界
  // 由 makeDraggable 内部 clamp, 不会丢到屏幕外找不回来.
  makeDraggable(root, header);
  parent.appendChild(root);
  return root;
};

/**
 * 让 el 跟随 handle 鼠标拖动 — 只用原生 mousedown/move/up, 不引外部库.
 *
 * - 鼠标按 handle(左键) 启动拖拽, 记录起始鼠标位置 + el 起始位置 + 尺寸
 * - mousemove 把 el.setCssProps({left, top}) 用「orig + dx/dy」算出, 同
 *   时 clamp 到视口内(防止拖出去找不回来)
 * - mouseup / 鼠标离开 document 都结束
 * - 按到 button / input / select / textarea 不启动拖拽(避免点 × 误拖)
 * - 拖拽期间给 el 加 `is-dragging` class, CSS 切 cursor + 关掉文字选择
 *
 * 每次 drag 都是新的: 不会保存位置, 下次 showTranslationPopover 会重新
 * anchor 到新选词附近 (用户期望的是「每条翻译就近弹」, 不是「全局记忆位置」).
 */
const makeDraggable = (
  el: HTMLElement,
  handle: HTMLElement,
  onMove?: (left: number, top: number) => void
): void => {
  let dragState: {
    startX: number;
    startY: number;
    origLeft: number;
    origTop: number;
    width: number;
    height: number;
  } | null = null;

  const cleanup = (): void => {
    dragState = null;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    el.removeClass("is-dragging");
  };

  const onMouseMove = (event: MouseEvent): void => {
    if (!dragState) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    // Clamp 到视口 — 0..(viewport - el 尺寸), 防止用户拖到屏外找不回来.
    const maxLeft = Math.max(0, window.innerWidth - dragState.width);
    const maxTop = Math.max(0, window.innerHeight - dragState.height);
    const newLeft = Math.max(0, Math.min(maxLeft, dragState.origLeft + dx));
    const newTop = Math.max(0, Math.min(maxTop, dragState.origTop + dy));
    el.setCssProps({ left: `${newLeft}px`, top: `${newTop}px` });
    onMove?.(newLeft, newTop);
  };

  const onMouseUp = (): void => {
    cleanup();
  };

  handle.addEventListener("mousedown", (event) => {
    // 只响应左键 — 右键 / 中键不拖
    if (event.button !== 0) return;
    // 不要在按钮 / 输入控件上启动拖拽 — 用户点 × 误触发拖拽会很怪.
    // 但是 handle 本身可能就是 button (e.g. notes button 整体可拖),
    // 所以排除 handle 自身 — 只阻止 handle *内部* 的 button 误触.
    const target = event.target as HTMLElement | null;
    const nestedButton = target?.closest(
      "button, input, select, textarea, [role='button']"
    );
    if (nestedButton && nestedButton !== handle) return;
    event.preventDefault();
    const rect = el.getBoundingClientRect();
    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      origLeft: rect.left,
      origTop: rect.top,
      width: rect.width,
      height: rect.height
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    el.addClass("is-dragging");
  });
};

/**
 * localStorage 读写 helper — 笔记按钮位置按 bookPath 各自存, 不同 PDF 记忆
 * 不同位置. 旧版本用了 bottom/right 锚定, 没有 left/top, 这里读不到就走默认
 * fallback (右下角).
 *
 * 防越界: 读到的 top/left 必须 finite + 在当前 viewport 内, 否则忽略走默认.
 * 之前没 clamp, 理论上用户拖到屏外 + 缩放窗口后下次 reload 按钮会跑屏外
 * (用户体感: "笔记图标不见了"). 实际触发概率低但成本是 0, 加保险.
 */
const NOTES_BTN_POS_KEY = "ez-reader.pdf.notesBtnPos.";

interface SavedNotesBtnPos {
  readonly top: number;
  readonly left: number;
}

const NOTES_BTN_SIZE = 44;

const readNotesBtnPos = (bookPath: string): SavedNotesBtnPos | null => {
  try {
    const raw = localStorage.getItem(NOTES_BTN_POS_KEY + bookPath);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedNotesBtnPos>;
    if (typeof parsed.top !== "number" || typeof parsed.left !== "number") return null;
    // NaN / Infinity 都要拒 — typeof NaN === "number", 但 CSS 用 NaN 会让
    // 元素不渲染, 用户看到「按钮不见了」
    if (!isFinite(parsed.top) || !isFinite(parsed.left)) return null;
    // 负数 (理论上拖拽期间已经被 clamp 到 >= 0, 但旧版本可能存了负值)
    if (parsed.top < 0 || parsed.left < 0) return null;
    // Clamp 到当前 viewport — 用户可能在 4K 屏拖好, 切到 1080p 重启就
    // 跑屏外. viewport 在按钮创建时拿到, 那时同步计算.
    const maxLeft = Math.max(0, window.innerWidth - NOTES_BTN_SIZE);
    const maxTop = Math.max(0, window.innerHeight - NOTES_BTN_SIZE);
    return {
      top: Math.max(0, Math.min(maxTop, parsed.top)),
      left: Math.max(0, Math.min(maxLeft, parsed.left))
    };
  } catch {
    return null;
  }
};

const writeNotesBtnPos = (bookPath: string, pos: SavedNotesBtnPos): void => {
  try {
    localStorage.setItem(NOTES_BTN_POS_KEY + bookPath, JSON.stringify(pos));
  } catch {
    // localStorage 满了 / disabled — 静默, 用户下次重启位置不持久化但功能不挂
  }
};
