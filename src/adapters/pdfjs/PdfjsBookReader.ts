import type { Book } from "../../core/entities/Book";
import type {
  BookReader,
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
  destroy(): Promise<void>;
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
  async open(book: Book, host: HTMLElement, _appearance: ReaderAppearance): Promise<ReaderSession> {
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs" as string)) as unknown as PdfjsModule;
    configureWorker(pdfjs);

    const response = await fetch(book.locator.path);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const document = await loadingTask.promise;

    const session = new PdfjsSession(document, host);
    await session.gotoPage(1);
    return session;
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
    await this.doc.destroy();
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