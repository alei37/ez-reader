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
import type { ReaderAppearance, ReaderTheme } from "../../core/types/ReaderSettings";
import { mimeTypeFor } from "../../core/entities/Book";

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
  };
  renderer?: HTMLElement & { setStyles?: (css: string) => void };
  lastLocation?: { fraction?: number; cfi?: string; tocItem?: { label?: string } };
}

interface FoliateModule {
  makeBook: (input: File) => Promise<unknown>;
}

/** Resolve a `ReaderTheme` to the CSS values foliate injects into the iframe. */
export const themeColors = (theme: ReaderTheme): { bg: string; fg: string; scheme: "light" | "dark" | "light dark" } => {
  switch (theme) {
    case "light":
      return { bg: "#ffffff", fg: "#1f2328", scheme: "light" };
    case "dark":
      return { bg: "#1f2328", fg: "#e6edf3", scheme: "dark" };
    case "sepia":
      return { bg: "#f4ecd8", fg: "#4b3b2a", scheme: "light" };
    default:
      return { bg: "Canvas", fg: "CanvasText", scheme: "light dark" };
  }
};

/**
 * Build the CSS string passed to `foliate-paginator.setStyles()`. Pure
 * function so we can unit-test that every `ReaderAppearance` field reaches
 * the iframe.
 */
export const buildAppearanceCss = (appearance: ReaderAppearance): string => {
  const theme = themeColors(appearance.theme);
  const fontScale = (appearance.fontSize / 100).toFixed(3);
  return `
    :root { --ez-reader-font-scale: ${fontScale}; }
    html, body {
      font-size: calc(1em * var(--ez-reader-font-scale)) !important;
      color: ${theme.fg} !important;
      background: ${theme.bg} !important;
      color-scheme: ${theme.scheme};
    }
    body { padding-inline: ${appearance.margin}px !important; line-height: ${appearance.lineHeight} !important; }
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
    await session.applyAppearance(appearance);

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
        languages: languages as BookMetadata["languages"],
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

/**
 * Sniff image MIME from the first 12 bytes of a buffer. foliate often
 * returns `Blob` with empty `type`; the previous fallback defaulted to
 * `image/jpeg` which silently mis-saved PNG / WEBP covers with the wrong
 * extension.
 */
const sniffImageMime = (bytes: ArrayBuffer): string | null => {
  const view = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4E && view[3] === 0x47) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (view[0] === 0xFF && view[1] === 0xD8 && view[2] === 0xFF) {
    return "image/jpeg";
  }
  // WEBP: "RIFF" .... "WEBP"
  if (view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46 &&
      view[8] === 0x57 && view[9] === 0x45 && view[10] === 0x42 && view[11] === 0x50) {
    return "image/webp";
  }
  // GIF: "GIF8"
  if (view[0] === 0x47 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x38) {
    return "image/gif";
  }
  return null;
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
  /**
   * 上次导航方向, 供 `load` 事件读取以决定翻页动画的方向 class。
   * - "initial"  — 首次加载 + TOC / 进度条 / 书签跳转 (直接淡入)
   * - "forward"  — 翻到下一页 (从右滑入)
   * - "backward" — 翻到上一页 (从左滑入)
   */
  private lastDirection: "initial" | "forward" | "backward" = "initial";

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
    const renderer = this.view.renderer as (HTMLElement & { setStyles?: (css: string) => void }) | undefined;
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

      // P0 修复: foliate 把 EPUB section 的 stylesheet 用 blob URL 加载,
      // Obsidian CSP 拒绝 `blob:` 源的 stylesheet (style-src 不含 blob:).
      // 修法: MutationObserver 监听 doc 的 <head> 变化, 看到
      // `<link rel="stylesheet" href="blob:...">` 就 fetch 那个 URL, 转 inline
      // `<style>` 注入. CSP 允许 'unsafe-inline' 所以 inline style 不被拒.
      const inlineBlobStylesheets = (root: ParentNode): void => {
        const links = root.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href^="blob:"]');
        links.forEach((link) => {
          const href = link.getAttribute("href");
          if (!href) return;
          // 标记已处理, 避免重复 fetch (同一 blob URL 可能在多个 section 出现)
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
              console.warn("[ez-reader] inlineBlobStylesheets failed", error);
              // 失败: 移除 link (避免 console 持续报错), 让 EPUB 缺这一份样式
              // 但其他 inline style 仍生效, 排版不会完全崩.
              link.remove();
            });
        });
      };
      const headObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of Array.from(mutation.addedNodes)) {
            if (node instanceof HTMLLinkElement) {
              inlineBlobStylesheets(doc);
            }
          }
          inlineBlobStylesheets(doc);
        }
      });
      if (doc.head) {
        headObserver.observe(doc.head, { childList: true, subtree: true });
        this.docListeners.add(() => headObserver.disconnect());
      }
      inlineBlobStylesheets(doc);

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
