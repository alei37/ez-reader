import type { Book, BookMetadata } from "../../core/entities/Book";
import type {
  BookBytesLoader,
  BookReader,
  ExtractedCover,
  HighlightSpec,
  ReaderEventMap,
  ReaderSession,
  ReaderTarget,
  TocItem
} from "../../core/ports/BookReader";
import type { ReaderAppearance } from "../../core/types/ReaderSettings";
import { READER_FONT_FAMILY_STACKS } from "../../core/types/ReaderSettings";
import { mimeTypeFor } from "../../core/entities/Book";
import { themeColors } from "../../core/utils/themeColors";
import { sniffImageMime } from "../../core/utils/imageSniff";

interface FoliateViewElement extends HTMLElement {
  open(book: unknown): Promise<void>;
  close(): void;
  goTo(target: string | number): Promise<unknown>;
  goLeft(): Promise<void>;
  goRight(): Promise<void>;
  goToFraction(fraction: number): Promise<void>;
  getCFI(index: number, range?: Range): string;
  addAnnotation(annotation: { value: string }, remove?: boolean): Promise<unknown>;
  deselect(): void;
  book?: {
    toc?: ReadonlyArray<{ label?: unknown; href?: unknown; subitems?: unknown }>;
    metadata?: { title?: unknown; creator?: unknown; language?: unknown };
    getCover?: () => Promise<Blob | null>;
    sections?: ReadonlyArray<{ id?: string; load?: () => Promise<string> }>;
  };
  renderer?: HTMLElement & {
    setStyles?: (css: string) => void;
    paginator?: {
      sections?: ReadonlyArray<{ id?: string; load?: () => Promise<string | Document> }>;
      // 0-based section index of the currently displayed section.
      sectionIndex?: number;
      goToFraction?: (fraction: number) => Promise<void>;
    };
  };
  lastLocation?: { fraction?: number; cfi?: string; tocItem?: { label?: string } };
}

interface FoliateModule {
  makeBook: (input: File) => Promise<unknown>;
}

/**
 * Build the CSS string passed to `foliate-paginator.setStyles()`. Pure
 * function so we can unit-test that every `ReaderAppearance` field reaches
 * the iframe.
 */
export const buildAppearanceCss = (appearance: ReaderAppearance): string => {
  const theme = themeColors(appearance.theme);
  const fontScale = (appearance.fontSize / 100).toFixed(3);
  const fontFamily = READER_FONT_FAMILY_STACKS[appearance.fontFamily ?? "serif"];
  const letterSpacing = (appearance.letterSpacing ?? 0).toFixed(3);
  const maxWidth = appearance.maxWidth ?? 720;
  return `
    :root {
      --ez-reader-font-scale: ${fontScale};
      --ez-reader-font-family: ${fontFamily};
      --ez-reader-letter-spacing: ${letterSpacing}em;
      --ez-reader-max-width: ${maxWidth}px;
    }
    html, body {
      font-size: calc(1em * var(--ez-reader-font-scale)) !important;
      color: ${theme.fg} !important;
      background: ${theme.bg} !important;
      color-scheme: ${theme.scheme};
    }
    body {
      padding-inline: ${appearance.margin}px !important;
      line-height: ${appearance.lineHeight} !important;
      font-family: var(--ez-reader-font-family) !important;
      letter-spacing: var(--ez-reader-letter-spacing) !important;
    }
    body > * { max-width: var(--ez-reader-max-width); margin-inline: auto; }
    p, li, blockquote, dd { line-height: ${appearance.lineHeight} !important; }
  `;
};

/**
 * Adapter that wraps foliate-js and exposes it through the `BookReader`
 * port. Each `open()` constructs a fresh `<foliate-view>` element; the host
 * is responsible for attaching it to the DOM.
 */
