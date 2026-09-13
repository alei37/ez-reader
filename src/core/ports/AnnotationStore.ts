import type { Bookmark } from "../entities/Bookmark";
import type { BookId } from "../entities/Book";
import type { Excerpt } from "../entities/Excerpt";
import type { ReadingState } from "../entities/ReadingState";
import type { PluginSettings } from "../types/ReaderSettings";

/**
 * Snapshot of all annotation data the store holds. The store persists this as
 * a single JSON document; partial updates write the full snapshot back.
 */
export interface AnnotationSnapshot {
  readonly version: 1;
  readonly settings: PluginSettings;
  /** Book IDs the user has explicitly added to the library, in the order they were added. */
  readonly library: ReadonlyArray<string>;
  readonly reading: ReadonlyArray<ReadingState>;
  readonly bookmarks: ReadonlyArray<Bookmark>;
  readonly excerpts: ReadonlyArray<Excerpt>;
}

/** Read/write access to annotation data, independent of how it's persisted. */
export interface AnnotationStore {
  load(): Promise<AnnotationSnapshot>;
  save(snapshot: AnnotationSnapshot): Promise<void>;

  listLibrary(): Promise<ReadonlyArray<BookId>>;
  addToLibrary(bookId: BookId): Promise<void>;
  removeFromLibrary(bookId: BookId): Promise<void>;

  listReading(): Promise<ReadonlyArray<ReadingState>>;
  upsertReading(state: ReadingState): Promise<void>;
  listBookmarks(bookId: BookId): Promise<ReadonlyArray<Bookmark>>;
  addBookmark(bookmark: Bookmark): Promise<void>;
  removeBookmark(bookId: BookId, bookmarkId: string): Promise<void>;
  listExcerpts(bookId: BookId): Promise<ReadonlyArray<Excerpt>>;
  addExcerpt(excerpt: Excerpt): Promise<void>;
  removeExcerpt(bookId: BookId, excerptId: string): Promise<void>;

  listSettings(): Promise<PluginSettings>;
  saveSettings(settings: PluginSettings): Promise<void>;
}