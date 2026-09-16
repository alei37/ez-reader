import type { Book } from "../../core/entities/Book";
import type {
  BookBytesLoader,
  BookReader,
  ExtractedCover,
  ReaderSession
} from "../../core/ports/BookReader";
import type { ReaderAppearance } from "../../core/types/ReaderSettings";
import type { PagedTextContent, PagedTextPage } from "./PagedTextSession";
import { PagedTextSession } from "./PagedTextSession";

/**
 * Adapter for plain `.txt` files. Loads the bytes, decodes them as UTF-8,
 * splits the text into fixed-size pages (with paragraph-aware breaking),
 * and renders them through the shared `PagedTextSession`.
 *
 * Format reference (RFC):
 *   - Pure text — no embedded cover, no metadata beyond filename.
 *   - Selections, highlights, TOC, and progress work the same as any
 *     other paged text engine.
 *
 * Why a custom adapter vs. wrapping foliate-js?
 *   foliate-js's `makeBook` expects EPUBs (or ZIP-shaped files). TXT is
 *   trivial — a tiny splitter keeps the bundle size smaller and gives
 *   us direct control over page-break heuristics (paragraph-aware) and
 *   the cover-fallback story.
 */

/** Approximate characters per page. Tuned for ~16px font on a 600px tall pane. */
const DEFAULT_PAGE_CHARS = 1600;

/** Hard cap so a single page never blows up if the input has very long lines. */
const MAX_PAGE_CHARS = 2400;

/**
 * Pure page-splitter. Decoupled from DOM and IO so unit tests can hit it.
 *
 * Strategy:
 *   1. Split the text into paragraphs by blank lines (or single newlines,
 *      depending on `paragraphMode`).
 *   2. Pack paragraphs into pages greedily until the running total exceeds
 *      `pageChars`. A paragraph longer than a page gets its own page so
 *      mid-paragraph breaks only happen as a last resort.
 *   3. Escape user content for safe HTML insertion.
 */
export const splitTextIntoPages = (
  text: string,
  options: { pageChars?: number; paragraphMode?: "blank-line" | "single-newline" } = {}
): PagedTextPage[] => {
  const pageChars = Math.max(200, Math.min(MAX_PAGE_CHARS, options.pageChars ?? DEFAULT_PAGE_CHARS));
  const mode = options.paragraphMode ?? detectParagraphMode(text);
  const paragraphs = splitIntoParagraphs(text, mode);

  const pages: PagedTextPage[] = [];
  let current = "";
  const flush = (): void => {
    const trimmed = current.trimEnd();
    if (trimmed.length === 0) return;
    pages.push({
      id: `page-${pages.length}`,
      html: paragraphsToHtml(trimmed)
    });
    current = "";
  };
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > pageChars) {
      // Single paragraph longer than a page — flush what we have, then
      // hard-break this paragraph at sentence boundaries.
      flush();
      const hardChunks = hardBreakLongParagraph(trimmed, pageChars);
      for (const chunk of hardChunks) {
        pages.push({ id: `page-${pages.length}`, html: paragraphsToHtml(chunk) });
      }
      continue;
    }
    if (current.length === 0) {
      current = trimmed;
      continue;
    }
    if (current.length + trimmed.length + 2 > pageChars) {
      flush();
      current = trimmed;
    } else {
      current = `${current}\n\n${trimmed}`;
    }
  }
  flush();

  if (pages.length === 0) {
    pages.push({ id: "page-0", html: "<p></p>" });
  }
  return pages;
};

/**
 * Heuristic: if the text has any blank-line paragraph breaks, use them;
 * otherwise treat every newline as a paragraph (one-line per paragraph,
 * common in poetry / log dumps).
 */
const detectParagraphMode = (text: string): "blank-line" | "single-newline" => {
  if (/\r?\n\s*\r?\n/.test(text)) return "blank-line";
  return "single-newline";
};

const splitIntoParagraphs = (text: string, mode: "blank-line" | "single-newline"): string[] => {
  if (mode === "blank-line") {
    return text.split(/\r?\n\s*\r?\n/g);
  }
  return text.split(/\r?\n/g);
};

/**
 * Convert a chunk of paragraphs to safe HTML. Each blank-line-separated
 * paragraph becomes a `<p>`. User-supplied text is HTML-escaped and
 * single newlines preserved as `<br>` so poetry stays readable.
 */