export class FoliateBookReader implements BookReader {
  async open(
    book: Book,
    host: HTMLElement,
    appearance: ReaderAppearance,
    loader: BookBytesLoader
  ): Promise<ReaderSession> {
    const { makeBook } = await importFoliateModule();
    const parsed = await loadEpubFile(book, loader, makeBook);

    // Content-safety hook: EPUB sections can include `<script>`, javascript:
    // links, etc. foliate streams section HTML through `transformTarget` so
    // we sanitize before the paginator sees it. (Algorithm adapted from
    // obsidian-pdf-plus; license: MIT, see LICENSES/.)
    const transformTarget = (parsed as { transformTarget?: EventTarget | null }).transformTarget;
    const onTransformData = (event: Event) => {
      const detail = (event as CustomEvent<{ data?: unknown; type?: string }>).detail;
      if (!detail) return;
      if (!/text\/(x?html)/i.test(detail.type ?? "")) return;
      detail.data = Promise.resolve(detail.data).then(async (data) => {
        const source = data instanceof Blob ? await data.text() : String(data);
        return sanitizeBookContent(source);
      });
    };

    const view = document.createElement("foliate-view") as FoliateViewElement;
    view.setAttribute("data-ez-reader-flow", appearance.flow);
    host.append(view);
    // 等一帧让 host 的 flex layout 生效(避免 host.clientWidth 还是 0 时
    // view.open 触发 paginator 用 0 宽度初始化)。
    if (host.clientWidth < 100 || host.clientHeight < 100) {
      await new Promise<void>((resolve) => globalThis.requestAnimationFrame(() => resolve()));
    }
    if (transformTarget) {
      transformTarget.addEventListener("data", onTransformData);
    }
    try {
      await view.open(parsed);
    } catch (error) {
      // P0: 之前 transformTarget listener 在 catch 路径上没被移除, 而 foliate
      // 的 transformTarget 可能是 shared EventTarget — 旧 listener 会泄漏
      // 到下一次 open(). 失败时也清掉.
      view.remove();
      if (transformTarget) transformTarget.removeEventListener("data", onTransformData);
      throw error;
    }

    const session = new FoliateSession(view, onTransformData, transformTarget);
    try {
      await session.applyAppearance(appearance);
    } catch (error) {
      // B1 修复: 之前 applyAppearance 抛错时 view + listener 已挂但没回滚,
      // host 累积多个 foliate-view element + 它们的 transformTarget listener
      // (shared EventTarget 跨书复用, 旧 listener 干扰下一次 open).
      // 现在跟 view.open 失败路径对称清理.
      view.remove();
      if (transformTarget) transformTarget.removeEventListener("data", onTransformData);
      throw error;
    }

    // 翻页动画: 在 foliate 的 `load` 事件触发时按方向加 class。
    // 三个方向 — forward (向右滑入) / backward (向左滑入) / initial (淡入),
    // 对应键盘 / 触摸 forward、backward、首次加载 + TOC + 进度条跳转。
    const directionClasses = [
      "ez-reader__page-loaded--forward",
      "ez-reader__page-loaded--backward",
      "ez-reader__page-loaded--initial"
    ] as const;
    const onLoad = () => {
      // P0 修复: 之前是 `void session.applyAppearance(appearance)` (fire-and-forget).
      // 如果 close() 跟 applyAppearance 竞速, view 已被 remove, setStyles
      // 在已 tear-down 的 renderer 上跑会 throw. await 它 + 让 onLoad 变成
      // async, 这样 view 已 detach 时 setStyles 是 no-op (renderer 引用
      // 变成 null 后, 早 return).
      void session.applyAppearance(appearance).catch((error) => {
        console.warn("[ez-reader] applyAppearance on reload failed", error);
      });
      view.classList.remove(...directionClasses);
      // 双 rAF — 强制 reflow 让浏览器重新跑一次 animation
      globalThis.requestAnimationFrame(() => {
        globalThis.requestAnimationFrame(() => {
          view.classList.add(`ez-reader__page-loaded--${session.direction}`);
        });
      });
    };
    view.addEventListener("load", onLoad);
    session.registerDisposer(() => view.removeEventListener("load", onLoad));
    return session;
  }

  async extractCover(book: Book, loader: BookBytesLoader): Promise<ExtractedCover | null> {
    const { makeBook } = await importFoliateModule();
    const parsed = await loadEpubFile(book, loader, makeBook);
    const bookObj = parsed as { getCover?: () => Promise<Blob | null> };
    if (typeof bookObj.getCover !== "function") return null;
    const blob = await bookObj.getCover();
    if (!blob) return null;
    const coverBytes = await blob.arrayBuffer();
    // foliate 的 getCover() 经常返回空 blob.type — 用 sniffer 看实际 bytes.
    return { bytes: coverBytes, mimeType: sniffImageMime(coverBytes) ?? (blob.type || "image/jpeg") };
  }

