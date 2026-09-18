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
   * Rich metadata parsed out of each book file (EPUB OPF, MOBI EXTH, etc.),
   * keyed by book id. Distinct from the filename-derived `BookSource.readMetadata`
   * fallback: these carry the real title / authors / language that the user
   * saw in the original library, captured the first time they opened the book.
   * Stored on the snapshot so it survives vault reloads.
   */
  readonly richMetadataByBookId?: Readonly<Record<string, import("../entities/Book").BookMetadata>>;
  /**
   * Whether the first-launch onboarding modal has been dismissed. Stored
   * in the snapshot so it survives plugin reloads but stays scoped to the
   * local vault (Syncthing excludes `.obsidian/`, so each device gets its
   * own copy).
   */
  readonly onboardingDismissed?: boolean;
  /**
   * P2: 用户翻过的 toc item id 集合, 按 bookId 索引. 关闭 / 重启 Obsidian
   * 后用户再打开同一本书, TocPanel 的进度点还能保留绿色.
   * 用 array 而不是 Set — JSON 序列化用 array, 顺序无关 (O(1) 查找走
   * includes 即可). 默认空对象 `{}`, 旧 data.json 没这字段也能 load.
   */
  readonly visitedTocIdsByBookId?: Readonly<Record<string, ReadonlyArray<string>>>;
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
  /**
   * P2: Patch-only excerpt update — 只改 note 和 tags, 其他字段 (id /
   * text / locator / createdAt) 保持原值. 比 addExcerpt 更高效:
   * - 不需要 caller 把整张 Excerpt 拷贝过来
   * - 不重新写高亮 (locator 没变)
   * - notes panel inline edit 用, 用户频繁触发, 需要 O(1) 而不是 O(n)
   */
  updateExcerptNote(
    bookId: BookId,
    excerptId: string,
    patch: { note?: string; tags?: ReadonlyArray<string> }
  ): Promise<void>;

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

  /**
   * P2: 读取用户翻过的 toc item id 列表 (按书). 用于在 openSession 完
   * 成时给 TocPanel.setVisited 注入历史 visited ids, 进度点能保留
   * 绿色. 缺字段 (旧 data.json) 返回空数组.
   */
  loadVisitedTocIds(bookId: BookId): Promise<ReadonlyArray<string>>;
  /**
   * P2: 原子地 read-modify-write visited toc ids. 在 write chain 内读
   * 最新 cache, append 新 id (去重), 一次性 save. 比 caller 先
   * loadVisitedTocIds 再写整个 array 少一次 race window. debounce 由
   * ReaderView 负责 (跟 progress 一样 300ms).
   */
  saveVisitedTocIds(bookId: BookId, ids: ReadonlyArray<string>): Promise<void>;

  loadCoverPaths(): Promise<Readonly<Record<string, string>>>;
  saveCoverPaths(coverPaths: Record<string, string>): Promise<void>;
  /**
   * P0-3 修复: 原子地 read-modify-write coverPaths map. 旧 `saveCoverPaths`
   * 是 caller 先 loadCoverPaths (读 cache) 再 saveCoverPaths (写) — 两个
   * 并发 caller 都可能在 T1-T2 之间读到同一份旧 map, 然后后写的覆盖先写
   * 的, 丢 coverPath. 现在 patch callback 在 mutate 内部读最新 cache 再 merge,
   * 串行化在 writeChain 上 — 跟 patchSettings 同样的语义.
   */
  patchCoverPaths(patch: (paths: Record<string, string>) => Record<string, string>): Promise<void>;

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
   * Persist rich metadata extracted from the book file itself (EPUB OPF,
   * MOBI EXTH, etc.) — as opposed to the filename-derived fallback in
   * `BookSource.readMetadata`. Keyed by book id so the shelf can show the
   * real title even after a vault reopen.
   */
  saveRichMetadata(bookId: BookId, metadata: import("../entities/Book").BookMetadata): Promise<void>;
  /**
   * Load the cached rich metadata for `bookId`, or `null` if none was ever
   * persisted (e.g. the book was added but never opened).
   */
  loadRichMetadata(bookId: BookId): Promise<import("../entities/Book").BookMetadata | null>;
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