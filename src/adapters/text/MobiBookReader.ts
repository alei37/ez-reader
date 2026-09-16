import type { Book, BookFormat, BookMetadata } from "../../core/entities/Book";
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
 * Minimal contract from `@lingo-reader/mobi-parser`. We re-declare it
 * here rather than importing the package types directly so the build
 * doesn't choke if the package's bundled `.d.ts` lags behind runtime.
 *
 * The package exports `Mobi` / `Kf8` classes plus `initMobiFile` /
 * `initKf8File`. We only touch the runtime methods we actually use.
 */
interface EpubLikeChapter {
  readonly id: string;
  /** Raw HTML for the chapter. */
  readonly text: string;
}

interface ProcessedChapter {
  readonly html: string;
  readonly css: ReadonlyArray<{ id: string; href: string }>;
}

/** Inlined chapter stylesheet text — what `PagedTextPage.css` ultimately wants. */
interface InlinedCss {
  readonly id: string;
  readonly text: string;
}

interface MobiTocItem {
  readonly label: string;
  readonly href: string;
  readonly children?: ReadonlyArray<MobiTocItem>;
}

interface EpubLikeMetadata {
  readonly title: string;
  readonly author: ReadonlyArray<string>;
  readonly language: string | string[];
  readonly publisher?: string;
  readonly description?: string;
  readonly identifier?: string;
}

interface EpubLikeParser {
  getMetadata(): EpubLikeMetadata;
  getToc(): ReadonlyArray<MobiTocItem>;
  getSpine(): ReadonlyArray<EpubLikeChapter>;
  loadChapter(id: string): ProcessedChapter | undefined;
  getCoverImage(): string;
  destroy(): void;
}

interface MobiModule {
  initMobiFile(file: Uint8Array): Promise<EpubLikeParser>;
  initKf8File(file: Uint8Array): Promise<EpubLikeParser>;
}

/**
 * Dynamic-import the parser. Pulled into a function so `MobiBookReader`
 * remains importable in test environments that don't load the real
 * package (the package's `index.browser.mjs` reaches for browser-only
 * globals).
 */
const importMobiParser = async (): Promise<MobiModule> => {
  const mod = await import("@lingo-reader/mobi-parser");
  return mod as unknown as MobiModule;
};

/**
 * Detect whether bytes are KF8 (AZW3) vs. MOBI. The package auto-routes
 * KF8/MOBI internally based on the PDB "MOBI" header signature, but the
 * two entry points (`initMobiFile` / `initKf8File`) still pick the right
 * parser when called. We sniff to know which one to call.
 *
 * Heuristic: scan for the "BOOKMOBI" PDB type signature that appears
 * in both old-MOBI and KF8 (newer AZW3) files. For our use case, we
 * just route everything through KF8 first — it accepts modern files
 * and falls back gracefully on older MOBI.
 *
 * Note from the parser source: `initKf8File` handles both kinds. We
 * route through it for all AZW3/MOBI paths.
 */
const isAzw3Format = (format: BookFormat): boolean => format === "azw3";

/**
 * Adapter for `.mobi` (Mobipocket) and `.azw3` (Kindle Format 8) ebooks.
 *
 * Architecture:
 *   - `@lingo-reader/mobi-parser` parses the binary on open and exposes
 *     a chapter spine, TOC, metadata, cover (as a blob: URL), and
 *     per-chapter CSS (also blob URLs).
 *   - We adapt the parser's output into the shared `PagedTextContent`
 *     shape so the same `PagedTextSession` that renders TXT also
 *     renders MOBI/AZW3.
 *
 * Memory note: the parser holds onto resource blob URLs for the
 * lifetime of the parser. We `destroy()` the parser on session close
 * to revoke them.
 */