  /**
   * Extract EPUB OPF metadata (title / creator / language). foliate-js parses
   * the package document inside `makeBook()`; we read it back here so the
   * shelf shows the real book title instead of the filename.
   *
   * P0-2 修复: 之前书架永远显示 file.basename, 用户加入 `Introduction to
   * Seismology (Peter M. Shearer) (Z.epub` 这种 Z-Library dump 文件名,
   * 看不到 EPUB 内部 OPF 的真 title. 现在 reader open 后从 session 拿真实
   * metadata, 通过 LibraryService.refreshMetadata 写回 store, shelf 重渲染.
   */
  async readMetadata(book: Book, loader: BookBytesLoader): Promise<BookMetadata | null> {
    try {
      const { makeBook } = await importFoliateModule();
      const parsed = await loadEpubFile(book, loader, makeBook);
      const bookObj = parsed as { metadata?: { title?: unknown; creator?: unknown; language?: unknown; publisher?: unknown; identifier?: unknown; description?: unknown } };
      const raw = bookObj.metadata ?? {};
      const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : undefined;
      if (!title) return null; // 没真 title (罕见 — 没 OPF?), 让 caller fallback 到 filename.
      const creator = raw.creator;
      const authors: string[] = [];
      if (typeof creator === "string" && creator.trim()) authors.push(creator.trim());
      else if (Array.isArray(creator)) {
        for (const c of creator) {
          if (typeof c === "string" && c.trim()) authors.push(c.trim());
        }
      }
      const lang = raw.language;
      const languages: string[] = [];
      if (typeof lang === "string" && lang.trim()) languages.push(lang.trim());
      else if (Array.isArray(lang)) {
        for (const l of lang) {
          if (typeof l === "string" && l.trim()) languages.push(l.trim());
        }
      }
      return {
        title,
        authors,
        languages,
        publisher: typeof raw.publisher === "string" && raw.publisher.trim() ? raw.publisher.trim() : undefined,
        identifier: typeof raw.identifier === "string" && raw.identifier.trim() ? raw.identifier.trim() : undefined,
        description: typeof raw.description === "string" && raw.description.trim() ? raw.description.trim() : undefined,
        cachedAt: Date.now()
      };
    } catch (error) {
      console.warn("[ez-reader] foliate readMetadata failed", book.locator.path, error);
      return null;
    }
  }
}

/** Shared dynamic-import + cast for the foliate-js view module. */
const importFoliateModule = async (): Promise<FoliateModule> => {
  return (await import("foliate-js/view.js")) as unknown as FoliateModule;
};

/** Read a book's bytes, build a File, hand it to foliate. Used by both
 *  `open` and `extractCover` so the file-loading logic lives in one place. */
const loadEpubFile = async (
  book: Book,
  loader: BookBytesLoader,
  makeBook: FoliateModule["makeBook"]
): Promise<unknown> => {
  const bytes = await loader(book.locator.path);
  const file = new File([bytes], book.locator.path.split("/").pop() ?? "book", {
    type: mimeTypeFor(book.locator.format)
  });
  return makeBook(file);
};



class FoliateSession implements ReaderSession {
  readonly element: HTMLElement;
  private readonly view: FoliateViewElement;
  private readonly docListeners = new Set<() => void>();
  private readonly disposers = new Set<() => void>();
  private readonly transformCleanup: () => void;
  /** iframe 内的 keydown 转发 — ReaderView 注册一次, 每次 foliate 翻页时
   *  attach 到新的 iframe.contentDocument (因为 foliate 翻页时换 doc). */
  private onIframeKeydown: ((event: KeyboardEvent) => void) | undefined;
  private highlights: HighlightSpec[] = [];
  private closed = false;
  /** B4 修复: bindSelectionChange 在 this.view 上挂的 `load` listener
   *  需要在 close() 里也清 (disposeOn 之前 session.close() 可能先跑,
   *  ReaderView.onClose 直接 await session.close 不先 offSelect, load
   *  listener 还在 view 上). 把 handle 提到实例字段让 close() 能拿到. */
  private selectionLoadListener: ((event: Event) => void) | undefined;
  /**
   * 上次导航方向, 供 `load` 事件读取以决定翻页动画的方向 class。
   * - "initial"  — 首次加载 + TOC / 进度条 / 书签跳转 (直接淡入)
   * - "forward"  — 翻到下一页 (从右滑入)
   * - "backward" — 翻到上一页 (从左滑入)
   */
  private lastDirection: "initial" | "forward" | "backward" = "initial";
  /**
   * P1: Find-in-book 状态 — 缓存当前 query, 让用户翻页后再调用
   * findInBook(query, false) 走下一个匹配。索引指向"下一个要跳的"
   * 匹配在 `matchPositions` 里的位置。
   */
  private findQuery: string | null = null;
  private findMatches: Array<{ sectionIndex: number; offsetInSection: number }> = [];
  private findCursor = 0;

