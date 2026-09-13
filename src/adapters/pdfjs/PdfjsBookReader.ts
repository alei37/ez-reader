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
    _appearance: ReaderAppearance,
    loader: BookBytesLoader
  ): Promise<ReaderSession> {
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs" as string)) as unknown as PdfjsModule;
    configureWorker(pdfjs);

    const bytes = new Uint8Array(await loader(book.locator.path));
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const document = await loadingTask.promise;

    const session = new PdfjsSession(document, host);
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

class PdfjsSession implements ReaderSession {
  readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly doc: PdfDocument;
  private currentPage = 1;
  private scale = 1.2;

  constructor(doc: PdfDocument, host: HTMLElement) {
    this.doc = doc;
    this.element = host;
    host.empty();
    host.addClass("ez-reader__pdf-stage");
    this.canvas = host.createEl("canvas");
    this.canvas.addClass("ez-reader__pdf-stage__canvas");
  }

  async close(): Promise<void> {
    this.canvas.remove();
    try {
      await this.doc.destroy?.();
    } catch (error) {
      console.warn("[ez-reader] pdf destroy failed", error);
    }
  }

  async applyAppearance(_appearance: ReaderAppearance): Promise<void> {
    // Visual tweaks for PDF are limited to scale; the shell handles theme.
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

  on<K extends keyof ReaderEventMap>(_event: K, _handler: (event: ReaderEventMap[K]) => void): () => void {
    return () => undefined;
  }

  async exportLocator(): Promise<string | null> {
    return `page=${this.currentPage}`;
  }

  async gotoPage(page: number): Promise<void> {
    const target = Math.max(1, Math.min(this.doc.numPages, Math.trunc(page)));
    const pdfPage = await this.doc.getPage(target);
    const viewport = pdfPage.getViewport({ scale: this.scale });
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("PDF canvas 2D context unavailable.");
    this.canvas.width = viewport.width;
    this.canvas.height = viewport.height;
    await pdfPage.render({ canvasContext: context, canvas: this.canvas, viewport }).promise;
    this.currentPage = target;
  }
}