import { TFile, normalizePath, type App } from "obsidian";
import type { Plugin } from "obsidian";
import type { Book } from "../../core/entities/Book";
import type { BookReader } from "../../core/ports/BookReader";
import type { LibraryService } from "../../core/services/LibraryService";

/**
 * Owns the plugin-side book cover cache: extracts a cover image out of a
 * book's bytes, writes it under `<plugin>/data/covers/`, and hands back
 * the Obsidian `app://` resource URL the shelf can use as an <img> src.
 *
 * The cache is best-effort: a failure during extraction never throws back
 * into the reader — we just leave the book's `coverPath` null and let the
 * shelf fall back to a generated placeholder.
 */
export class CoverCache {
  private readonly coversDir: string;
  private readonly app: App;
  private readonly plugin: Plugin;
  private readonly library: LibraryService;
  private readonly foliate: BookReader;
  private readonly pdfjs: BookReader;
  private readonly inFlight = new Set<string>();

  constructor(
    app: App,
    plugin: Plugin,
    library: LibraryService,
    foliate: BookReader,
    pdfjs: BookReader
  ) {
    this.app = app;
    this.plugin = plugin;
    this.library = library;
    this.foliate = foliate;
    this.pdfjs = pdfjs;
    this.coversDir = normalizePath(`${app.vault.configDir}/plugins/${plugin.manifest.id}/data/covers`);
  }

  private engineFor(book: Book): BookReader {
    return book.locator.format === "pdf" ? this.pdfjs : this.foliate;
  }

  /**
   * Extract a cover for a book and write it to disk. Idempotent and
   * concurrent-safe: a single book is extracted at most once per session
   * even if multiple callers race here.
   */
  async ensureCoverFor(book: Book, loader: (path: string) => Promise<ArrayBuffer>): Promise<void> {
    if (book.coverPath) return;
    if (this.inFlight.has(book.id)) return;
    this.inFlight.add(book.id);
    try {
      const extracted = await this.engineFor(book).extractCover(book, loader);
      if (!extracted) return;
      const path = await this.writeCover(book, extracted.bytes, extracted.mimeType);
      this.library.setCoverPath(book.id, path);
    } catch (error) {
      console.warn(`[ez-reader] cover extraction failed for ${book.locator.path}`, error);
    } finally {
      this.inFlight.delete(book.id);
    }
  }

  /**
   * Extract covers for a batch of books in parallel. Concurrency is
   * capped at 3 to avoid saturating the render thread when the user
   * imports a large library.
   */
  async ensureCoversBatch(books: ReadonlyArray<Book>, loader: (path: string) => Promise<ArrayBuffer>): Promise<void> {
    const queue = books.filter((b) => !b.coverPath);
    let index = 0;
    const workers = Array.from({ length: 3 }, async () => {
      while (index < queue.length) {
        const book = queue[index++];
        await this.ensureCoverFor(book, loader);
      }
    });
    await Promise.all(workers);
  }

  private async writeCover(book: Book, bytes: ArrayBuffer, mimeType: string): Promise<string> {
    if (!(await this.app.vault.adapter.exists(this.coversDir))) {
      await this.app.vault.adapter.mkdir(this.coversDir);
    }
    const extension = extensionForMime(mimeType);
    const safeId = book.id.replace(/[^A-Za-z0-9._-]/g, "_");
    const target = normalizePath(`${this.coversDir}/${safeId}${extension}`);
    const temp = `${target}.writing-${Date.now()}`;
    try {
      await this.app.vault.adapter.writeBinary(temp, bytes);
      if (await this.app.vault.adapter.exists(target)) {
        await this.app.vault.adapter.remove(target);
      }
      await this.app.vault.adapter.rename(temp, target);
    } finally {
      if (await this.app.vault.adapter.exists(temp)) {
        await this.app.vault.adapter.remove(temp);
      }
    }
    return this.app.vault.adapter.getResourcePath(target);
  }

  /**
   * Scan the covers directory on startup to recover paths written by
   * previous sessions. Maps existing files onto the same `bookId` slug
   * we use when writing.
   */
  async hydrateCovers(): Promise<void> {
    if (!(await this.app.vault.adapter.exists(this.coversDir))) return;
    const listing = await this.app.vault.adapter.list(this.coversDir);
    for (const filePath of listing.files) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) continue;
      const slug = file.basename;
      const bookId = this.slugToBookId(slug);
      if (!bookId) continue;
      const resourcePath = this.app.vault.adapter.getResourcePath(filePath);
      this.library.setCoverPath(bookId, resourcePath);
    }
  }

  private slugToBookId(slug: string): string | null {
    // Reverse of `safeId` substitution: book ids originally had their
    // non-[A-Za-z0-9._-] characters replaced with `_`. We just need to
    // probe each known book id and see which slug it maps to.
    for (const entry of this.library.list({}, "titleAsc", true)) {
      const safeId = entry.book.id.replace(/[^A-Za-z0-9._-]/g, "_");
      if (safeId === slug) return entry.book.id;
    }
    return null;
  }
}

const extensionForMime = (mime: string): string => {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  return ".img";
};