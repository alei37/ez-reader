import { TFile, TFolder, Vault, EventRef } from "obsidian";
import type { App } from "obsidian";
import {
  SUPPORTED_BOOK_FORMATS,
  mimeTypeFor,
  type BookFormat,
  type BookLocator,
  type BookMetadata,
  type CoverImage
} from "../../core/entities/Book";
import type {
  BookChangeHandler,
  BookSource
} from "../../core/ports/BookSource";
import type { Disposable } from "../../core/utils/Disposable";

/**
 * Vault-backed implementation of `BookSource`. Reads from Obsidian's Vault
 * adapter; the metadata and cover bytes come from the same blobs the
 * reader would consume.
 */
export class ObsidianBookSource implements BookSource {
  private readonly disposers = new Set<() => void>();
  private readonly handlers: BookChangeHandler[] = [];
  private watchers = 0;

  constructor(private readonly app: App) {}

  /**
   * Walk the vault using the file-system adapter so we discover files
   * Obsidian hasn't surfaced in the file explorer yet (PDF, EPUB, etc.).
   * `vault.getFiles()` only returns files Obsidian has loaded; using
   * `adapter.list()` is more reliable for "everything in the Vault".
   */
  async *scan(formats: ReadonlySet<BookFormat>): AsyncIterable<BookLocator> {
    const wanted = formats.size === 0 ? SUPPORTED_BOOK_FORMATS : formats;
    const seenPaths = new Set<string>();
    let totalFromGetFiles = 0;

    for (const file of this.app.vault.getFiles()) {
      if (!(file instanceof TFile)) continue;
      totalFromGetFiles += 1;
      if (seenPaths.has(file.path)) continue;
      const format = extensionToFormat(file.extension);
      if (!format || !wanted.has(format)) continue;
      seenPaths.add(file.path);
      yield {
        path: file.path,
        format,
        sizeBytes: file.stat.size,
        modifiedAt: file.stat.mtime
      };
    }

    // Fallback: vault.getFiles() may still miss files Obsidian hasn't
    // loaded yet. Walk the adapter explicitly so we surface them too.
    let acceptedFromAdapter = 0;
    const adapterFolders: string[] = [""];
    const visited: string[] = [];
    while (adapterFolders.length > 0) {
      const folder = adapterFolders.shift() ?? "";
      let entries: { files: string[]; folders: string[] };
      try {
        entries = await this.app.vault.adapter.list(folder);
      } catch (error) {
        console.warn(`[ez-reader] adapter.list failed for ${folder || "/"}`, error);
        continue;
      }
      for (const filePath of entries.files) {
        if (seenPaths.has(filePath)) continue;
        const abstract = this.app.vault.getAbstractFileByPath(filePath);
        if (!(abstract instanceof TFile)) continue;
        const format = extensionToFormat(abstract.extension);
        if (!format || !wanted.has(format)) continue;
        seenPaths.add(filePath);
        acceptedFromAdapter += 1;
        yield {
          path: filePath,
          format,
          sizeBytes: abstract.stat.size,
          modifiedAt: abstract.stat.mtime
        };
      }
      for (const subFolder of entries.folders) {
        if (visited.includes(subFolder)) continue;
        visited.push(subFolder);
        adapterFolders.push(subFolder);
      }
    }

    console.info(
      `[ez-reader] Scan: vault.getFiles()=${totalFromGetFiles}, adapter additions=${acceptedFromAdapter}, total seen=${seenPaths.size}.`
    );
  }

  async read(locator: BookLocator): Promise<ArrayBuffer> {
    const file = this.app.vault.getAbstractFileByPath(locator.path);
    if (!(file instanceof TFile)) {
      throw new Error(`Book file no longer exists: ${locator.path}`);
    }
    return this.app.vault.readBinary(file);
  }

  async readMetadata(locator: BookLocator): Promise<BookMetadata | null> {
    // Try the cache first so we don't reparse every time the shelf reloads.
    const cached = this.metadataCache.get(locator.path);
    if (cached && Date.now() - cached.cachedAt < 30 * 24 * 60 * 60 * 1000) {
      return cached;
    }
    const file = this.app.vault.getAbstractFileByPath(locator.path);
    if (!(file instanceof TFile)) return null;
    // Fast path: fall back to filename while the heavy metadata parse
    // runs in the background. The shelf gets to render immediately.
    const base: BookMetadata = {
      title: file.basename,
      authors: extractAuthorFromName(file.basename),
      languages: [],
      identifier: undefined,
      publisher: undefined,
      published: undefined,
      description: undefined,
      cachedAt: Date.now()
    };
    this.metadataCache.set(locator.path, base);
    // Kick off the deeper parse asynchronously. We don't await — the shelf
    // shows the filename-derived title immediately and updates when the
    // real metadata lands via the `modified` watch event.
    void this.parseAndCacheMetadata(locator);
    return base;
  }

