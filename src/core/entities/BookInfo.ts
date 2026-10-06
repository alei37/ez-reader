import type { BookFormat, BookId } from "./Book";
import type { Locale } from "../types/Locale";
import type { ReadingStatus } from "./ReadingState";

/**
 * Per-book information file (`<vault>/ezreader/info/<title>-<id>.md`).
 *
 * Stored as a Markdown file with YAML frontmatter so:
 * - Obsidian users can search / link / view it like any other note
 * - Dataview / Templater / other plugins can read the frontmatter fields
 * - We avoid the `data.json` schema-bloat problem: each book lives in its
 *   own file, partial updates don't touch the global snapshot
 *
 * Schema-bump rule: bump `schemaVersion` whenever any field semantics
 * change in an incompatible way. Older readers fall back to defaults.
 */
export interface BookInfo {
  readonly schemaVersion: 1;

  // ---- from BookMetadata (rich) ----
  readonly title: string;
  readonly authors: ReadonlyArray<string>;
  readonly publisher?: string;
  readonly published?: string;
  readonly language?: Locale;
  readonly isbn?: string;
  readonly pageCount?: number;
  readonly description?: string;

  // ---- from Book.locator ----
  readonly bookId: BookId;
  readonly format: BookFormat;
  readonly filePath: string;
  readonly fileSizeBytes: number;
  readonly fileModifiedAt: number;

  // ---- library state ----
  readonly addedToLibraryAt: number;
  readonly lastOpenedAt: number | null;
  readonly status: ReadingStatus;
  readonly progressFraction: number;
  readonly totalReadingMs: number;
  readonly excerptCount: number;
  readonly bookmarkCount: number;
  readonly thoughtCount: number;
  readonly favorite: boolean;
  readonly pinnedAt: number | null;

  // ---- cover ----
  readonly coverPath: string | null;

  // ---- last write ----
  readonly updatedAt: number;
}

/** Default schema version used when writing new info files. */
export const BOOK_INFO_SCHEMA_VERSION = 1 as const;

/** Empty / fallback values used when an existing info file lacks fields. */
export const defaultBookInfo = (
  partial: Pick<BookInfo, "bookId" | "format" | "filePath" | "fileSizeBytes" | "fileModifiedAt" | "addedToLibraryAt" | "title">
): BookInfo => ({
  schemaVersion: BOOK_INFO_SCHEMA_VERSION,
  title: partial.title,
  authors: [],
  bookId: partial.bookId,
  format: partial.format,
  filePath: partial.filePath,
  fileSizeBytes: partial.fileSizeBytes,
  fileModifiedAt: partial.fileModifiedAt,
  addedToLibraryAt: partial.addedToLibraryAt,
  lastOpenedAt: null,
  status: "unread",
  progressFraction: 0,
  totalReadingMs: 0,
  excerptCount: 0,
  bookmarkCount: 0,
  thoughtCount: 0,
  favorite: false,
  pinnedAt: null,
  coverPath: null,
  updatedAt: Date.now()
});
