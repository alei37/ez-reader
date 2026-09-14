import type { Book } from "../../core/entities/Book";
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
    toc?: ReadonlyArray<{ label: string; href?: string; subitems?: ReadonlyArray<unknown> }>;
    metadata?: { title?: string; creator?: string | string[]; language?: string | string[] };
    getCover?: () => Promise<Blob | null>;
  };
  renderer?: HTMLElement & { setStyles?: (css: string) => void };
  lastLocation?: { fraction?: number; cfi?: string; tocItem?: { label?: string } };
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
  getRootNode(): ShadowRoot | Document;
}

interface FoliateModule {
  makeBook: (input: File) => Promise<unknown>;
}

const themeColors = (theme: ReaderTheme): { bg: string; fg: string; scheme: "light" | "dark" | "light dark" } => {
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
 * Adapter that wraps foliate-js and exposes it through the `BookReader`
 * port. Each `open()` constructs a fresh `<foliate-view>` element; the host
 * is responsible for attaching it to the DOM.
 *
 * Selection is detected on the iframe document that foliate-paginator
 * embeds inside its shadow root. We walk through the shadow boundary to
 * reach the live `contentDocument` and listen for `selectionchange`.
 */
export class FoliateBookReader implements BookReader {
  async open(
    book: Book,
    host: HTMLElement,
    appearance: ReaderAppearance,
    loader: BookBytesLoader
  ): Promise<ReaderSession> {
    const [{ makeBook }] = await Promise.all([import("foliate-js/view.js") as unknown as Promise<FoliateModule>]);

    const bytes = await loader(book.locator.path);
    const file = new File([bytes], book.locator.path.split("/").pop() ?? "book", {
      type: mimeTypeFor(book.locator.format)
    });
    const parsed = await makeBook(file);

    // Content-safety hook: EPUB sections can contain <script>, javascript:
    // links, and meta-refresh redirects that abuse the iframe. foliate
    // streams raw HTML through `transformTarget` as 'text/html' or
    // 'text/xhtml' events; we intercept and sanitize before foliate's
    // paginator gets a chance to inject it. (Algorithm borrowed from
    // obsidian-pdf-plus; license: MIT, see LICENSES/.)
    const transformTarget = (parsed as { transformTarget?: EventTarget | null }).transformTarget;
    if (transformTarget) {
      transformTarget.addEventListener("data", ((event: Event) => {
        const detail = (event as CustomEvent<{ data?: unknown; type?: string }>).detail;
        if (!detail) return;
        if (!/text\/(x?html)/i.test(detail.type ?? "")) return;
        detail.data = Promise.resolve(detail.data).then(async (data) => {
          const source = data instanceof Blob ? await data.text() : String(data);
          return sanitizeBookContent(source);
        });
      }) as EventListener);
    }

    const view = document.createElement("foliate-view") as FoliateViewElement;
    view.setAttribute("data-ez-reader-flow", appearance.flow);
    host.append(view);
    try {
      await view.open(parsed);
    } catch (error) {
      // view.open 失败: 清掉 host 上的空 view (transformTarget listener 跟着 GC)
      view.remove();
      throw error;
    }

    const session = new FoliateSession(view, appearance);
    // Apply appearance now (the paginator may already be showing content)
    // and re-apply on every `load` event since foliate swaps iframe docs
    // on each page change.
    await session.applyAppearance(appearance);
    const onLoad = () => {
      void session.applyAppearance(appearance);
    };
    view.addEventListener("load", onLoad);
    session.registerDisposer(() => view.removeEventListener("load", onLoad));
    return session;
  }

  async extractCover(book: Book, loader: BookBytesLoader): Promise<ExtractedCover | null> {
    const [{ makeBook }] = await Promise.all([import("foliate-js/view.js") as unknown as Promise<FoliateModule>]);
    const bytes = await loader(book.locator.path);
    const file = new File([bytes], book.locator.path.split("/").pop() ?? "book", {
      type: mimeTypeFor(book.locator.format)
    });
    const parsed = await makeBook(file);
    const bookObj = parsed as { getCover?: () => Promise<Blob | null> };
    if (typeof bookObj.getCover !== "function") return null;
    const blob = await bookObj.getCover();
    if (!blob) return null;
    const coverBytes = await blob.arrayBuffer();
    return { bytes: coverBytes, mimeType: blob.type || "image/jpeg" };
  }
}

class FoliateSession implements ReaderSession {
  readonly element: HTMLElement;
  private readonly view: FoliateViewElement;
  private readonly docListeners = new Set<() => void>();
  private readonly disposers = new Set<() => void>();
  private currentAppearance: ReaderAppearance;
  private highlights: HighlightSpec[] = [];

  constructor(view: FoliateViewElement, appearance: ReaderAppearance) {
    this.view = view;
    this.element = view;
    this.currentAppearance = appearance;
  }

  registerDisposer(fn: () => void): void {
    this.disposers.add(fn);
  }

  async close(): Promise<void> {
    for (const off of this.docListeners) off();
    this.docListeners.clear();
    for (const off of this.disposers) off();
    this.disposers.clear();
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
    // foliate's `<foliate-view>` exposes `renderer.setStyles(css)` — the
    // only official channel to push appearance into the iframe document.
    // setAttribute on the view itself is ignored for font-size / line-height
    // / margin (those aren't in the observedAttributes list of paginator).
    // We use both: setStyles for the iframe content, setAttribute for
    // paginator-level options (flow, columns).
    this.currentAppearance = appearance;
    this.view.setAttribute("data-ez-reader-flow", appearance.flow);
    this.view.setAttribute("flow", appearance.flow);
    // 双页模式: foliate 自带 cols 属性
    if (appearance.twoPages) {
      this.view.setAttribute("cols", "2");
    } else {
      this.view.removeAttribute("cols");
    }

    const theme = themeColors(appearance.theme);
    const renderer = this.view.renderer as (HTMLElement & { setStyles?: (css: string) => void }) | undefined;
    if (renderer?.setStyles) {
      const fontScale = (appearance.fontSize / 100).toFixed(3);
      const css = `
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
      renderer.setStyles(css);
    }
  }

  async goTo(target: ReaderTarget): Promise<void> {
    switch (target.kind) {
      case "next":
        await this.view.goRight();
        return;
      case "previous":
        await this.view.goLeft();
        return;
      case "fraction":
        await this.view.goToFraction(target.fraction);
        return;
      case "identifier":
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
    return () => this.view.removeEventListener(event, wrapped);
  }

  async exportLocator(): Promise<string | null> {
    return this.view.lastLocation?.cfi ?? null;
  }

  /** Reachable from the UI for the bookmark/excerpt flows. */
  resolveCFI(index: number, range: Range | undefined): string {
    return this.view.getCFI(index, range);
  }

  /** Annotation support (for the excerpt highlight). */
  async addAnnotation(cfi: string): Promise<void> {
    await this.view.addAnnotation({ value: cfi });
  }

  async removeAnnotation(cfi: string): Promise<void> {
    await this.view.addAnnotation({ value: cfi }, true);
  }

  clearSelection(): void {
    this.view.deselect();
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
      await this.view.goTo(item.href);
    } else if (idx >= 0) {
      // 没有 href 的章节: 按 index 估算 fraction
      const fraction = Math.min(1, Math.max(0, idx / Math.max(1, flat.length)));
      await this.view.goToFraction(fraction);
    }
  }

  currentPage(): number | null {
    // EPUB 没有真正的"页码"; 我们返回 chapter index 作为粗略 page
    const loc = this.view.lastLocation;
    if (typeof loc?.cfi === "string") {
      // 解析 CFI 中的第一个数字(章节 index)
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
    // 通过 foliate 自带 annotation API 真正绘制
    try {
      await this.view.addAnnotation({ value: spec.locator });
    } catch (error) {
      console.warn("[ez-reader] foliate addAnnotation failed", error);
    }
  }

  async removeHighlight(id: string): Promise<void> {
    this.highlights = this.highlights.filter((h) => h.id !== id);
    const target = this.highlights.find((h) => h.locator === id);
    if (target) {
      try {
        await this.view.addAnnotation({ value: target.locator }, true);
      } catch {
        // ignore
      }
    }
  }

  async next(): Promise<void> {
    await this.view.goRight();
  }

  async previous(): Promise<void> {
    await this.view.goLeft();
  }

  /** Book metadata resolved after `view.open()`. */
  describe(): {
    title?: string;
    authors?: string[];
    languages?: string[];
    toc?: ReadonlyArray<{ label: string; href?: string; subitems?: ReadonlyArray<unknown> }>;
    chapter?: string;
  } {
    const meta = this.view.book?.metadata;
    return {
      title: meta?.title,
      authors: meta?.creator ? (Array.isArray(meta.creator) ? meta.creator : [meta.creator]) : undefined,
      languages: meta?.language ? (Array.isArray(meta.language) ? meta.language : [meta.language]) : undefined,
      toc: this.view.book?.toc,
      chapter: this.view.lastLocation?.tocItem?.label
    };
  }

  /**
   * foliate-paginator emits `load` events whenever it swaps the rendered
   * iframe document. Each event carries `{ doc, index }` — `doc` is the
   * iframe contentDocument and `index` is the section index. We use both
   * to compute a precise CFI from any user selection.
   */
  private bindSelectionChange(handler: (event: ReaderEventMap["selection-change"]) => void): () => void {
    const off = () => {
      for (const dispose of this.docListeners) dispose();
      this.docListeners.clear();
    };

    const attach = (doc: Document, index: number): void => {
      // Same doc already attached? Skip.
      if (this.docListeners.size > 0) {
        // We don't track doc identity directly; this is a best-effort dedupe.
        return;
      }
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
    };

    const onLoad = (event: Event) => {
      const detail = (event as CustomEvent<{ doc?: Document; index?: number }>).detail;
      if (!detail || !detail.doc || typeof detail.index !== "number") return;
      // 清旧 listener,绑新的
      for (const dispose of this.docListeners) dispose();
      this.docListeners.clear();
      attach(detail.doc, detail.index);
    };
    this.view.addEventListener("load", onLoad);
    this.docListeners.add(() => this.view.removeEventListener("load", onLoad));

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
 * Content safety: EPUB sections can include `<script>` tags, JS
 * `href` URLs, `<meta http-equiv="refresh">` redirects, and other
 * payloads that abuse the renderer. foliate streams the section's
 * raw HTML through `transformTarget` so we sanitize it before the
 * paginator's CSS pass.
 *
 * Algorithm adapted from obsidian-pdf-plus (MIT license, see
 * LICENSES/obsidian-pdf-plus-MIT.txt).
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