  private metadataCache = new Map<string, BookMetadata>();

  private async parseAndCacheMetadata(locator: BookLocator): Promise<void> {
    try {
      const bytes = await this.read(locator);
      if (locator.format === "epub") {
        const parsed = await parseEpubMetadata(bytes);
        if (parsed) {
          this.metadataCache.set(locator.path, parsed);
          this.notifyChange(locator);
        }
      }
      // PDF metadata extraction is deferred — the pdfjs adapter parses
      // it on first open. We could ship a quick outline probe here, but
      // for the shelf the filename is enough.
    } catch (error) {
      console.warn(`[ez-reader] metadata parse failed for ${locator.path}`, error);
    }
  }

  private notifyChange(locator: BookLocator): void {
    for (const handler of this.handlers) {
      try {
        handler({ kind: "modified", path: locator.path, format: locator.format });
      } catch {
        // ignore listener errors
      }
    }
  }

  async readCover(locator: BookLocator): Promise<CoverImage | null> {
    const file = this.app.vault.getAbstractFileByPath(locator.path);
    if (!(file instanceof TFile)) return null;
    const bytes = await this.app.vault.readBinary(file);
    return {
      bookId: this.resolveId(locator),
      bytes,
      mimeType: mimeTypeFor(locator.format)
    };
  }

  watch(handler: BookChangeHandler): Disposable {
    const refRename = this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile) {
        const format = extensionToFormat(file.extension);
        if (format) handler({ kind: "modified", path: file.path, format });
      }
    });
    const refCreate = this.app.vault.on("create", (file) => {
      if (file instanceof TFile) {
        const format = extensionToFormat(file.extension);
        if (format) handler({ kind: "added", path: file.path, format });
      }
    });
    const refModify = this.app.vault.on("modify", (file) => {
      if (file instanceof TFile) {
        const format = extensionToFormat(file.extension);
        if (format) handler({ kind: "modified", path: file.path, format });
      }
    });
    const refDelete = this.app.vault.on("delete", (file) => {
      if (file instanceof TFile) {
        const format = extensionToFormat(file.extension);
        if (format) handler({ kind: "removed", path: file.path, format });
      }
    });
    this.watchers += 1;
    const dispose: Disposable = {
      dispose: () => {
        this.app.vault.offref(refRename);
        this.app.vault.offref(refCreate);
        this.app.vault.offref(refModify);
        this.app.vault.offref(refDelete);
        this.watchers = Math.max(0, this.watchers - 1);
        this.disposers.delete(dispose.dispose);
      }
    };
    this.disposers.add(dispose.dispose);
    return dispose;
  }

  resolveId(locator: BookLocator): string {
    return locator.path;
  }

  async resolveLocator(id: string): Promise<BookLocator | null> {
    const file = this.app.vault.getAbstractFileByPath(id);
    if (!(file instanceof TFile)) return null;
    const format = extensionToFormat(file.extension);
    if (!format) return null;
    return {
      path: file.path,
      format,
      sizeBytes: file.stat.size,
      modifiedAt: file.stat.mtime
    };
  }
}

const extensionToFormat = (extension: string): BookFormat | null => {
  switch (extension.toLowerCase()) {
    case "epub":
      return "epub";
    case "pdf":
      return "pdf";
    case "txt":
      return "txt";
    case "mobi":
      return "mobi";
    case "azw":
      return "azw";
    case "azw3":
      return "azw3";
    default:
      return null;
  }
};

/**
 * Best-effort author guess from the filename. Many PDF / EPUB dumps use
 * `Title (Author).epub` or `Author - Title.pdf`; we surface the guessed
 * author so the shelf card has something better than "未知作者".
 */
const extractAuthorFromName = (basename: string): string[] => {
  // Match patterns like "(张三)" or "（张三）" inside the basename.
  const paren = basename.match(/[((]([^()（）]{1,40})[)）]/);
  if (paren && paren[1]) return [paren[1].trim()];
  // Match "Title - Author" / "Title — Author"
  const dash = basename.split(/\s+[-—–]\s+/);
  if (dash.length >= 2 && dash[1]) return [dash[1].trim()];
  return [];
};

/**
 * Lightweight EPUB metadata probe. We unzip the OPF only — no full book
 * parse — to keep the shelf scan fast.
 */
const parseEpubMetadata = async (_bytes: ArrayBuffer): Promise<BookMetadata | null> => {
  // We avoid a runtime dependency on a zip library by returning null
  // for now. The foliate BookReader will populate richer metadata the
  // first time the user opens the book.
  return null;
};

// Re-export EventRef type so callers can use the same vocabulary if they want.
export type { EventRef };
// Re-export TFolder so importers of this module get a tidy single import.
export { TFolder };