export class MobiBookReader implements BookReader {
  async open(
    book: Book,
    host: HTMLElement,
    appearance: ReaderAppearance,
    loader: BookBytesLoader
  ): Promise<ReaderSession> {
    const bytes = await loader(book.locator.path);
    const parser = await this.createParser(book.locator.format, bytes);
    // P0-1: buildContent parses chapter HTML + TOC. A malformed MOBI can
    // throw partway through (loadChapter returns undefined for a damaged
    // record, getToc returns garbage, etc.). Without this try/catch the
    // parser holds onto its resource blob URLs and never gets a chance
    // to release them — a memory + blob URL leak on every broken MOBI
    // the user tries to open.
    let content: PagedTextContent;
    try {
      content = await buildContent(parser, book);
    } catch (error) {
      try {
        parser.destroy();
      } catch {
        /* swallow secondary failure — the original error is what matters */
      }
      throw error;
    }
    const session = new PagedTextSession({ content, host, appearance, loader });
    // Tear down the parser when the session closes. PagedTextSession's
    // close() doesn't know about the parser, so we hook its element
    // removal via a MutationObserver-free trick: the session's element
    // is removed from the DOM in close(). We attach a one-shot disposer
    // through `on("close")` semantics — but PagedTextSession doesn't
    // emit close. Instead, we patch `close()` on the instance.
    const originalClose = session.close.bind(session);
    let destroyed = false;
    const destroyParser = (): void => {
      if (destroyed) return;
      destroyed = true;
      try {
        parser.destroy();
      } catch (error) {
        console.warn("[ez-reader] mobi parser destroy failed", error);
      }
    };
    (session as { close: () => Promise<void> }).close = async () => {
      try {
        await originalClose();
      } finally {
        destroyParser();
      }
    };
    return session;
  }

  async extractCover(book: Book, loader: BookBytesLoader): Promise<ExtractedCover | null> {
    try {
      const bytes = await loader(book.locator.path);
      const parser = await this.createParser(book.locator.format, bytes);
      try {
        const blobUrl = parser.getCoverImage();
        if (!blobUrl) return null;
        const response = await fetch(blobUrl);
        const blob = await response.blob();
        if (blob.size === 0) return null;
        const coverBytes = await blob.arrayBuffer();
        const mime = sniffImageMime(coverBytes) ?? blob.type ?? "image/jpeg";
        return { bytes: coverBytes, mimeType: mime };
      } finally {
        parser.destroy();
      }
    } catch (error) {
      console.warn("[ez-reader] MOBI cover extraction failed", error);
      return null;
    }
  }

