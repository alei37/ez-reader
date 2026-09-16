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
  /** Cached Obsidian resource paths for book cover images, keyed by book id. */
  readonly coverPaths?: Readonly<Record<string, string>>;
  /**
   * Original "when did I add this book" timestamps, keyed by book id.
   * Persisted so `addedDesc` sort stays meaningful across vault reopens —
   * without this, every reload would reset the timestamp via `Date.now()`
   * and lose the original ordering.
   */
  readonly addedAtByBookId?: Readonly<Record<string, number>>;
  /**
   * Pin-to-top timestamps, keyed by book id. Books in this map sort
   * above unpinned ones on the shelf. Older pins sort first within
   * the pinned group, so re-pinning bumps a book to the front.
   */
  readonly pinnedAtByBookId?: Readonly<Record<string, number>>;
  /**
   * Whether the first-launch onboarding modal has been dismissed. Stored
   * in the snapshot so it survives plugin reloads but stays scoped to the
   * local vault (Syncthing excludes `.obsidian/`, so each device gets its
   * own copy).
   */
  readonly onboardingDismissed?: boolean;
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
  /**
   * Atomically read-modify-write a settings field. Race-free when the
   * caller does debounced partial updates (e.g. slider drag) — the
   * read + modify + write happens inside the store's write chain so
   * concurrent callers can't clobber each other's fields.
   */
  patchSettings(patch: (settings: PluginSettings) => PluginSettings): Promise<void>;

  /**
   * Mark the first-launch onboarding modal as dismissed. The flag is
   * stored on the snapshot so it survives plugin reloads.
   */
  markOnboardingDismissed(): Promise<void>;
  /**
   * Has the first-launch onboarding modal been dismissed on this vault?
   * Used by ShelfView to decide whether to surface the modal again.
   */
  hasOnboardingBeenDismissed(): Promise<boolean>;

  loadCoverPaths(): Promise<Readonly<Record<string, string>>>;
  saveCoverPaths(coverPaths: Record<string, string>): Promise<void>;

  /**
   * Return the timestamp at which `bookId` was first added to the user's
   * library, or `null` if the book has never been added. Persists across
   * vault reloads so the original add order survives.
   */
  getAddedAt(bookId: BookId): Promise<number | null>;
  /** Persist the original "added to library" timestamp for `bookId`. */
  setAddedAt(bookId: BookId, addedAt: number): Promise<void>;
  /**
   * Return the timestamp at which `bookId` was pinned to the top of the
   * shelf, or `null` if it's not pinned. Used by the shelf to render the
   * pin indicator and to sort pinned books above unpinned ones.
   */
  getPinnedAt(bookId: BookId): Promise<number | null>;
  /**
   * Persist (or clear, when `pinnedAt === null`) the pinned-at timestamp
   * for `bookId`. Re-pinning updates the timestamp so the book jumps to
   * the front of the pinned group; clearing sets it back to null.
   */
  setPinnedAt(bookId: BookId, pinnedAt: number | null): Promise<void>;
  /**
   * Atomically add a batch of books to the library AND stamp them with the
   * same `addedAt` timestamp in a single snapshot write. Implemented as one
   * `mutate()` (i.e. one queued `saveData` round-trip) instead of 2N
   * sequential addToLibrary + setAddedAt calls — for "add all 100 books"
   * that drops total wall time from ≈ 10 s to ≈ 50 ms on a slow disk and
   * halves the time on a fast SSD.
   *
   * Books already in the library are skipped (idempotent); their existing
   * `addedAt` is not overwritten (preserves the original add order).
   */
  addToLibraryBatchWithStamp(bookIds: ReadonlyArray<BookId>, addedAt: number): Promise<void>;
}