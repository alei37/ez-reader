import type { Locale } from "../types/Locale";

/** Opaque identifier for a book inside the library. Derived from the source path. */
export type BookId = string;

/**
 * File extensions the plugin *recognises*. This is broader than what we
 * actually render — only `READER_CAPABLE_FORMATS` has an adapter today.
 * The legacy formats stay in the type so future adapters (TXT reader,
 * MOBI/AZW via calibre conversion, etc.) can slot in without a schema
 * migration.
 */
export type BookFormat = "epub" | "mobi" | "azw" | "azw3" | "txt" | "pdf";

/** Every format the type system knows about. Used by BookSource.scan as a default. */
export const SUPPORTED_BOOK_FORMATS: ReadonlySet<BookFormat> = new Set<BookFormat>([
  "epub",
  "mobi",
  "azw",
  "azw3",
  "txt",
  "pdf"
]);

/**
 * Formats that have a working `BookReader` adapter today. LibraryService
 * filters scans to this set so users never see unrenderable files on the
 * shelf. Shelf filters expose the same set so the UI doesn't surface
 * dead options.
 *
 * Adding a new format here means: ship the adapter, register it in
 * Plugin.ts (`bookReaderFor`), then add the format to this set.
 */
export const READER_CAPABLE_FORMATS: ReadonlySet<BookFormat> = new Set<BookFormat>([
  "epub",
  "pdf",
  "txt",
  "mobi",
  "azw3"
]);

/** MIME type for a given format, used when constructing `File` blobs. */
export const mimeTypeFor = (format: BookFormat): string => {
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

/** Vault-relative path of a book file. */
export interface BookLocator {
  readonly path: string;
  readonly format: BookFormat;
  readonly sizeBytes: number;
  readonly modifiedAt: number;
}

/** Cached metadata extracted from the book file itself. */
export interface BookMetadata {
  readonly title: string;
  readonly authors: ReadonlyArray<string>;
  readonly publisher?: string;
  readonly published?: string;
  readonly languages: ReadonlyArray<Locale>;
  readonly identifier?: string;
  readonly description?: string;
  /** Cache miss leaves this undefined. The cache is rebuilt on demand. */
  readonly cachedAt: number;
}

/** A book as the library sees it: locator + metadata + presence flags. */
export interface Book {
  readonly id: BookId;
  readonly locator: BookLocator;
  readonly metadata: BookMetadata | null;
  readonly sourceModifiedAt: number;
  /**
   * When the user explicitly added this book to their personal library.
   * `null` means the file was discovered but the user has not opted in to
   * tracking it yet. Only books with a non-null `addedToLibraryAt` show up
   * on the shelf by default; the rest are candidates surfaced through the
   * "Add to library" flow.
   */
  readonly addedToLibraryAt: number | null;
  /**
   * Optional Obsidian resource path (`app://...`) for the cached cover
   * image. Set by the cover-extraction flow once the user has opened the
   * book at least once; otherwise null and the shelf falls back to a
   * generated placeholder.
   */
  readonly coverPath: string | null;
  /**
   * When the user pinned this book to the top of the shelf. `null` means
   * the book is not pinned. Pinned books sort before unpinned ones
   * regardless of the active sort criterion (closest semantic to a
   * "favorites-on-top" ordering users expect). Stored as a timestamp so
   * multiple pins stay stable across reorders.
   */
  readonly pinnedAt: number | null;
}

/** Cover image bytes cached alongside the book. */
export interface CoverImage {
  readonly bookId: BookId;
  readonly bytes: ArrayBuffer;
  readonly mimeType: string;
}