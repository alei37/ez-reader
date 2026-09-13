import type { Book, BookFormat, BookLocator, BookMetadata, CoverImage } from "../entities/Book";
import type { Disposable } from "../utils/Disposable";

/** Change kind emitted by `BookSource.watch`. */
export type BookChangeKind = "added" | "modified" | "removed";

export interface BookChangeEvent {
  readonly kind: BookChangeKind;
  readonly path: string;
  readonly format: BookFormat;
}

export type BookChangeHandler = (event: BookChangeEvent) => void;

/**
 * Source of book files. Concrete implementations know how to enumerate files
 * (Vault adapter), read bytes, and parse metadata.
 *
 * The core layer never imports from this directly; `LibraryService` is the
 * only consumer and it accepts any `BookSource`.
 */
export interface BookSource {
  /** Discover book files matching the given formats. May emit lazily. */
  scan(formats: ReadonlySet<BookFormat>): AsyncIterable<BookLocator>;

  /** Read the binary content of a book file. */
  read(locator: BookLocator): Promise<ArrayBuffer>;

  /** Parse metadata out of the file (title, authors, languages, etc.). */
  readMetadata(locator: BookLocator): Promise<BookMetadata | null>;

  /** Parse the cover image out of the file, if the format has one. */
  readCover(locator: BookLocator): Promise<CoverImage | null>;

  /** Subscribe to vault-level changes. Returns a `Disposable`. */
  watch(handler: BookChangeHandler): Disposable;

  /** Stable identifier derived from the locator, e.g. a hash of the path. */
  resolveId(locator: BookLocator): string;

  /** Resolve a book back to its locator, if still present. */
  resolveLocator(id: string): Promise<BookLocator | null>;
}

export const reifyBook = (source: BookSource, locator: BookLocator, metadata: BookMetadata | null, now = Date.now()): Book => ({
  id: source.resolveId(locator),
  locator,
  metadata,
  sourceModifiedAt: locator.modifiedAt
});