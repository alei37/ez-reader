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
    await session.gotoPage(1);
    return session;
  }

  /**
   * Render the first page to a small canvas and snapshot it as a PNG.
   * Keeps the dimensions modest (480 wide max) so a shelf full of covers
   * doesn't bloat the plugin data directory.
   */
  async extractCover(book: Book, loader: BookBytesLoader): Promise<ExtractedCover | null> {
    // 复用已经在 open() 加载过的 doc — 避免重复 IO + PDF 解析
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
      // The canvas must be in the document for `toBlob` to work reliably
      // across browsers; append it temporarily, then detach immediately.
      const host = globalThis.document.body ?? globalThis.document.documentElement;
      const previousDisplay = canvas.style.display;
      canvas.style.display = "none";
      host.appendChild(canvas);
      try {
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        // Fill with white so PDFs without backgrounds don't come out
        // transparent and produce an all-black cover.
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

class PdfjsSession implements ReaderSession {
  readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly textLayer: HTMLElement;
  private readonly doc: PdfDocument;
  private readonly host: HTMLElement;
  private readonly appearance: ReaderAppearance;
  private currentPageNumber = 1;
  private scale = 1.5;
  private fitWidth = true;
  private textLayerContent: { text: string; x: number; y: number; width: number; height: number; fontSize: number }[] = [];
  private textLayerHandlers: Array<() => void> = [];
  private highlights: HighlightSpec[] = [];
  private currentChapterText: string | null = null;
  private pendingHighlightSelection: { type: "selection"; page: number; beginIndex: number; beginOffset: number; endIndex: number; endOffset: number; color?: string } | null = null;

  constructor(doc: PdfDocument, host: HTMLElement, appearance: ReaderAppearance) {
    this.doc = doc;
    this.element = host;
    this.host = host;
    this.appearance = appearance;
    host.empty();
    host.addClass("ez-reader__pdf-stage");
    this.canvas = host.createEl("canvas");
    this.canvas.addClass("ez-reader__pdf-stage__canvas");
    this.textLayer = host.createDiv({ cls: "ez-reader__pdf-stage__text-layer" });
  }

  async close(): Promise<void> {
    for (const off of this.textLayerHandlers) off();
    this.textLayerHandlers = [];
    this.canvas.remove();
    this.textLayer.remove();
    try {
      await this.doc.destroy?.();
    } catch (error) {
      console.warn("[ez-reader] pdf destroy failed", error);
    }
  }

  currentPage(): number {
    return this.currentPageNumber;
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
            // dest 通常是 [ref, name]; 我们简化使用索引顺序作为 page 估算
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
    // outline 的页码需要再解析; 简化实现: 把 TOC index 映射到大致页码
    const page = Math.min(this.doc.numPages, Math.max(1, Math.floor((index + 1) * this.doc.numPages / 50)));
    await this.gotoPage(page);
  }

  currentChapter(): string | null {
    return this.currentChapterText;
  }

  async highlight(_selection: HighlightSpec): Promise<void> {
    // PDF 高亮依赖 pdfjs text layer 渲染 spans, 完整实现需要更多工作;
    // 我们先记录到 data layer, 后续 UI 可基于 rects 渲染叠加层
    this.highlights.push(_selection);
  }

  async removeHighlight(id: string): Promise<void> {
    this.highlights = this.highlights.filter((h) => h.id !== id);
  }

  listHighlights(): ReadonlyArray<HighlightSpec> {
    return this.highlights;
  }

  async next(): Promise<void> {
    await this.gotoPage(this.currentPageNumber + 1);
  }

  async previous(): Promise<void> {
    await this.gotoPage(this.currentPageNumber - 1);
  }

  async applyAppearance(appearance: ReaderAppearance): Promise<void> {
    Object.assign(this.appearance, appearance);
    // Re-render with the new font size; the host width may not have
    // changed, so we force fit-width off and back on to recompute.
    const previousFit = this.fitWidth;
    this.fitWidth = false;
    await this.gotoPage(this.currentPageNumber);
    this.fitWidth = previousFit;
    if (previousFit) await this.gotoPage(this.currentPageNumber);
  }

  async goTo(target: ReaderTarget): Promise<void> {
    switch (target.kind) {
      case "next":
        await this.gotoPage(this.currentPageNumber + 1);
        return;
      case "previous":
        await this.gotoPage(this.currentPageNumber - 1);
        return;
      case "fraction": {
        const page = Math.max(1, Math.min(this.doc.numPages, Math.round(target.fraction * this.doc.numPages) + 1));
        await this.gotoPage(page);
        return;
      }
      case "identifier": {
        // 支持 subpath 格式: #page=1&selection=4,0,5,20
        const parsed = parsePDFSubpath(target.value);
        if (!parsed) {
          // 兼容旧的 page=N 格式
          const page = parseInt(target.value, 10);
          if (!Number.isNaN(page)) await this.gotoPage(page);
          return;
        }
        if (parsed.type === "page") {
          await this.gotoPage(parsed.page);
        } else if (parsed.type === "selection") {
          await this.gotoPage(parsed.page);
          // 跳转后渲染 highlight
          this.pendingHighlightSelection = parsed;
        } else if (parsed.type === "annotation") {
          await this.gotoPage(parsed.page);
        }
        return;
      }
    }
  }

  async currentFraction(): Promise<number> {
    if (this.doc.numPages <= 1) return 0;
    return (this.currentPageNumber - 1) / (this.doc.numPages - 1);
  }

  on<K extends keyof ReaderEventMap>(event: K, handler: (event: ReaderEventMap[K]) => void): () => void {
    if (event === "selection-change") {
      const wrapped = () => {
        const selection = globalThis.document.getSelection();
        if (!selection || selection.isCollapsed) return;
        if (!this.textLayer.contains(selection.anchorNode)) return; // ignore selections outside textLayer
        const text = selection.toString().trim();
        if (!text) return;
        const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined;
        const rect = range?.getBoundingClientRect();
        // 解析 4-tuple: 通过 selection 落在哪个 span (data-idx) 上算 index + offset
        const sel = range ? this.parseSelection(range) : null;
        const locator = sel
          ? selectionToSubpath(this.currentPageNumber, sel.beginIndex, sel.beginOffset, sel.endIndex, sel.endOffset)
          : `page=${this.currentPageNumber}`;
        handler({ text, locator, rect: rect ?? undefined } as unknown as ReaderEventMap[K]);
      };
      // selectionchange 必须在 document 上监听(textLayer 上的 selectionchange 不可靠)
      globalThis.document.addEventListener("selectionchange", wrapped);
      const off = () => globalThis.document.removeEventListener("selectionchange", wrapped);
      this.textLayerHandlers.push(off);
      return off;
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
    // 尝试返回带 4-tuple selection 的 subpath(若有活跃选区)
    const selection = globalThis.document.getSelection();
    if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (this.textLayer.contains(range.commonAncestorContainer)) {
        const sel = this.parseSelection(range);
        if (sel) return selectionToSubpath(this.currentPageNumber, sel.beginIndex, sel.beginOffset, sel.endIndex, sel.endOffset);
      }
    }
    return `page=${this.currentPageNumber}`;
  }

  async setScale(scale: number): Promise<void> {
    this.fitWidth = false;
    this.scale = Math.max(0.4, Math.min(4, scale));
    await this.gotoPage(this.currentPageNumber);
  }

  async setFitWidth(): Promise<void> {
    this.fitWidth = true;
    await this.gotoPage(this.currentPageNumber);
  }

  currentScale(): number {
    return this.scale;
  }

  isFitWidth(): boolean {
    return this.fitWidth;
  }

  async gotoPage(page: number): Promise<void> {
    const target = Math.max(1, Math.min(this.doc.numPages, Math.trunc(page)));
    const pdfPage = await this.doc.getPage(target);
    const baseViewport = pdfPage.getViewport({ scale: 1 });
    let scale = this.scale;
    if (this.fitWidth) {
      // If the stage isn't laid out yet, fall back to a sensible width so
      // the page renders at a usable size even on the very first frame.
      const measured = this.host.clientWidth;
      const hostWidth = measured > 100 ? measured - 32 : 600;
      scale = hostWidth / baseViewport.width;
    }
    const viewport = pdfPage.getViewport({ scale });
    const dpr = Math.max(1, Math.floor(globalThis.devicePixelRatio ?? 1));
    const displayWidth = viewport.width;
    const displayHeight = viewport.height;
    const pixelWidth = Math.max(1, Math.round(displayWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(displayHeight * dpr));
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("PDF canvas 2D context unavailable.");
    // Render at device pixel resolution for crisp output on HiDPI screens.
    // Setting canvas.width/height clears the buffer and resets the
    // context, so the new dimensions take effect immediately.
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
    this.canvas.style.width = `${displayWidth}px`;
    this.canvas.style.height = `${displayHeight}px`;
    // pdfjs's page.render accepts a canvasContext + viewport pair. The
    // render call ignores the context's current transform — it computes
    // its own from canvas.width/height vs viewport.width/height — so we
    // don't need to call setTransform here.
    try {
      await pdfPage.render({ canvasContext: context, canvas: this.canvas, viewport }).promise;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ez-reader] PDF page render failed", { page: target, message, error });
      throw new Error(`PDF 页面渲染失败 (第 ${target} 页): ${message}`);
    }
    await this.renderTextLayer(pdfPage, viewport, displayWidth, displayHeight);
    this.currentPageNumber = target;
  }

  private async renderTextLayer(page: PdfPage, viewport: PdfViewport, displayWidth: number, displayHeight: number): Promise<void> {
    this.textLayer.empty();
    this.textLayerContent = [];
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
      const span = this.textLayer.createEl("span", { text: item.str + (item.hasEOL ? "\n" : " ") });
      // data-idx is the cornerstone of the 4-tuple selection algorithm
      // borrowed from PDF++ (MIT). Without it we can't convert a DOM
      // Selection back to (beginIndex, beginOffset, endIndex, endOffset).
      span.setAttribute("data-idx", String(this.textLayerContent.length));
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
      this.textLayerContent.push({ text: item.str, x, y, width, height, fontSize });
    }
    // Size the layer container to match the canvas display size.
    this.textLayer.setCssStyles({
      width: `${displayWidth}px`,
      height: `${displayHeight}px`
    });

    // If a subpath jumped here, render its highlight after the text layer
    // exists.
    if (this.pendingHighlightSelection && this.pendingHighlightSelection.page === this.currentPageNumber) {
      this.renderPendingHighlight();
    }
  }

  /**
   * Highlight the chars covered by `pendingHighlightSelection`. We
   * span-wrap each character in the target range and apply a
   * `ez-reader__pdf-highlight` class; the matching CSS sits in
   * styles.css. Best-effort — if textLayerContent has fewer items than
   * the selection expects, we just highlight what we can.
   */
  private renderPendingHighlight(): void {
    const sel = this.pendingHighlightSelection;
    if (!sel) return;
    const spans = Array.from(this.textLayer.querySelectorAll<HTMLElement>("span[data-idx]"));
    for (const span of spans) {
      const idx = Number(span.getAttribute("data-idx"));
      if (Number.isNaN(idx)) continue;
      const text = this.textLayerContent[idx]?.text ?? "";
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
      // Wrap the target characters with a highlight span.
      const before = text.slice(0, fromOffset);
      const after = text.slice(toOffset);
      const hl = document.createElement("span");
      hl.addClass("ez-reader__pdf-highlight");
      hl.textContent = segment;
      // Replace the span's children with before + hl + after
      span.textContent = "";
      if (before) span.append(document.createTextNode(before));
      span.append(hl);
      if (after) span.append(document.createTextNode(after));
    }
    this.pendingHighlightSelection = null;
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