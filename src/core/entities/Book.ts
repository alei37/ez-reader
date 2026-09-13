import type { Locale } from "../types/Locale";

/** Opaque identifier for a book inside the library. Derived from the source path. */
export type BookId = string;

/** Subset of file extensions the plugin knows how to read. */
export type BookFormat = "epub" | "mobi" | "azw" | "azw3" | "txt" | "pdf";

export const SUPPORTED_BOOK_FORMATS: ReadonlySet<BookFormat> = new Set<BookFormat>([
  "epub",
  "mobi",
  "azw",
  "azw3",
  "txt",
  "pdf"
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
}

/** Cover image bytes cached alongside the book. */
export interface CoverImage {
  readonly bookId: BookId;
  readonly bytes: ArrayBuffer;
  readonly mimeType: string;
}