const paragraphsToHtml = (text: string): string => {
  const parts = text.split(/\n{2,}/);
  return parts
    .map((part) => {
      const escaped = escapeHtml(part);
      const withBreaks = escaped.replace(/\r?\n/g, "<br>");
      return `<p>${withBreaks}</p>`;
    })
    .join("");
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Hard-break a single long paragraph at sentence boundaries when possible,
 * falling back to character-level breaks if a sentence still overflows.
 */
const hardBreakLongParagraph = (text: string, maxChars: number): string[] => {
  const result: string[] = [];
  // First try splitting on sentence-ending punctuation (Chinese + Latin).
  const sentenceRe = /[^。！？!?；;]+[。！？!?；;]?/g;
  const sentences = text.match(sentenceRe) ?? [text];
  let buffer = "";
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (buffer.length > 0) {
        result.push(buffer);
        buffer = "";
      }
      // Fall back to character chunks for absurdly long sentences.
      for (let i = 0; i < sentence.length; i += maxChars) {
        result.push(sentence.slice(i, i + maxChars));
      }
      continue;
    }
    if (buffer.length === 0) {
      buffer = sentence;
    } else if (buffer.length + sentence.length <= maxChars) {
      buffer += sentence;
    } else {
      result.push(buffer);
      buffer = sentence;
    }
  }
  if (buffer.length > 0) result.push(buffer);
  return result;
};

/**
 * Extract a book title from the first non-empty line, falling back to the
 * filename. Used for the chapter-title display in `currentChapter()` and
 * for the TOC's single root entry.
 */
const guessTitleFromText = (text: string, fallback: string): string => {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
  // Heuristic: a title is short (< 80 chars) and not too long with no punctuation.
  if (firstLine.length > 0 && firstLine.length <= 80 && !firstLine.endsWith("。") && !firstLine.endsWith(".")) {
    return firstLine;
  }
  return fallback;
};

export class TxtBookReader implements BookReader {
  async open(
    book: Book,
    host: HTMLElement,
    appearance: ReaderAppearance,
    loader: BookBytesLoader
  ): Promise<ReaderSession> {
    const bytes = await loader(book.locator.path);
    const text = decodeText(bytes);
    const fallbackTitle = book.locator.path.split("/").pop()?.replace(/\.txt$/i, "") ?? "TXT";
    const title = guessTitleFromText(text, fallbackTitle);
    const pages = splitTextIntoPages(text);
    const content: PagedTextContent = {
      pages,
      toc: [{ id: "txt-root", label: title, depth: 0 }],
      chapterStartPages: [0]
    };
    return new PagedTextSession({ content, host, appearance, loader });
  }

  async extractCover(): Promise<ExtractedCover | null> {
    // Plain text has no embedded cover.
    return null;
  }
}

/**
 * Decode bytes as text. Strategy:
 *   1. Strip UTF-8 BOM if present, decode the rest as UTF-8.
 *   2. Try strict UTF-8 (catches ASCII + most modern Chinese).
 *   3. Fall back to GB18030 (covers GBK + GB2312 + Unicode's CJK extension;
 *      natively supported by Chromium, Firefox, and modern Android WebViews).
 *      This handles the common case of a `.txt` exported from an older
 *      Windows tool or downloaded from a CN forum.
 *   4. Last resort: permissive UTF-8 with replacement chars — better than
 *      refusing to open a slightly malformed file.
 *
 * P0-4: without the GB18030 fallback, the user's GBK-encoded Chinese
 * novels opened to a wall of □□□ — silent data loss with no notice.
 */
export const decodeText = (bytes: ArrayBuffer): string => {
  const view = new Uint8Array(bytes);
  // Strip UTF-8 BOM.
  if (view.length >= 3 && view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(view.subarray(3));
  }
  // Fast path: try strict UTF-8.
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(view);
  } catch {
    // Strict UTF-8 failed — try GB18030. TextDecoder("gb18030") is in
    // the Encoding spec; supported by Chromium ≥ 110, Firefox ≥ 113,
    // Safari ≥ 17. Old WebViews may throw — we catch and fall through.
    try {
      return new TextDecoder("gb18030").decode(view);
    } catch {
      // Last resort: permissive UTF-8 (U+FFFD replacement).
      return new TextDecoder("utf-8").decode(view);
    }
  }
};
