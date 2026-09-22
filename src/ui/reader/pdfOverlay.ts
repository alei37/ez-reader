import { Notice } from "obsidian";
import type { WorkspaceLeaf, App } from "obsidian";
import type { ReadingService } from "../../core/services/ReadingService";
import type { TranslationService } from "../../core/ports/TranslationProvider";
import type { NoteWriter } from "../../core/ports/NoteWriter";
import type { LibraryService } from "../../core/services/LibraryService";
import type { Bookmark } from "../../core/entities/Bookmark";
import type { Excerpt } from "../../core/entities/Excerpt";
import type { ReadingPosition } from "../../core/entities/ReadingState";
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
  readonly noteWriter?: NoteWriter;
}

interface PendingSelection {
  text: string;
  locator: string;
  pageNumber: number;
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
  const uuid = globalThis.crypto?.randomUUID?.();
  if (typeof uuid === "string" && uuid.length > 0) {
    return `${prefix}-${uuid}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

/** Module-level registry — 每 leaf 最多挂一个 overlay 实例. */
const ATTACHED = new WeakMap<WorkspaceLeaf, PdfOverlay>();

/**
 * Public lookup — Plugin.handleProtocol 用这个找挂在 PDF leaf 上的 overlay,
 * 然后调 overlay.jumpToExcerpt 让 PDF 跳到对应摘录页 + 画 highlight. 不暴露
 * WeakMap 本身 (内部一致性靠 internal API), 只给一个 read-only 查询入口.
 */
export const findPdfOverlayForLeaf = (leaf: WorkspaceLeaf): PdfOverlay | undefined => {
  return ATTACHED.get(leaf);
};

/** Debounce — 合并短时间内的高频触发. */
const debounce = <Args extends unknown[]>(
  fn: (...args: Args) => void,
  ms: number
): ((...args: Args) => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
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
  private readonly disposers: Array<() => void> = [];
  private readonly highlightsByExcerpt = new Map<string, RenderedHighlight>();
  private pendingSelection: PendingSelection | undefined;
  private bookId: string | undefined;
  private bookTitle = "";
  private targetLocale = "zh-CN";
  private mounted = false;
  /** P1: in-PDF find state — see `runPdfSearch`. */
  private pdfFindQuery = "";
  private pdfFindCurrentPage: number | null = null;
  private pdfFindMatchCount = 0;
  private readonly renderHighlightsDebounced: () => void;
  private readonly repositionHighlightsDebounced: () => void;

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
      onClick: () => this.toggleNotesPanel()
    });
    this.highlightLayer = createHighlightLayer(document.body);
    this.searchBar = createSearchBar(document.body, {
      onSearch: (q, fromStart) => void this.runPdfSearch(q, fromStart),
      onClose: () => this.closePdfSearch()
    });

    this.renderHighlightsDebounced = debounce(() => void this.renderHighlights(), 250);
    this.repositionHighlightsDebounced = debounce(() => this.repositionHighlights(), 100);
  }

  /** Resolve bookId + title + translation locale. Must be awaited before mount. */
  async resolveBook(): Promise<void> {
    const entry = this.opts.library.list().find((e) => e.book.locator.path === this.opts.bookPath);
    if (entry) {
      this.bookId = entry.book.id;
      this.bookTitle = entry.book.metadata?.title ?? entry.book.locator.path;
    }
    this.targetLocale = await this.opts.reading.getTranslationLocale();
  }

  /** Attach to the PDFView leaf. Idempotent — 同 leaf 重复调用会先卸载旧的. */
  mount(): void {
    if (this.mounted) return;
    const existing = ATTACHED.get(this.opts.pdfLeaf);
    if (existing && existing !== this) {
      existing.unmount();
    }
    ATTACHED.set(this.opts.pdfLeaf, this);

    const onSelectionChange = () => {
      if (!this.isLeafAlive()) {
        this.unmount();
        return;
      }
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
      this.pendingSelection = { text, locator, pageNumber };
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
        this.notesPanel.contains(target)
      ) {
        return;
      }
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed) this.hideMenu();
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
      let lastUpdate = 0;
      const tick = (): void => {
        const now = performance.now();
        // 每帧检查一次位置 — 但只在 viewport 真的变化时触发 update, 避免空跑.
        // 简化: 永远调一次 reposition, 内部判断 visible / hidden / in-place.
        this.repositionHighlights();
        lastUpdate = now;
        rafHandle = requestAnimationFrame(tick);
      };
      rafHandle = requestAnimationFrame(tick);
      this.disposers.push(() => cancelAnimationFrame(rafHandle));
    }

    // workspace 变化 — 检测 leaf 是否还在
    const onLeafChange = () => {
      if (!this.isLeafAlive()) this.unmount();
    };
    this.opts.app.workspace.on("active-leaf-change", onLeafChange);
    this.disposers.push(() => this.opts.app.workspace.off("active-leaf-change", onLeafChange));

    // P0-3: PDF 阅读进度追踪 — 用户翻页时 (scrollIntoView 触发 active page
    // 切换) 调 reading.updatePosition 把 (page, totalPages) 写回 store.
    // 之前 PdfOverlay 完全不存 PDF 进度, reading.position 永远是 null,
    // progressFraction 一直返回 0, PDF 永远 "untouched". 现在 mutation
    // observer 监听 .pdf-page.active 变化触发更新.
    let persistTimer: ReturnType<typeof setTimeout> | undefined;
    const schedulePositionPersist = (): void => {
      if (persistTimer !== undefined) clearTimeout(persistTimer);
      // 250ms debounce — 用户快速滚动时不会触发 10+ 次 IO
      persistTimer = setTimeout(() => void this.persistCurrentPosition(), 250);
    };
    this.disposers.push(() => {
      if (persistTimer !== undefined) {
        clearTimeout(persistTimer);
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
        // 用 capture + closest 避免跟 PDFView 自身的 click 处理打架.
        div.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!this.notesPanel.classList.contains("is-open")) {
            this.toggleNotesPanel();
          }
          this.focusExcerptInPanel(item.ex.id);
        });
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

  unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;
    for (const d of this.disposers) {
      try {
        d();
      } catch (error) {
        console.warn("[ez-reader] PdfOverlay disposer threw", error);
      }
    }
    this.disposers.length = 0;
    this.menuEl.remove();
    this.notesBtn.remove();
    this.notesPanel.remove();
    this.highlightLayer.remove();
    this.searchBar.remove();
    this.clearPdfSearchHighlights();
    this.pendingSelection = undefined;
    this.highlightsByExcerpt.clear();
    if (ATTACHED.get(this.opts.pdfLeaf) === this) {
      ATTACHED.delete(this.opts.pdfLeaf);
    }
  }

  private hideMenu(): void {
    this.menuEl.setCssProps({ display: "none" });
  }

  private toggleNotesPanel(): void {
    const isOpen = this.notesPanel.classList.toggle("is-open");
    this.notesBtn.classList.toggle("is-active", isOpen);
    if (isOpen) void this.refreshNotesPanel();
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
        onRemoveBookmark: async (id) => {
          await this.opts.reading.removeBookmark(this.bookId!, id);
          await this.refreshNotesPanel();
          new Notice("书签已删除");
        },
        onRemoveExcerpt: async (id) => {
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
        }
      });
    } catch (error) {
      console.warn("[ez-reader] failed to refresh notes panel", error);
    }
  }

  private jumpToLocator(locator: string): void {
    if (!locator) return;
    // Obsidian 自带 PDFView 接受 #page=N subpath 跳页 — 我们存的就是这个
    void this.opts.app.workspace.openLinkText(`${this.opts.bookPath}${locator}`, "", false);
  }

  private async handleTranslate(): Promise<void> {
    if (!this.pendingSelection) return;
    const text = this.pendingSelection.text;
    this.hideMenu();
    try {
      const result = await this.opts.translation.translate(text, "auto", this.targetLocale);
      new Notice(`翻译 (${this.targetLocale}):\n${result.text}`, 10000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`翻译失败: ${message}`);
    }
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
        const ref = await this.opts.noteWriter.ensureBookNote({
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
        const ref = await this.opts.noteWriter.ensureBookNote({
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
    globalThis.setTimeout(() => target.classList.remove("ez-reader__pdf-overlay-row--focus"), 1500);
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
  requestAnimationFrame(() => {
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

const createNotesButton = (parent: HTMLElement, opts: { onClick: () => void }): HTMLElement => {
  const btn = document.createElement("button");
  btn.className = "ez-reader__pdf-overlay-notes-btn";
  btn.textContent = "📝";
  btn.title = "笔记 (bookmarks / excerpts)";
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    opts.onClick();
  });
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

  // 用闭包变量记 current query, Enter 时区分 fromStart vs next.
  let lastQuery = "";
  const commit = (fromStart: boolean): void => {
    const value = input.value.trim();
    lastQuery = value;
    handlers.onSearch(value, fromStart);
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
}

const renderNotesPanelContent = (
  panel: HTMLElement,
  bookmarks: ReadonlyArray<Bookmark>,
  excerpts: ReadonlyArray<Excerpt>,
  handlers: NotesRenderHandlers
): void => {
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

const drawHighlight = (
  layer: HTMLElement,
  rect: { left: number; top: number; width: number; height: number },
  excerptId: string,
  searchText: string
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