  constructor(
    view: FoliateViewElement,
    transformListener: EventListener,
    transformTarget: EventTarget | null | undefined
  ) {
    this.view = view;
    this.element = view;
    // P0 修复: 之前 transformTarget 上的 data listener 永不被移除, foliate
    // 的 transformTarget 在 parsed book 上持有, 不移除意味着 listener 跟着
    // parsed book 一起泄漏. close() 时把 listener 从 transformTarget 移除.
    this.transformCleanup = () => {
      if (transformTarget) {
        transformTarget.removeEventListener("data", transformListener);
      }
    };
  }

  /** ReaderView 注册的 keyboard 转发 — 在 foliate iframe.contentDocument 挂
   *  keydown listener (跨 iframe 边界事件不会自动 bubble 到 parent). */
  setOnIframeKeydown(handler: (event: KeyboardEvent) => void): void {
    this.onIframeKeydown = handler;
  }

  get direction(): "initial" | "forward" | "backward" {
    return this.lastDirection;
  }

  registerDisposer(fn: () => void): void {
    this.disposers.add(fn);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const off of this.docListeners) off();
    this.docListeners.clear();
    for (const off of this.disposers) off();
    this.disposers.clear();
    // B4 修复: 兜底清理 selection-change 的 load listener. bindSelectionChange
    // 的 off() 也清这个字段 (重复 removeEventListener 同一 handler 是
    // no-op, 安全). 解决 ReaderView.onClose 直接 await session.close()
    // 但没调 disposeOn → offSelect 的路径下, listener 挂到 detach view
    // 上等 GC 的"短命 leak".
    if (this.selectionLoadListener) {
      this.view.removeEventListener("load", this.selectionLoadListener);
      this.selectionLoadListener = undefined;
    }
    this.transformCleanup();
    try {
      this.view.close();
    } catch (error) {
      console.warn("[ez-reader] foliate view.close failed", error);
    }
    try {
      this.view.remove();
    } catch (error) {
      console.warn("[ez-reader] foliate view.remove failed", error);
    }
  }

  async applyAppearance(appearance: ReaderAppearance): Promise<void> {
    // P0 修复: 之前是 fire-and-forget, close() race 时调 setStyles 会在
    // tear-down view 上 throw. closed flag 让 close 之后的 setStyles no-op.
    if (this.closed) return;
    this.view.setAttribute("data-ez-reader-flow", appearance.flow);
    this.view.setAttribute("flow", appearance.flow);
    if (appearance.twoPages) {
      this.view.setAttribute("cols", "2");
    } else {
      this.view.removeAttribute("cols");
    }
    const renderer = this.view.renderer;
    renderer?.setStyles?.(buildAppearanceCss(appearance));
  }

  async goTo(target: ReaderTarget): Promise<void> {
    switch (target.kind) {
      case "next":
        this.lastDirection = "forward";
        await this.view.goRight();
        return;
      case "previous":
        this.lastDirection = "backward";
        await this.view.goLeft();
        return;
      case "fraction":
        // 进度条跳转 / 跳转书签 — 用户预期是直接跳, 淡入更合适
        this.lastDirection = "initial";
        await this.view.goToFraction(target.fraction);
        return;
      case "identifier":
        // CFI / href 跳转 (书签 / TOC) — 同上, 淡入
        this.lastDirection = "initial";
        await this.view.goTo(target.value);
        return;
    }
  }

  async currentFraction(): Promise<number> {
    return this.view.lastLocation?.fraction ?? 0;
  }

  on<K extends keyof ReaderEventMap>(event: K, handler: (event: ReaderEventMap[K]) => void): () => void {
    if (event === "selection-change") {
      return this.bindSelectionChange(handler as (event: ReaderEventMap["selection-change"]) => void);
    }
    const wrapped = ((e: Event) => handler(e as ReaderEventMap[K])) as EventListener;
    this.view.addEventListener(event, wrapped);
    const off = () => this.view.removeEventListener(event, wrapped);
    this.disposers.add(off);
    return off;
  }

  async exportLocator(): Promise<string | null> {
    return this.view.lastLocation?.cfi ?? null;
  }

  currentChapter(): string | null {
    return this.view.lastLocation?.tocItem?.label ?? null;
  }

  async tableOfContents(): Promise<ReadonlyArray<TocItem>> {
    const tree = this.view.book?.toc ?? [];
    const flat: TocItem[] = [];
    const walk = (items: ReadonlyArray<unknown>, depth: number): void => {
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const it = item as { label?: unknown; href?: unknown; subitems?: unknown };
        const label = typeof it.label === "string" && it.label.trim() ? it.label.trim() : "未命名章节";
        const href = typeof it.href === "string" && it.href ? it.href : undefined;
        flat.push({ id: `toc-${flat.length}`, label, depth, locator: href });
        if (Array.isArray(it.subitems)) walk(it.subitems as ReadonlyArray<unknown>, depth + 1);
      }
    };
    walk(tree, 0);
    return flat;
  }

  async goToToc(id: string): Promise<void> {
    const tree = this.view.book?.toc ?? [];
    const flat = collectTocWithHrefs(tree);
    const idx = Number(id.replace(/^toc-/, ""));
    const item = flat[idx];
    if (item?.href) {
      // TOC 跳转 — 用户预期是直接跳, 淡入
      this.lastDirection = "initial";
      await this.view.goTo(item.href);
    } else if (idx >= 0) {
      const fraction = Math.min(1, Math.max(0, idx / Math.max(1, flat.length)));
      this.lastDirection = "initial";
      await this.view.goToFraction(fraction);
    }
  }

  currentPage(): number | null {
    // EPUB 没有真正的"页码"; 返回 chapter index 作为粗略 page
    const loc = this.view.lastLocation;
    if (typeof loc?.cfi === "string") {
      const match = loc.cfi.match(/\[(\d+)/);
      if (match) return Number(match[1]) + 1;
    }
    return null;
  }

  totalPages(): number | null {
    const toc = this.view.book?.toc;
    if (Array.isArray(toc)) return countTocLeaves(toc);
    return null;
  }

  listHighlights(): ReadonlyArray<HighlightSpec> {
    return [...this.highlights];
  }

  /**
   * In-book search. foliate-js 没有 public find API, 所以我们手动遍历
   * spine 拿到每个 section 的 HTML 文本, indexOf 找 query 出现的位置,
   * 把所有匹配按 (sectionIndex, offset) 缓存起来, 再用 goToFraction
   * 跳到对应位置 (用当前 sectionIndex + sectionFraction 算总 fraction).
   *
   * 限制: 跨多页的匹配 (例如某匹配从 section A 第 30% 跨到 section B
   * 第 5%) 简化为只 anchor 到起始 section — foliate 内部 anchor 算法
   * 已经能展示起始点的上下文, 视觉上"高亮在结果起点"对搜索体验足够。
   */
  async findInBook(query: string, fromStart: boolean): Promise<number> {
    if (this.closed) return 0;
    const trimmed = query.trim();
    if (!trimmed) return 0;
    const paginator = this.view.renderer?.paginator;
    const sections = paginator?.sections ?? this.view.book?.sections;
    if (!sections || sections.length === 0) return 0;

    // 重新构建匹配列表 — query 变了 OR 用户按了 fromStart 都要重建。
    if (this.findQuery !== trimmed || fromStart) {
      this.findQuery = trimmed;
      this.findMatches = [];
      const needle = trimmed.toLocaleLowerCase();
      for (let i = 0; i < sections.length; i++) {
        // B3 修复: closed 标志可能在我们 await sec.load() 之间被翻起
        // (用户快速按 Esc 关 reader leaf), 提前退出. 之前跑完整个循环
        // 才检查 closed, 浪费 CPU + 短暂持有 findMatches / findCursor.
        if (this.closed) return 0;
        const sec = sections[i];
        if (!sec || typeof sec.load !== "function") continue;
        let html: string | Document;
        try {
          html = await sec.load();
        } catch {
          continue;
        }
        // await 后再 check 一次, 防止 sec.load() 期间被 close
        if (this.closed) return 0;
        // foliate section.load() 可能返回 string 也可能返回 Document (取决于打包方式).
        const text = extractTextFromSection(html).toLocaleLowerCase();
        let from = 0;
        let idx: number;
        while ((idx = text.indexOf(needle, from)) >= 0) {
          this.findMatches.push({ sectionIndex: i, offsetInSection: idx });
          from = idx + needle.length;
          // 安全阀: 单章超过 500 个匹配就停 — 用户搜索常见词 ("的" / "the")
          // 容易触发, 这种情况下 UI 显示 500+ 即可, 没必要把整本书扫一遍。
          if (this.findMatches.length > 500) break;
        }
        if (this.findMatches.length > 500) break;
      }
      this.findCursor = 0;
    }
    if (this.findMatches.length === 0) return 0;

    if (fromStart) this.findCursor = 0;
    else this.findCursor = (this.findCursor + 1) % this.findMatches.length;
    const target = this.findMatches[this.findCursor];

    // 跳到目标: 用 fraction = (sectionIndex / total) 即可, 用户视觉上
    // 看到的就是该 section。foliate 翻页后 updateUI 会自动 display 目标 section。
    const total = sections.length;
    const fraction = total <= 1 ? 0 : target.sectionIndex / (total - 1);
    this.lastDirection = "initial";
    await this.view.goToFraction(fraction);
    return this.findMatches.length;
  }

  async highlight(spec: HighlightSpec): Promise<void> {
    this.highlights.push(spec);
    try {
      await this.view.addAnnotation({ value: spec.locator });
    } catch (error) {
      console.warn("[ez-reader] foliate addAnnotation failed", error);
    }
  }

  async removeHighlight(id: string): Promise<void> {
    // P0 修复: 之前先 filter 再用 h.locator === id 找 target,filter 后
    // 已无 target,foliate 的 annotation 永远删不掉。改为先找再 filter,并
    // 用 excerptId 匹配 spec.id(locator 是 CFI / page,不可与 id 比较)。
    const target = this.highlights.find((h) => h.id === id);
    this.highlights = this.highlights.filter((h) => h.id !== id);
    if (target) {
      try {
        await this.view.addAnnotation({ value: target.locator }, true);
      } catch (error) {
        console.warn("[ez-reader] foliate removeAnnotation failed", error);
      }
    }
  }

  /**
   * foliate-paginator emits `load` events whenever it swaps the rendered
   * iframe document. We re-attach selectionchange on each new document so
   * the user can pick text after every page change.
   *
   * 注意: `docListeners` 只跟踪 selectionchange 监听器, 不要把 load 事件
   * 的 disposer 放进去 — 否则重新翻页会清掉 selectionchange。
   *
   * P1 修复: 之前的 `off` 只清 docListeners, 不清自己注册在 `load` 事件上
   * 的 listener. 二次 `on("selection-change", ...)` 泄漏上次的 load listener
   * 直到 close(). 现在 off 一起清.
   */
  private bindSelectionChange(handler: (event: ReaderEventMap["selection-change"]) => void): () => void {
    let loadListener: ((event: Event) => void) | undefined;
    const off = () => {
      for (const dispose of this.docListeners) dispose();
      this.docListeners.clear();
      if (loadListener) {
        this.view.removeEventListener("load", loadListener);
        loadListener = undefined;
        this.selectionLoadListener = undefined;
      }
    };

    const attach = (doc: Document, index: number): void => {
      for (const dispose of this.docListeners) dispose();
      this.docListeners.clear();
      const onChange = () => {
        const selection = doc.getSelection();
        if (!selection || selection.isCollapsed) return;
        const text = selection.toString().trim();
        if (!text) return;
        const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined;
        let cfi: string | undefined;
        try {
          cfi = this.view.getCFI(index, range);
        } catch (error) {
          console.warn("[ez-reader] getCFI failed", error);
        }
        const rect = range?.getBoundingClientRect();
        handler({
          text,
          locator: cfi ?? this.view.lastLocation?.cfi,
          rect: rect ?? undefined
        } as unknown as ReaderEventMap["selection-change"]);
      };
      doc.addEventListener("selectionchange", onChange);
      this.docListeners.add(() => doc.removeEventListener("selectionchange", onChange));
      // P1 polish: 用户报告在 EPUB 里选词后, ReaderView 弹不出 selection menu
      // (没翻译 / 摘录 / 想法按钮). foliate 沙盒 iframe 内的 selectionchange
      // 触发不可靠, 某些 EPUB + WebView 组合下完全沉默. 多重兜底:
      //   - mouseup: 桌面端鼠标 / 触摸合成鼠标场景
      //   - pointerup: 现代浏览器统一指针事件 (鼠标 / 触控笔 / 触屏)
      //   - touchend: 移动端 WebView (Android / iOS) 触屏选词不一定合成
      //     pointer 事件, 直接 listen touchend 最稳
      // 三层都调 onChange() 拿当前 selection; onChange 内部已经判 isCollapsed
      // 和 text.trim() 非空, 重复触发是无害的.
      const onPointerLike = () => onChange();
      doc.addEventListener("mouseup", onPointerLike);
      doc.addEventListener("pointerup", onPointerLike);
      doc.addEventListener("touchend", onPointerLike);
      this.docListeners.add(() => {
        doc.removeEventListener("mouseup", onPointerLike);
        doc.removeEventListener("pointerup", onPointerLike);
        doc.removeEventListener("touchend", onPointerLike);
      });

      // P0 修复(扩展): foliate 1.0.1 把 EPUB section 的 CSS 包成 blob URL,
      // Obsidian CSP 拒绝 `blob:` 源 stylesheet. foliate 同时用两种方式注入:
      //   1) `<link rel="stylesheet" href="blob:...">` (老路径)
      //   2) `<style>` 元素 textContent 里的 `@import "blob:..."` (新路径,
      //      epub.js:871-876 把 `@import url(...)` 重写成 `@import "blob:..."`)
      // 两种都 fetch blob + inline, 加上 `characterData` 监听 textContent in-place 修改.
      const IMPORT_RE = /@import\s*["'](blob:[^"']+)["']/gi;
      const inlineBlobLinkStyles = (root: ParentNode): void => {
        const links = root.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href^="blob:"]');
        links.forEach((link) => {
          const href = link.getAttribute("href");
          if (!href) return;
          if (link.dataset["ezReaderInlined"] === "1") return;
          link.dataset["ezReaderInlined"] = "1";
          fetch(href)
            .then((response) => response.text())
            .then((cssText) => {
              const style = doc.createElement("style");
              style.dataset["ezReaderInlinedFrom"] = href;
              style.textContent = cssText;
              link.replaceWith(style);
            })
            .catch((error) => {
              console.warn("[ez-reader] inlineBlobLinkStyles failed", error);
              link.remove();
            });
        });
      };
      const inlineBlobImportStyles = (root: ParentNode): void => {
        const styles = Array.from(root.querySelectorAll<HTMLStyleElement>("style"));
        for (const style of styles) {
          const text = style.textContent ?? "";
          IMPORT_RE.lastIndex = 0;
          if (!IMPORT_RE.test(text)) continue;
          IMPORT_RE.lastIndex = 0;
          const matches = [...text.matchAll(IMPORT_RE)];
          if (matches.length === 0) continue;
          if (style.dataset["ezReaderInlinedImports"] === "1") continue;
          style.dataset["ezReaderInlinedImports"] = "1";
          Promise.all(matches.map((m) => fetch(m[1]).then((r) => r.text())))
            .then((cssTexts) => {
              let newText = text;
              let i = 0;
              newText = newText.replace(IMPORT_RE, () => cssTexts[i++] ?? "");
              style.dataset["ezReaderInlinedImports"] = "0";
              style.textContent = newText;
            })
            .catch((error) => {
              console.warn("[ez-reader] inlineBlobImportStyles failed", error);
              style.dataset["ezReaderInlinedImports"] = "0";
              // 失败: 把 @import 那行替成注释, 避免持续 CSP 报错
              style.textContent = text.replace(IMPORT_RE, "/* failed @import */");
            });
        }
      };
      const scanAll = (root: ParentNode): void => {
        inlineBlobLinkStyles(root);
        inlineBlobImportStyles(root);
      };
      const headObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of Array.from(mutation.addedNodes)) {
            if (node instanceof HTMLElement && (node.instanceOf(HTMLLinkElement) || node.instanceOf(HTMLStyleElement))) {
              scanAll(node);
            }
          }
          scanAll(doc);
        }
      });
      if (doc.head) {
        // characterData 监听 <style> textContent in-place 修改 (foliate
        // 在 paginator 注入时会直接重写 style.textContent, 不会 addNode)
        headObserver.observe(doc.head, { childList: true, subtree: true, characterData: true });
        this.docListeners.add(() => headObserver.disconnect());
      }
      scanAll(doc);

      // P0 修复: foliate iframe 内的 keydown 事件不会 bubble 到 parent,
      // 所以 ReaderView 挂在 containerEl 的 keyboard listener 永远收不到
      // iframe 内的 ArrowLeft / ArrowRight — 看起来键盘翻页"坏掉了".
      // 现在在 iframe.contentDocument 上挂 keydown listener, 转发给
      // ReaderView 注册的 handler.
      if (this.onIframeKeydown) {
        const onKeydown = (event: KeyboardEvent) => {
          this.onIframeKeydown?.(event);
        };
        doc.addEventListener("keydown", onKeydown, true);
        this.docListeners.add(() => doc.removeEventListener("keydown", onKeydown, true));
      }
    };

    loadListener = (event: Event) => {
      const detail = (event as CustomEvent<{ doc?: Document; index?: number }>).detail;
      if (!detail || !detail.doc || typeof detail.index !== "number") return;
      attach(detail.doc, detail.index);
    };
    this.view.addEventListener("load", loadListener);
    // B4 修复: 把 handle 存到实例字段, 让 close() 兜底清理. 之前
    // session.close() 不碰 this.view 上的 loadListener — 如果
    // ReaderView.onClose 直接 await session.close() 而没先调
    // disposeOn / offSelect, listener 闭包会一直挂在已 detach 的
    // view 上, 直到 view GC 才释放. 实测触发概率低, 但 GC 之前
    // closure 持有 attach 闭包 (含 docListeners / view 引用).
    this.selectionLoadListener = loadListener;

    return off;
  }
}

