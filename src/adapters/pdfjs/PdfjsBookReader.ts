import type { Book } from "../../core/entities/Book";
import type {
  BookBytesLoader,
  BookReader,
  ExtractedCover,
  ReaderEventMap,
  ReaderSession,
  ReaderTarget
} from "../../core/ports/BookReader";
import type { ReaderAppearance } from "../../core/types/ReaderSettings";

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
    const document = await loadingTask.promise;

    const session = new PdfjsSession(document, host, appearance);
    await session.gotoPage(1);
    return session;
  }

  /**
   * Render the first page to a small canvas and snapshot it as a PNG.
   * Keeps the dimensions modest (480 wide max) so a shelf full of covers
   * doesn't bloat the plugin data directory.
   */
  async extractCover(book: Book, loader: BookBytesLoader): Promise<ExtractedCover | null> {
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs" as string)) as unknown as PdfjsModule;
    configureWorker(pdfjs);
    const bytes = new Uint8Array(await loader(book.locator.path));
    const document = await pdfjs.getDocument({ data: bytes }).promise;
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
  private currentPage = 1;
  private scale = 1.5;
  private fitWidth = true;
  private textLayerContent: { text: string; x: number; y: number; width: number; height: number; fontSize: number }[] = [];
  private textLayerHandlers: Array<() => void> = [];

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

  async applyAppearance(appearance: ReaderAppearance): Promise<void> {
    Object.assign(this.appearance, appearance);
    // Re-render with the new font size; the host width may not have
    // changed, so we force fit-width off and back on to recompute.
    const previousFit = this.fitWidth;
    this.fitWidth = false;
    await this.gotoPage(this.currentPage);
    this.fitWidth = previousFit;
    if (previousFit) await this.gotoPage(this.currentPage);
  }

  async goTo(target: ReaderTarget): Promise<void> {
    switch (target.kind) {
      case "next":
        await this.gotoPage(this.currentPage + 1);
        return;
      case "previous":
        await this.gotoPage(this.currentPage - 1);
        return;
      case "fraction": {
        const page = Math.max(1, Math.min(this.doc.numPages, Math.round(target.fraction * this.doc.numPages) + 1));
        await this.gotoPage(page);
        return;
      }
      case "identifier": {
        const page = parseInt(target.value, 10);
        if (!Number.isNaN(page)) await this.gotoPage(page);
        return;
      }
    }
  }

  async currentFraction(): Promise<number> {
    if (this.doc.numPages <= 1) return 0;
    return (this.currentPage - 1) / (this.doc.numPages - 1);
  }

  on<K extends keyof ReaderEventMap>(event: K, handler: (event: ReaderEventMap[K]) => void): () => void {
    if (event === "selection-change") {
      const wrapped = () => {
        const selection = globalThis.document.getSelection();
        if (!selection || selection.isCollapsed) return;
        const text = selection.toString().trim();
        if (!text) return;
        handler({ text, locator: `page=${this.currentPage}` } as unknown as ReaderEventMap[K]);
      };
      this.textLayer.addEventListener("selectionchange", wrapped);
      const off = () => this.textLayer.removeEventListener("selectionchange", wrapped);
      this.textLayerHandlers.push(off);
      return off;
    }
    return () => undefined;
  }

  async exportLocator(): Promise<string | null> {
    return `page=${this.currentPage}`;
  }

  async setScale(scale: number): Promise<void> {
    this.fitWidth = false;
    this.scale = Math.max(0.4, Math.min(4, scale));
    await this.gotoPage(this.currentPage);
  }

  async setFitWidth(): Promise<void> {
    this.fitWidth = true;
    await this.gotoPage(this.currentPage);
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
      const hostWidth = Math.max(this.host.clientWidth - 24, 100);
      scale = hostWidth / baseViewport.width;
    }
    const viewport = pdfPage.getViewport({ scale });
    const dpr = Math.max(1, Math.floor(globalThis.devicePixelRatio ?? 1));
    const displayWidth = viewport.width;
    const displayHeight = viewport.height;
    const pixelWidth = Math.round(displayWidth * dpr);
    const pixelHeight = Math.round(displayHeight * dpr);
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("PDF canvas 2D context unavailable.");
    // Render at device pixel resolution for crisp output on HiDPI screens.
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
    this.canvas.style.width = `${displayWidth}px`;
    this.canvas.style.height = `${displayHeight}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Clear any previous frame so transparent PDFs don't ghost.
    context.clearRect(0, 0, displayWidth, displayHeight);
    // Fill with white so dark-themed PDFs are still legible.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, displayWidth, displayHeight);
    await pdfPage.render({ canvasContext: context, canvas: this.canvas, viewport }).promise;
    await this.renderTextLayer(pdfPage, viewport, displayWidth, displayHeight);
    this.currentPage = target;
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
  }
}

// PDF.js utility for transforming coordinates.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";