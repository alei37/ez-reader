import { TFile, type App } from "obsidian";
import {
  SUPPORTED_BOOK_FORMATS,
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

/** Cache TTL for "file basename → metadata" snapshots. Filename-derived
 * metadata never changes after import, so a long TTL is fine. */
const METADATA_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Vault-backed implementation of `BookSource`. Reads from Obsidian's Vault
 * adapter; the metadata and cover bytes come from the same blobs the
 * reader would consume.
 */
export class ObsidianBookSource implements BookSource {
  /** Filename-derived metadata cache keyed by path. */
  private readonly metadataCache = new Map<string, BookMetadata>();

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
      yield makeLocator(file, format);
    }

    // Fallback: vault.getFiles() may still miss files Obsidian hasn't
    // loaded yet. Walk the adapter explicitly so we surface them too.
    let acceptedFromAdapter = 0;
    // Use an index pointer instead of shift() (O(n) per dequeue) and a
    // Set instead of Array.includes (O(n) per check) — both were O(n²)
    // on large vaults.
    const adapterFolders: string[] = [""];
    const visited = new Set<string>();
    let head = 0;
    while (head < adapterFolders.length) {
      const folder = adapterFolders[head++] ?? "";
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
        yield makeLocator(abstract, format);
      }
      for (const subFolder of entries.folders) {
        if (visited.has(subFolder)) continue;
        visited.add(subFolder);
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

  /**
   * Filename-derived metadata. The foliate reader populates richer metadata
   * (real title / authors / cover) the first time the user opens the book;
   * until then this fallback is what the shelf shows.
   */
  async readMetadata(locator: BookLocator): Promise<BookMetadata | null> {
    const cached = this.metadataCache.get(locator.path);
    if (cached && Date.now() - cached.cachedAt < METADATA_CACHE_TTL_MS) {
      return cached;
    }
    const file = this.app.vault.getAbstractFileByPath(locator.path);
    if (!(file instanceof TFile)) return null;
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
    return base;
  }

  /** Point lookup so LibraryService.refreshBook doesn't re-walk the vault. */
  async lookup(path: string): Promise<BookLocator | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    const format = extensionToFormat(file.extension);
    if (!format) return null;
    return makeLocator(file, format);
  }

  /** Used by CoverCache — extracts the cover image bytes from the book file. */
  async readCover(locator: BookLocator): Promise<CoverImage | null> {
    // The interface requires bytes; concrete cover extraction lives in the
    // book-reader adapters (foliate's `getCover()`). This is a thin shim
    // for tests / future adapters that need raw bytes via the BookSource
    // port — the production path goes through `FoliateBookReader.extractCover`.
    const file = this.app.vault.getAbstractFileByPath(locator.path);
    if (!(file instanceof TFile)) return null;
    const bytes = await this.app.vault.readBinary(file);
    return {
      bookId: this.resolveId(locator),
      bytes,
      mimeType: mimeTypeForFormat(locator.format)
    };
  }

  watch(handler: BookChangeHandler): Disposable {
    const refRename = this.app.vault.on("rename", (file) => {
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
    return {
      dispose: () => {
        this.app.vault.offref(refRename);
        this.app.vault.offref(refCreate);
        this.app.vault.offref(refModify);
        this.app.vault.offref(refDelete);
      }
    };
  }

  resolveId(locator: BookLocator): string {
    return locator.path;
  }

  async resolveLocator(id: string): Promise<BookLocator | null> {
    return this.lookup(id);
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

const mimeTypeForFormat = (format: BookFormat): string => {
  switch (format) {
    case "epub":
      return "application/epub+zip";
    case "pdf":
      return "application/pdf";
    case "txt":
      return "text/plain";
    case "mobi":
    case "azw":
    case "azw3":
      return "application/x-mobipocket-ebook";
  }
};

const makeLocator = (file: TFile, format: BookFormat): BookLocator => ({
  path: file.path,
  format,
  sizeBytes: file.stat.size,
  modifiedAt: file.stat.mtime
});

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