  /**
   * Extract MOBI/AZW3 metadata from the parser's EXTH record. Mirrors
   * `FoliateBookReader.readMetadata` — called by `LibraryService.refreshMetadata`
   * after a successful open so the shelf shows the real book title.
   *
   * P0-2 修复: 之前书架显示 file.basename; MOBI 的 EXTH record 经常含
   * 干净的 title / author ("The Great Gatsby", "F. Scott Fitzgerald"),
   * 不解析就是浪费.
   */
  async readMetadata(book: Book, loader: BookBytesLoader): Promise<BookMetadata | null> {
    try {
      const bytes = await loader(book.locator.path);
      const parser = await this.createParser(book.locator.format, bytes);
      try {
        const raw = parser.getMetadata();
        const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : undefined;
        if (!title) return null;
        const authors: string[] = [];
        if (Array.isArray(raw.author)) {
          for (const a of raw.author) {
            if (typeof a === "string" && a.trim()) authors.push(a.trim());
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
      } finally {
        parser.destroy();
      }
    } catch (error) {
      console.warn("[ez-reader] MOBI readMetadata failed", book.locator.path, error);
      return null;
    }
  }

  private async createParser(format: BookFormat, bytes: ArrayBuffer): Promise<EpubLikeParser> {
    const mod = await importMobiParser();
    // P0-3: Pass a Uint8Array *view* over the loader's ArrayBuffer instead
    // of `new Uint8Array(view)` (which copies). The parser's internal
    // `toArrayBuffer` slices the underlying buffer once more for its own
    // use; passing a copy here would mean TWO copies of every large MOBI
    // file in memory simultaneously. A view shares the same bytes — fine
    // because the parser doesn't mutate, and we don't reuse `bytes` after.
    const view = new Uint8Array(bytes);
    if (isAzw3Format(format)) {
      return mod.initKf8File(view);
    }
    return mod.initMobiFile(view);
  }
}

/**
 * Adapt the parser's API to `PagedTextContent`. Walk the spine and turn
 * each chapter into a page. TOC items point to spine ids, which the
 * session can resolve to page indices via `chapterStartPages`.
 *
 * The parser hands back each chapter's CSS as `blob:` URLs. Obsidian's
 * CSP forbids loading stylesheets from `blob:` sources (the directive is
 * `style-src 'unsafe-inline' 'self' https://fonts.googleapis.com`), so
 * we resolve every blob URL to inline content up-front here — the
 * `PagedTextSession` then injects it as an inline `<style>` element
 * which CSP does allow.
 *
 * Fetch failures are non-fatal: the chapter still renders, just without
 * that chapter's custom CSS. We mark the entry as `[]` rather than
 * keeping the unreachable blob URL, so the session doesn't retry on
 * every page-turn.
 */
const buildContent = async (parser: EpubLikeParser, book: Book): Promise<PagedTextContent> => {
  const spine = parser.getSpine();
  const pages: PagedTextPage[] = [];
  for (const chapter of spine) {
    const processed = parser.loadChapter(chapter.id);
    const html = processed?.html ?? "";
    // The parser's `html` is the body content; wrap it so the session's
    // CSS has a paragraph root to target.
    const inlinedCss = await inlineChapterCss(processed?.css ?? []);
    pages.push({
      id: chapter.id,
      html: html.length > 0 ? html : "<p></p>",
      css: inlinedCss,
      chapterTitle: undefined
    });
  }
  if (pages.length === 0) {
    pages.push({ id: "empty", html: "<p>(空书 / Empty book)</p>" });
  }

  // Flatten the TOC. For each TOC entry, resolve the href to a spine id
  // via the parser's `resolveHref`. If resolution fails (older MOBI
  // sometimes lacks the function), fall back to the spine id directly.
  const flatToc: Array<{ id: string; label: string; depth: number }> = [];
  const chapterStartPages: number[] = [];
  const walk = (items: ReadonlyArray<MobiTocItem>, depth: number): void => {
    for (const item of items) {
      const label = item.label?.trim() || "未命名章节";
      // The parser returns spine ids in chapter fields — but `pages` is
      // indexed by spine position, not id. We look up the spine index by
      // matching `id` against the chapter.id strings.
      const spineIdx = spine.findIndex((ch) => ch.id === item.href || ch.id.startsWith(item.href));
      const pageIdx = spineIdx >= 0 ? spineIdx : pages.findIndex((p) => p.id === item.href);
      const targetPage = pageIdx >= 0 ? pageIdx : 0;
      const tocId = `toc-${flatToc.length}`;
      flatToc.push({ id: tocId, label, depth });
      chapterStartPages.push(targetPage);
      if (Array.isArray(item.children)) walk(item.children, depth + 1);
    }
  };
  walk(parser.getToc(), 0);

  // If the parser returned no TOC, synthesize one per chapter so the
  // panel isn't empty.
  if (flatToc.length === 0) {
    const metadata = parser.getMetadata();
    const title = metadata.title?.trim() || book.locator.path.split("/").pop() || "书";
    flatToc.push({ id: "toc-root", label: title, depth: 0 });
    chapterStartPages.push(0);
    pages.forEach((page, idx) => {
      flatToc.push({ id: `toc-${idx + 1}`, label: `第 ${idx + 1} 节`, depth: 1 });
      chapterStartPages.push(idx);
    });
  }

  return {
    pages,
    toc: flatToc.map((item, idx) => ({
      id: item.id,
      label: item.label,
      depth: item.depth,
      locator: String(chapterStartPages[idx] ?? 0)
    })),
    chapterStartPages
  };
};

/**
 * Convert the parser's `blob:`-URL chapter stylesheets into inline CSS
 * text. Sequential awaits keep things simple — there are typically only
 * a handful of chapters and the files are tiny. Failed fetches drop the
 * entry (the chapter still renders, just without that custom CSS).
 */
const inlineChapterCss = async (
  parts: ReadonlyArray<{ id: string; href: string }>
): Promise<ReadonlyArray<InlinedCss>> => {
  const out: InlinedCss[] = [];
  const failures: string[] = [];
  for (const part of parts) {
    try {
      const response = await fetch(part.href);
      const text = await response.text();
      out.push({ id: part.id, text });
    } catch (error) {
      failures.push(part.id);
      console.warn(`[ez-reader] failed to inline chapter CSS ${part.id}`, error);
    }
  }
  // P2-2: 汇总失败 — 之前每条单独 warn, console 噪音大, 用户不知道到底坏了几章.
  // 现在 N 章全失败时打一条 summary, 至少 console 看起来干净.
  if (failures.length > 0 && failures.length === parts.length) {
    console.warn(`[ez-reader] MOBI chapter CSS all ${failures.length} part(s) failed to inline — book may render with default styles only`);
  }
  return out;
};

/**
 * Sniff image MIME from the first 12 bytes. Duplicates FoliateBookReader
 * logic — kept private here to avoid a circular import.
 */
const sniffImageMime = (bytes: ArrayBuffer): string | null => {
  const view = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
  if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4e && view[3] === 0x47) return "image/png";
  if (view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) return "image/jpeg";
  if (view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46 &&
      view[8] === 0x57 && view[9] === 0x45 && view[10] === 0x42 && view[11] === 0x50) return "image/webp";
  if (view[0] === 0x47 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x38) return "image/gif";
  return null;
};
