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
import type { ReaderAppearance } from "../../core/types/ReaderSettings";
import { parsePDFSubpath, selectionToSubpath } from "../../core/pdf/subpath";

// `text` loader emits the worker source as a string. We then wrap it in a
// Blob URL so PDF.js can spin up a real Worker.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — inline worker text provided by esbuild plugin
import workerSource from "pdfjs-dist/legacy/build/pdf.worker.min.mjs";

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy?: () => Promise<void>;
}

interface PdfPage {
  getViewport(options: { scale: number; rotation?: number }): PdfViewport;
  render(options: { canvasContext: CanvasRenderingContext2D; canvas: HTMLCanvasElement; viewport: PdfViewport }): { promise: Promise<void> };
  getTextContent(): Promise<{ items: ReadonlyArray<{ str: string }> }>;
  pageNumber: number;
}

interface PdfViewport {
  width: number;
  height: number;
  scale: number;
  transform: number[];
}

interface PdfjsModule {
  GlobalWorkerOptions: { workerSrc: string | null };
  getDocument: (config: { data?: ArrayBuffer | Uint8Array; url?: string; cMapUrl?: string; disableAutoFetch?: boolean }) => { promise: Promise<PdfDocument> };
  version: string;
}

interface PdfPageRender {
  pageNumber: number;
  wrapper: HTMLElement;
  canvas: HTMLCanvasElement;
  textLayer: HTMLElement;
  textLayerContent: Array<{ text: string }>;
  /** Native display dimensions (scale 1.0). */
  nativeWidth: number;
  nativeHeight: number;
}

interface PdfPendingHighlight {
  beginIndex: number;
  beginOffset: number;
  endIndex: number;
  endOffset: number;
}

let workerConfigured = false;
const configureWorker = (pdfjs: PdfjsModule): void => {
  if (workerConfigured) return;
  const blob = new Blob([workerSource], { type: "text/javascript" });
  pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
  workerConfigured = true;
};

export class PdfjsBookReader implements BookReader {
  // Cache of book path → parsed PdfDocument. Lets `extractCover` reuse
  // the document that `open` already loaded instead of re-parsing the
  // same PDF twice (which doubles the cost on first book open).
  private readonly docCache = new Map<string, PdfDocument>();

  async open(
    book: Book,
    host: HTMLElement,
    appearance: ReaderAppearance,
    loader: BookBytesLoader
  ): Promise<ReaderSession> {
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs" as string)) as unknown as PdfjsModule;
    configureWorker(pdfjs);

    const bytes = new Uint8Array(await loader(book.locator.path));
    const loadingTask = pdfjs.getDocument({ data: bytes });
    let document: PdfDocument;
    try {
      document = await loadingTask.promise;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ez-reader] PDF document load failed", { path: book.locator.path, message, error });
      throw new Error(`PDF 解析失败: ${message}`);
    }
    console.info(`[ez-reader] PDF opened: ${book.locator.path} (${document.numPages} pages)`);

    // 缓存 doc 给 extractCover 复用 — 避免同一本书被 getDocument 两次
    this.docCache.set(book.locator.path, document);