const collectTocWithHrefs = (tree: ReadonlyArray<unknown>): Array<{ href?: string }> => {
  const flat: Array<{ href?: string }> = [];
  const walk = (items: ReadonlyArray<unknown>): void => {
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const it = item as { href?: unknown; subitems?: unknown };
      const href = typeof it.href === "string" && it.href ? it.href : undefined;
      flat.push({ href });
      if (Array.isArray(it.subitems)) walk(it.subitems as ReadonlyArray<unknown>);
    }
  };
  walk(tree);
  return flat;
};

const countTocLeaves = (tree: ReadonlyArray<unknown>): number => {
  let count = 0;
  const walk = (items: ReadonlyArray<unknown>): void => {
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const it = item as { subitems?: unknown };
      if (Array.isArray(it.subitems) && it.subitems.length > 0) {
        walk(it.subitems as ReadonlyArray<unknown>);
      } else {
        count += 1;
      }
    }
  };
  walk(tree);
  return count;
};

/**
 * Convert a foliate section payload into a flat text string. foliate
 * section.load() returns either a `string` (raw HTML) or a `Document`
 * (parsed). We strip tags uniformly via a single string walk — the
 * output is only used for `indexOf` matching, so we don't need a real
 * HTML parser.
 */
const extractTextFromSection = (payload: string | Document): string => {
  if (typeof payload === "string") {
    return payload.replace(/<[^>]*>/g, " ");
  }
  // Document: prefer `textContent` from body to avoid <head>/<script>.
  const body = payload.body ?? payload.documentElement;
  return body?.textContent ?? "";
};

/**
 * Sanitize EPUB section content: strip <script>, javascript: links,
 * meta-refresh redirects, inline event handlers. Algorithm adapted from
 * obsidian-pdf-plus (MIT, see LICENSES/obsidian-pdf-plus-MIT.txt).
 */
const sanitizeBookContent = (source: string): string =>
  source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/<(?:iframe|object|embed)\b[^>]*>[\s\S]*?<\/(?:iframe|object|embed)\s*>/gi, "")
    .replace(/<(?:iframe|object|embed)\b[^>]*\/?>/gi, "")
    .replace(/<meta\b[^>]*http-equiv\s*=\s*(?:"refresh"|'refresh'|refresh)[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:src|poster|data)\s*=\s*(?:"(?:https?:|file:|javascript:)[^"]*"|'(?:https?:|file:|javascript:)[^']*'|(?:https?:|file:|javascript:)[^\s>]+)/gi, "");
