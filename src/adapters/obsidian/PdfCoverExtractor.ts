import type { Book } from "../../core/entities/Book";
import type {
  BookBytesLoader,
  BookReader,
  ExtractedCover
} from "../../core/ports/BookReader";

/**
 * PDF cover extractor that REUSES Obsidian's bundled pdf.js instance.
 *
 * Why this is non-obvious:
 *
 *   Obsidian's built-in PDFView exposes pdf.js v5.x via
 *   `globalThis.pdfjsLib`. If we shipped our own vendored pdf.js, it
 *   would clobber `globalThis.pdfjsLib` on load (pdf.js sets that global
 *   as a webpack side-effect) — and then Obsidian's PDFView, which also
 *   reads `globalThis.pdfjsLib`, would pick up OUR v4 instance, try to
 *   use OUR v4 worker, and crash with
 *   "API version 5.3.34 does not match Worker version 4.10.38".
 *
 *   To avoid all of that, we:
 *     1. Don't vendor pdf.js at all (~2 MB saved).
 *     2. Reach into `globalThis.pdfjsLib` for the module Obsidian already
 *        loaded.
 *     3. Don't touch `GlobalWorkerOptions.workerSrc` — Obsidian's PDFView
 *        sets it to its own v5 worker, and we want PDFView to keep
 *        working.
 *
 * If Obsidian ever stops exposing pdfjsLib on the global (or upgrades
 * to a version that breaks `getDocument({ data })`), this extractor
 * will fall back to "no PDF cover" — same UX as before this P1 work.
 */
interface PdfPageLike {
  getViewport(options: { scale: number; rotation?: number }): {
    width: number;
    height: number;
    scale: number;
  };
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    canvas: HTMLCanvasElement;
    viewport: { width: number; height: number; scale: number };
  }): { promise: Promise<void> };
}

interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  destroy?: () => Promise<void>;
}

interface PdfjsGlobalLike {
  getDocument: (config: { data?: ArrayBuffer | Uint8Array }) => {
    promise: Promise<PdfDocumentLike>;
    destroy?: () => Promise<void>;
  };
  version?: string;
}

const getObsidianPdfjs = (): PdfjsGlobalLike | null => {
  const lib = (globalThis as { pdfjsLib?: PdfjsGlobalLike }).pdfjsLib;
  if (!lib || typeof lib.getDocument !== "function") return null;
  return lib;
};

export class PdfCoverExtractor implements BookReader {
  async open(): Promise<never> {
    throw new Error("PdfCoverExtractor.open should never be called");
  }
  async readMetadata(): Promise<null> {
    return null;
  }
  async extractCover(
    book: Book,
    loader: BookBytesLoader
  ): Promise<ExtractedCover | null> {
    const pdfjs = getObsidianPdfjs();
    if (!pdfjs) {
      console.warn(
        `[ez-reader] PDF cover extract skipped for ${book.locator.path}: globalThis.pdfjsLib not available (Obsidian < 1.4 or PDFView not loaded yet)`
      );
      return null;
    }
    try {
      const bytes = new Uint8Array(await loader(book.locator.path));
      const document: PdfDocumentLike = await pdfjs.getDocument({ data: bytes }).promise;
      try {
        if (document.numPages < 1) return null;
        const page = await document.getPage(1);
        // 渲染比例 1.5 — 封面视觉清晰度足够 (EPUB 封面通常 600x900 左右),
        // 不需要太高清 (会膨胀 cover cache, shelf 缩略图用不到 2x DPI)。
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        // 白底 — 透明 PDF 的封面在某些 viewer 上显示成黑色 tile
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, canvas, viewport }).promise;
        const blob: Blob | null = await new Promise((resolve) => {
          canvas.toBlob((b: Blob | null) => resolve(b), "image/png");
        });
        if (!blob || blob.size === 0) return null;
        const arrayBuffer = await blob.arrayBuffer();
        return { bytes: arrayBuffer, mimeType: "image/png" };
      } finally {
        // destroy 释放 pdf.js 的内存 (字体缓存等)
        try {
          await document.destroy?.();
        } catch {
          /* ignore — extraction already finished */
        }
      }
    } catch (error) {
      console.warn(`[ez-reader] PDF cover extract failed for ${book.locator.path}`, error);
      return null;
    }
  }
}