    const session = new PdfjsSession(document, host, appearance);
    // session.close 时清掉 cache, 否则切书后旧 doc 引用泄漏
    const originalClose = session.close.bind(session);
    session.close = async () => {
      this.docCache.delete(book.locator.path);
      return originalClose();
    };
    // 等一帧再渲染: host 刚被 append 到 DOM, 浏览器还没完成 layout pass,
    // host.clientWidth 可能是 0 导致首帧 canvas 塌成 1×1(看起来"空白")。
    if (host.clientWidth < 100) {
      await new Promise<void>((resolve) => globalThis.requestAnimationFrame(() => resolve()));
    }
    // 上下滚动模式: 一次渲染所有页面到滚动容器, 不再 gotoPage(1)
    await session.renderAllPages();
    return session;
  }

  /**
   * Render the first page to a small canvas and snapshot it as a PNG.
   * Keeps the dimensions modest (480 wide max) so a shelf full of covers
   * doesn't bloat the plugin data directory.
   */
  async extractCover(book: Book, loader: BookBytesLoader): Promise<ExtractedCover | null> {
    let document = this.docCache.get(book.locator.path);
    if (!document) {
      const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs" as string)) as unknown as PdfjsModule;
      configureWorker(pdfjs);
      const bytes = new Uint8Array(await loader(book.locator.path));
      try {
        document = await pdfjs.getDocument({ data: bytes }).promise;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[ez-reader] PDF cover: load failed for ${book.locator.path}`, message);
        return null;
      }
      this.docCache.set(book.locator.path, document);
    }
    try {
      const page = await document.getPage(1);
      const baseViewport = page.getViewport({ scale: 1 });
      const maxWidth = 480;
      const scale = Math.min(1.5, maxWidth / baseViewport.width);
      const viewport = page.getViewport({ scale });
      const canvas = globalThis.document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const host = globalThis.document.body ?? globalThis.document.documentElement;
      const previousDisplay = canvas.style.display;
      canvas.style.display = "none";
      host.appendChild(canvas);
      try {
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, viewport.width, viewport.height);
        await page.render({ canvasContext: ctx, canvas, viewport }).promise;
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((result) => resolve(result), "image/png");
        });
        if (!blob) {
          console.warn(`[ez-reader] PDF cover: toBlob returned null for ${book.locator.path}`);
          return null;
        }
        const arrayBuffer = await blob.arrayBuffer();
        console.info(`[ez-reader] PDF cover extracted: ${book.locator.path} (${arrayBuffer.byteLength} bytes)`);
        return { bytes: arrayBuffer, mimeType: "image/png" };
      } finally {
        canvas.style.display = previousDisplay;
        canvas.remove();
      }
    } catch (error) {
      console.warn(`[ez-reader] PDF cover extraction failed for ${book.locator.path}`, error);
      return null;
    } finally {
      try {
        await document.destroy?.();
      } catch {
        // ignore double-destroy
      }
    }
  }
}

/**
 * Continuous-scroll PDF reader. Every page renders into its own
 * `<canvas>` + text-layer inside the host, stacked vertically. The user
 * scrolls naturally; `next` / `previous` jump to the next / previous
 * page boundary; `goTo({ kind: "fraction" })` maps to a scroll offset.
 *
 * Pages render at native 1.0 scale — "原本是什么样子就是什么样子".
 * User-controlled `setScale` applies a CSS transform on top, so we never
 * re-render at a different rasterization.
 */
class PdfjsSession implements ReaderSession {
  readonly element: HTMLElement;
  private readonly doc: PdfDocument;
  private readonly host: HTMLElement;
  private readonly appearance: ReaderAppearance;
  private readonly pages: PdfPageRender[] = [];
  private currentPageNumber = 1;
  /** User-controlled zoom multiplier on top of native 1.0 scale. */
  private zoom = 1.0;
  private textLayerHandlers: Array<() => void> = [];
  private highlights: HighlightSpec[] = [];
  private currentChapterText: string | null = null;
  private readonly pendingHighlights: Map<number, PdfPendingHighlight[]> = new Map();
  private relocateHandlers: Array<(detail: { fraction: number; locator?: string; page?: number }) => void> = [];
  private relocateRafQueued = false;

  constructor(doc: PdfDocument, host: HTMLElement, appearance: ReaderAppearance) {
    this.doc = doc;
    this.host = host;
    this.appearance = appearance;
    host.empty();
    // host 自己就是滚动容器 + flex 容器 (styles.css 里 ez-reader__pdf-scroll-host
    // 同时有 overflow:auto 和 display:flex flex-direction:column align-items:center),
    // 这样 PDF 自然居中堆叠, 不会因为 inner container 撑爆 host 导致 PDF
    // 视觉上贴到左边缘。
    host.addClass("ez-reader__pdf-scroll-host");
    this.element = host;
    host.addEventListener("scroll", this.handleScroll);
  }

  private handleScroll = (): void => {
    // 节流: requestAnimationFrame 合并多次 scroll 事件, 每帧最多 emit 一次
    if (this.relocateRafQueued) return;
    this.relocateRafQueued = true;
    globalThis.requestAnimationFrame(() => {
      this.relocateRafQueued = false;
      const fraction = this.computeFraction();
      const page = this.currentPage();
      this.currentPageNumber = page;
      const detail = { fraction, locator: `page=${page}`, page };
      for (const h of this.relocateHandlers) h(detail);
    });
  };

  async close(): Promise<void> {
    for (const off of this.textLayerHandlers) off();
    this.textLayerHandlers = [];
    this.host.removeEventListener("scroll", this.handleScroll);
    this.relocateHandlers = [];
    try {
      await this.doc.destroy?.();
    } catch (error) {
      console.warn("[ez-reader] pdf destroy failed", error);
    }
    this.host.empty();
  }

  private computeFraction(): number {
    const max = this.host.scrollHeight - this.host.clientHeight;
    if (max <= 0) return 0;
    return Math.max(0, Math.min(1, this.host.scrollTop / max));
  }

  currentPage(): number {
    const viewportTop = this.host.scrollTop;
    let bestPage = 1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const p of this.pages) {
      const top = p.wrapper.offsetTop;
      const distance = Math.abs(top - viewportTop);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPage = p.pageNumber;
      }
    }
    return bestPage;
  }

  totalPages(): number {
    return this.doc.numPages;
  }

  async tableOfContents(): Promise<ReadonlyArray<TocItem>> {
    try {
      const outline = await (this.doc as unknown as { getOutline?: () => Promise<unknown> }).getOutline?.();
      if (!outline) return [];
      const flat: TocItem[] = [];
      const walk = (items: unknown[], depth: number): void => {
        if (!Array.isArray(items)) return;
        for (const item of items) {
          if (!item || typeof item !== "object") continue;
          const it = item as { title?: string; dest?: unknown; items?: unknown[] };
          if (it.title) {
            flat.push({ id: `toc-${flat.length}`, label: it.title, depth });
          }
          if (Array.isArray(it.items)) walk(it.items, depth + 1);
        }
      };
      walk(outline as unknown[], 0);
      return flat;
    } catch (error) {
      console.warn("[ez-reader] PDF outline read failed", error);
      return [];
    }
  }

  async goToToc(id: string): Promise<void> {
    const index = Number(id.replace(/^toc-/, ""));
    if (Number.isNaN(index)) return;
    const page = Math.min(this.doc.numPages, Math.max(1, Math.floor((index + 1) * this.doc.numPages / 50)));
    this.scrollToPage(page);
  }

  currentChapter(): string | null {
    return this.currentChapterText;
  }

  async highlight(_selection: HighlightSpec): Promise<void> {
    // Full highlight rendering happens when gotoPage applies a subpath.
    this.highlights.push(_selection);
  }

  async removeHighlight(id: string): Promise<void> {
    this.highlights = this.highlights.filter((h) => h.id !== id);
  }

  listHighlights(): ReadonlyArray<HighlightSpec> {
    return this.highlights;
  }

  async next(): Promise<void> {
    this.scrollToPage(this.currentPage() + 1);
  }

  async previous(): Promise<void> {
    this.scrollToPage(this.currentPage() - 1);
  }

  async applyAppearance(appearance: ReaderAppearance): Promise<void> {
    Object.assign(this.appearance, appearance);
    // canvas 不随 appearance 变; 这里什么都不用做
  }

  async goTo(target: ReaderTarget): Promise<void> {
    switch (target.kind) {
      case "next":
        this.scrollToPage(this.currentPage() + 1);
        return;
      case "previous":
        this.scrollToPage(this.currentPage() - 1);
        return;
      case "fraction": {
        const max = this.host.scrollHeight - this.host.clientHeight;
        if (max > 0) this.host.scrollTop = Math.max(0, Math.min(max, target.fraction * max));
        return;
      }
      case "identifier": {
        const parsed = parsePDFSubpath(target.value);
        if (!parsed) {
          const page = parseInt(target.value, 10);
          if (!Number.isNaN(page)) this.scrollToPage(page);
          return;
        }
        this.scrollToPage(parsed.page);
        if (parsed.type === "selection") {
          const list = this.pendingHighlights.get(parsed.page) ?? [];
          list.push({
            beginIndex: parsed.beginIndex,
            beginOffset: parsed.beginOffset,
            endIndex: parsed.endIndex,
            endOffset: parsed.endOffset
          });
          this.pendingHighlights.set(parsed.page, list);
          this.tryRenderPendingHighlight(parsed.page);
        }
        return;
      }
    }
  }

  async currentFraction(): Promise<number> {
    const max = this.host.scrollHeight - this.host.clientHeight;
    if (max <= 0) return 0;
    return this.host.scrollTop / max;
  }

  on<K extends keyof ReaderEventMap>(event: K, handler: (event: ReaderEventMap[K]) => void): () => void {
    if (event === "selection-change") {
      const wrapped = () => {
        const selection = globalThis.document.getSelection();
        if (!selection || selection.isCollapsed) return;
        const anchor = selection.anchorNode;
        if (!anchor) return;
        // 找到 selection 所在页面的 textLayer
        const textLayerEl = (anchor.nodeType === 1
          ? (anchor as Element)
          : anchor.parentElement)?.closest<HTMLElement>(".ez-reader__pdf-text-layer");
        if (!textLayerEl) return;
        const pageWrapper = textLayerEl.closest<HTMLElement>(".ez-reader__pdf-page");
        if (!pageWrapper) return;
        const pageNumber = Number(pageWrapper.dataset.pageNumber);
        if (!Number.isFinite(pageNumber)) return;
        const text = selection.toString().trim();
        if (!text) return;
        const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined;
        const rect = range?.getBoundingClientRect();
        const sel = range ? this.parseSelection(range) : null;
        const locator = sel
          ? selectionToSubpath(pageNumber, sel.beginIndex, sel.beginOffset, sel.endIndex, sel.endOffset)
          : `page=${pageNumber}`;
        this.currentPageNumber = pageNumber;
        handler({ text, locator, rect: rect ?? undefined } as unknown as ReaderEventMap[K]);
      };
      globalThis.document.addEventListener("selectionchange", wrapped);
      const off = () => globalThis.document.removeEventListener("selectionchange", wrapped);
      this.textLayerHandlers.push(off);
      return off;
    }
    if (event === "relocate") {
      const wrapped = handler as unknown as (detail: { fraction: number; locator?: string; page?: number }) => void;
      this.relocateHandlers.push(wrapped);
      return () => {
        const idx = this.relocateHandlers.indexOf(wrapped);
        if (idx >= 0) this.relocateHandlers.splice(idx, 1);
      };
    }
    return () => undefined;
  }

  /**
   * Walk from a DOM Range's start / end containers up to the nearest
   * `<span data-idx="N">` we placed in the text layer. The character
   * offset within the span is computed by counting text characters
   * between the start of the span and the range boundary.
   */
  private parseSelection(range: Range): { beginIndex: number; beginOffset: number; endIndex: number; endOffset: number } | null {
    const beginSpan = closestSpanWithIdx(range.startContainer);
    const endSpan = closestSpanWithIdx(range.endContainer);
    if (!beginSpan || !endSpan) return null;
    const beginIndex = Number(beginSpan.getAttribute("data-idx"));
    const endIndex = Number(endSpan.getAttribute("data-idx"));
    if (Number.isNaN(beginIndex) || Number.isNaN(endIndex)) return null;
    const beginOffset = textOffsetIn(beginSpan, range.startContainer, range.startOffset);
    const endOffset = textOffsetIn(endSpan, range.endContainer, range.endOffset);
    return { beginIndex, beginOffset, endIndex, endOffset };
  }

  async exportLocator(): Promise<string | null> {
    const selection = globalThis.document.getSelection();
    if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const textLayerEl = (range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer as Element
        : range.commonAncestorContainer.parentElement)?.closest<HTMLElement>(".ez-reader__pdf-text-layer");
      if (textLayerEl) {
        const pageWrapper = textLayerEl.closest<HTMLElement>(".ez-reader__pdf-page");
        const pageNumber = pageWrapper ? Number(pageWrapper.dataset.pageNumber) : this.currentPage();
        const sel = this.parseSelection(range);
        if (sel) return selectionToSubpath(pageNumber, sel.beginIndex, sel.beginOffset, sel.endIndex, sel.endOffset);
      }
    }
    return `page=${this.currentPage()}`;
  }

  async setScale(scale: number): Promise<void> {
    this.zoom = Math.max(0.4, Math.min(4, scale));
    this.applyZoom();
  }

  async setFitWidth(): Promise<void> {
    this.zoom = this.computeFitWidthZoom();
    this.applyZoom();
  }

  currentScale(): number {
    return this.zoom;
  }

  isFitWidth(): boolean {
    // "fit-width" means zoom matches the host's actual usable width.
    // Treat values close to computeFitWidthZoom() as fit-width.
    if (this.pages.length === 0) return false;
    const fit = this.computeFitWidthZoom();
    return Math.abs(this.zoom - fit) < 0.01;
  }

  async gotoPage(page: number): Promise<void> {
    const target = Math.max(1, Math.min(this.doc.numPages, Math.trunc(page)));
    this.scrollToPage(target);
  }

  /** 渲染所有页到滚动容器 — 上下滚动模式一次性全画出来 */
  async renderAllPages(): Promise<void> {
    for (let n = 1; n <= this.doc.numPages; n++) {
      await this.renderPage(n);
    }
    // 默认 fit-width, 但不撑爆宽屏 — 封顶 1200px (微信读书阅读宽度上限)
    this.zoom = this.computeFitWidthZoom();
    this.applyZoom();
  }

  private computeFitWidthZoom(): number {
    const firstPage = this.pages[0];
    if (!firstPage) return 1.0;
    const measured = this.host.clientWidth;
    // 不再 cap: 直接 fit host 宽度。host 自己有 padding 24px (左右加起来 48px),
    // 减掉 48 让 PDF 周围留点视觉呼吸空间。如果 host < 612 (native PDF width),
    // 退到 native 1.0, 配合 overflow-x: auto 可以水平滚动查看。
    const padding = 48;
    const targetWidth = Math.max(firstPage.nativeWidth, measured - padding);
    return targetWidth / firstPage.nativeWidth;
  }

  private async renderPage(pageNumber: number): Promise<void> {
    const pdfPage = await this.doc.getPage(pageNumber);
    const viewport = pdfPage.getViewport({ scale: 1.0 });
    const dpr = Math.max(1, Math.floor(globalThis.devicePixelRatio ?? 1));
    const displayWidth = viewport.width;
    const displayHeight = viewport.height;
    const pixelWidth = Math.max(1, Math.round(displayWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(displayHeight * dpr));

    const wrapper = this.host.createDiv({
      cls: "ez-reader__pdf-page",
      attr: { "data-page-number": String(pageNumber) }
    });
    const canvas = wrapper.createEl("canvas");
    const textLayer = wrapper.createDiv({ cls: "ez-reader__pdf-text-layer" });

    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;

    const context = canvas.getContext("2d");
    if (!context) {
      console.error("[ez-reader] PDF canvas 2D context unavailable", { page: pageNumber });
      return;
    }

    try {
      await pdfPage.render({ canvasContext: context, canvas, viewport }).promise;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ez-reader] PDF page render failed", { page: pageNumber, message, error });
      throw new Error(`PDF 页面渲染失败 (第 ${pageNumber} 页): ${message}`);
    }

    const pageRender: PdfPageRender = {
      pageNumber,
      wrapper,
      canvas,
      textLayer,
      textLayerContent: [],
      nativeWidth: displayWidth,
      nativeHeight: displayHeight
    };
    this.pages.push(pageRender);

    await this.renderTextLayerForPage(pdfPage, viewport, textLayer, pageRender);

    this.tryRenderPendingHighlight(pageNumber);
  }

  private async renderTextLayerForPage(
    page: PdfPage,
    viewport: PdfViewport,
    textLayer: HTMLElement,
    pageRender: PdfPageRender
  ): Promise<void> {
    let content: { items: Array<{ str: string; transform: number[]; width: number; height: number; hasEOL?: boolean }> };
    try {
      content = await page.getTextContent() as typeof content;
    } catch {
      return;
    }
    const scale = viewport.scale;
    const fontSizeMultiplier = this.appearance.fontSize / 100;
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const tx = (pdfjsLib as unknown as { Util: { transform: (a: number[], b: number[]) => number[] } }).Util.transform(viewport.transform, item.transform);
      const x = tx[4];
      const y = tx[5] - item.height * scale;
      const width = item.width * scale;
      const height = item.height * scale;
      const fontSize = Math.max(item.height * scale * fontSizeMultiplier, 8);
      const span = textLayer.createEl("span", { text: item.str + (item.hasEOL ? "\n" : " ") });
      span.setAttribute("data-idx", String(pageRender.textLayerContent.length));
      span.setCssStyles({
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        fontSize: `${fontSize}px`,
        lineHeight: "1",
        color: "transparent",
        whiteSpace: "pre",
        cursor: "text",
        userSelect: "text"
      });
      pageRender.textLayerContent.push({ text: item.str });
    }
    textLayer.setCssStyles({
      width: `${viewport.width}px`,
      height: `${viewport.height}px`
    });
  }

  private scrollToPage(pageNumber: number): void {
    const target = Math.max(1, Math.min(this.doc.numPages, Math.trunc(pageNumber)));
    const page = this.pages.find((p) => p.pageNumber === target);
    if (!page) return;
    this.host.scrollTo({ top: page.wrapper.offsetTop, behavior: "smooth" });
    this.currentPageNumber = target;
  }

  private applyZoom(): void {
    for (const page of this.pages) {
      // 缩放时同时改 wrapper 尺寸, 让 layout 跟着变 (不会因为 transform 留下空白)
      const scaledW = page.nativeWidth * this.zoom;
      const scaledH = page.nativeHeight * this.zoom;
      page.wrapper.style.width = `${scaledW}px`;
      page.wrapper.style.height = `${scaledH}px`;
      const applyTransform = (el: HTMLElement): void => {
        el.style.transformOrigin = "top left";
        el.style.transform = `scale(${this.zoom})`;
      };
      applyTransform(page.canvas);
      applyTransform(page.textLayer);
    }
  }

  private tryRenderPendingHighlight(pageNumber: number): void {
    const pending = this.pendingHighlights.get(pageNumber);
    if (!pending || pending.length === 0) return;
    const page = this.pages.find((p) => p.pageNumber === pageNumber);
    if (!page) return;
    if (page.textLayerContent.length === 0) return;
    for (const sel of pending) {
      this.applyHighlightToPage(page, sel);
    }
    this.pendingHighlights.delete(pageNumber);
  }

  private applyHighlightToPage(page: PdfPageRender, sel: PdfPendingHighlight): void {
    const spans = Array.from(page.textLayer.querySelectorAll<HTMLElement>("span[data-idx]"));
    for (const span of spans) {
      const idx = Number(span.getAttribute("data-idx"));
      if (Number.isNaN(idx)) continue;
      const text = page.textLayerContent[idx]?.text ?? "";
      let fromOffset = 0;
      let toOffset = text.length;
      if (idx === sel.beginIndex && idx === sel.endIndex) {
        fromOffset = sel.beginOffset;
        toOffset = sel.endOffset;
      } else if (idx === sel.beginIndex) {
        fromOffset = sel.beginOffset;
      } else if (idx === sel.endIndex) {
        toOffset = sel.endOffset;
      } else if (idx < sel.beginIndex || idx > sel.endIndex) {
        continue;
      }
      if (fromOffset >= toOffset) continue;
      const segment = text.slice(fromOffset, toOffset);
      if (!segment) continue;
      const before = text.slice(0, fromOffset);
      const after = text.slice(toOffset);
      const hl = document.createElement("span");
      hl.addClass("ez-reader__pdf-highlight");
      hl.textContent = segment;
      span.textContent = "";
      if (before) span.append(document.createTextNode(before));
      span.append(hl);
      if (after) span.append(document.createTextNode(after));
    }
  }
}

// PDF.js utility for transforming coordinates.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Walk up from a DOM node until we hit a `<span data-idx="...">`. This
 * is the inverse of the data-idx we set when rendering the text layer;
 * the Selection algorithm uses it to translate a user-selected range
 * into the (beginIndex, endIndex) part of the 4-tuple.
 */
const closestSpanWithIdx = (node: Node | null): HTMLElement | null => {
  let current: Node | null = node;
  while (current) {
    if (current instanceof HTMLElement && current.hasAttribute("data-idx")) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
};

/**
 * Compute the character offset of a DOM Range boundary inside the given
 * `<span data-idx>`. The range may start/end in a child text node of
 * the span, or even deeper (in case Obsidian adds wrappers). We walk
 * down to find the text-node equivalent of the boundary, then count
 * characters from the start of the span.
 */
const textOffsetIn = (span: HTMLElement, node: Node | null, offsetInNode: number): number => {
  if (!node) return 0;
  let total = 0;
  const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  let textNode: Node | null = walker.nextNode();
  while (textNode) {
    if (textNode === node) {
      return total + offsetInNode;
    }
    total += textNode.textContent?.length ?? 0;
    textNode = walker.nextNode();
  }
  return total;
};
