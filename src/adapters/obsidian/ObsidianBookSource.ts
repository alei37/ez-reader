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

    const accept = (file: TFile): BookLocator | null => {
      if (seenPaths.has(file.path)) return null;
      const format = extensionToFormat(file.extension);
      if (!format || !wanted.has(format)) return null;
      seenPaths.add(file.path);
      return {
        path: file.path,
        format,
        sizeBytes: file.stat.size,
        modifiedAt: file.stat.mtime
      };
    };

    const visited: string[] = [];
    const queue: string[] = [""];
    while (queue.length > 0) {
      const folder = queue.shift() ?? "";
      const entries = await this.app.vault.adapter.list(folder);
      for (const filePath of entries.files) {
        const abstract = this.app.vault.getAbstractFileByPath(filePath);
        if (abstract instanceof TFile) {
          const locator = accept(abstract);
          if (locator) yield locator;
        }
      }
      for (const subFolder of entries.folders) {
        if (visited.includes(subFolder)) continue;
        visited.push(subFolder);
        queue.push(subFolder);
      }
    }

    // Fall back to `vault.getFiles()` for any file Obsidian already
    // surfaced through other plugins. The seenPaths guard prevents
    // double-yielding the same path.
    for (const file of this.app.vault.getFiles()) {
      if (!(file instanceof TFile)) continue;
      const locator = accept(file);
      if (locator) yield locator;
    }
  }

  async read(locator: BookLocator): Promise<ArrayBuffer> {
    const file = this.app.vault.getAbstractFileByPath(locator.path);
    if (!(file instanceof TFile)) {
      throw new Error(`Book file no longer exists: ${locator.path}`);
    }
    return this.app.vault.readBinary(file);
  }

  async readMetadata(locator: BookLocator): Promise<BookMetadata | null> {
    // Metadata extraction is delegated to the reader engine once the book is
    // opened. For the shelf we only need a fast title guess; we fall back to
    // the file basename and let the user refine later.
    const file = this.app.vault.getAbstractFileByPath(locator.path);
    if (!(file instanceof TFile)) return null;
    return {
      title: file.basename,
      authors: [],
      languages: [],
      identifier: undefined,
      publisher: undefined,
      published: undefined,
      description: undefined,
      cachedAt: Date.now()
    };
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

// Re-export EventRef type so callers can use the same vocabulary if they want.
export type { EventRef };
// Re-export TFolder so importers of this module get a tidy single import.
export { TFolder };