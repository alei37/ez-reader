import { type Book, type BookId, type BookLocator, type BookMetadata, READER_CAPABLE_FORMATS } from "../entities/Book";
import type { ReadingState, ReadingStatus } from "../entities/ReadingState";
import type { AnnotationStore } from "../ports/AnnotationStore";
import type { BookSource } from "../ports/BookSource";
import {
  DEFAULT_SORT,
  emptyFilter,
  type ProgressBucket,
  type RecencyBucket,
  type ShelfFilter,
  type SortCriterion
} from "../types/ShelfFilter";
import type { Disposable } from "../utils/Disposable";
import { progressFraction } from "../entities/ReadingState";

/**
 * Library view as the shelf renders it. The service keeps the metadata,
 * reading state, and any filtered output joined so the UI never has to
 * cross-correlate three tables.
 */
export interface LibraryEntry {
  readonly book: Book;
  readonly reading: ReadingState;
}

export interface ScanProgress {
  readonly checked: number;
  readonly discovered: number;
  readonly elapsedMs: number;
  readonly done: boolean;
}

export type ScanProgressListener = (progress: ScanProgress) => void;

/**
 * Personal library service. Owns the join between book metadata (from
 * `BookSource`) and per-book reading state (from `AnnotationStore`).
 *
 * The service is deliberately stateful so the shelf view can subscribe to
 * change notifications and re-render. Tests inject in-memory implementations
 * of `BookSource` and `AnnotationStore`.
 */
export class LibraryService {
  private readonly entries = new Map<string, LibraryEntry>();
  private readonly listeners = new Set<() => void>();
  private readonly sourceDisposables: Disposable[] = [];
  // Re-entrancy guard. Obsidian can fire 'added' events back-to-back
  // during startup (one per new file it just loaded). Re-running
  // `initialize` mid-flight overwrites entries and double-emits. We
  // serialise on a single promise so the second caller awaits the
  // first then no-ops if the entries are already populated.
  private initializeInFlight: Promise<void> | null = null;

  constructor(
    private readonly source: BookSource,
    private readonly annotations: AnnotationStore
  ) {}

  /** Initial load: scan the source and join against stored reading state. */
  async initialize(): Promise<void> {
    // Re-entrancy guard: a second call while the first is mid-flight
    // simply awaits it. Subsequent calls after a completed initial scan
    // are a no-op (the entries map is already populated).
    if (this.entries.size > 0 && this.initializeInFlight === null) return;
    if (this.initializeInFlight) return this.initializeInFlight;
    this.initializeInFlight = this.doInitialize();
    try {
      await this.initializeInFlight;
    } finally {
      this.initializeInFlight = null;
    }
  }

  private async doInitialize(): Promise<void> {
    const [reading, library] = await Promise.all([
      this.annotations.listReading(),
      this.annotations.listLibrary()
    ]);
    const readingByPath = new Map(reading.map((state) => [state.bookId, state]));
    const librarySet = new Set(library);
    // Fetch "first added at" timestamp for every currently-in-library book
    // in one pass. Previously we used `Date.now()` here, which silently
    // reset the timestamp on every vault reopen — sorting by "recently
    // added" lost its meaning. Now we read the persisted value.
    const addedAtEntries = await Promise.all(
      library.map((id) => this.annotations.getAddedAt(id).then((addedAt) => [id, addedAt] as const))
    );
    const addedAtByBookId = new Map(addedAtEntries);

    // P1 新功能: 同样在 init 时一次性拉所有 pinned 状态. Pinned 不要求书
    // 已经在 library (理论上用户也可能 pin 未加入的书, 用于"我想以后读"),
    // 所以不带 librarySet 过滤, 全部读.
    const pinnedAtEntries = await Promise.all(
      this.entries.size === 0
        ? library.map(async (id) => [id, await this.annotations.getPinnedAt(id)] as const)
        : [...this.entries.keys(), ...library].filter((id, idx, arr) => arr.indexOf(id) === idx)
            .map(async (id) => [id, await this.annotations.getPinnedAt(id)] as const)
    );
    const pinnedAtByBookId = new Map(pinnedAtEntries);

    // Note: `txt`, `mobi`, `azw`, `azw3` are still recognised by the
    // BookSource extension map, but we only scan for formats that have a
    // working `BookReader` adapter today. `READER_CAPABLE_FORMATS` is the
    // single source of truth — adding a new adapter there is the only
    // change needed to make a format discoverable on the shelf.
    const formats = READER_CAPABLE_FORMATS;
    for await (const locator of this.source.scan(formats)) {
      const id = this.source.resolveId(locator);
      let metadata = null;
      try {
        metadata = await this.source.readMetadata(locator);
      } catch {
        metadata = null;
      }
      const addedToLibraryAt = librarySet.has(id)
        ? addedAtByBookId.get(id) ?? Date.now()
        : null;
      const book: Book = {
        id,
        locator,
        metadata,
        sourceModifiedAt: locator.modifiedAt,
        addedToLibraryAt,
        coverPath: null,
        pinnedAt: pinnedAtByBookId.get(id) ?? null
      };
      const stored = readingByPath.get(id);
      this.entries.set(id, {
        book,
        reading: stored ?? {
          bookId: id,
          position: null,
          status: "unread",
          favorite: false,
          lastOpenedAt: null,
          totalReadingMs: 0
        }
      });
    }

    const inLibrary = [...this.entries.values()].filter((entry) => entry.book.addedToLibraryAt !== null).length;
    console.info(`[ez-reader] Library scan: ${this.entries.size} book(s) discovered, ${inLibrary} in library.`);
    for (const entry of this.entries.values()) {
      const flag = entry.book.addedToLibraryAt !== null ? "+" : "-";
      console.info(`[ez-reader]   [${flag}] ${entry.book.locator.format.toUpperCase().padEnd(4)} ${entry.book.locator.path}`);
    }

    this.sourceDisposables.push(
      this.source.watch((event) => {
        if (event.kind === "removed") {
          const id = this.source.resolveId({ path: event.path, format: event.format, sizeBytes: 0, modifiedAt: 0 });
          this.entries.delete(id);
          this.emit();
        } else if (event.kind === "added") {
          // For added events, we want to surface the new file. Refresh-on-id
          // would miss sibling files Obsidian just loaded. We call refreshBook
          // for the new path and trust the in-flight guard above to coalesce
          // bursts of 'added' events from the startup scan.
          if (this.entries.size === 0) {
            void this.initialize();
          } else {
            void this.refreshBook(event.path);
          }
        } else {
          // "modified" only needs to refresh the one book we already know about.
          void this.refreshBook(event.path);
        }
      })
    );

    this.emit();
  }

  /** Re-read a single book from the source, e.g. after a modify event.
   *  If the book is not yet in `entries` (a freshly-added file the user
   *  dragged in mid-session) we synthesise a fresh entry from the
   *  source's metadata. Watch 'added' events previously got dropped
   *  here when entries.size > 0. */
  async refreshBook(path: string): Promise<void> {
    const existing = [...this.entries.values()].find((entry) => entry.book.locator.path === path);
    if (existing) {
      const locator = existing.book.locator;
      let metadata = existing.book.metadata;
      try {
        metadata = await this.source.readMetadata(locator);
      } catch {
        metadata = null;
      }
      this.entries.set(existing.book.id, {
        book: { ...existing.book, metadata, sourceModifiedAt: locator.modifiedAt },
        reading: existing.reading
      });
      this.emit();
      return;
    }
    // Book not yet known — synthesize a locator and pull metadata from source.
    // Use the indexed `lookup()` (O(1)) instead of a full vault scan; the
    // previous `locateByPath` re-walked every entry on every 'added' event.
    const newFile = await this.source.lookup(path);
    if (!newFile) {
      // Source can't find the file; drop the event silently. The next
      // initialize() will pick it up if it's still around.
      return;
    }
    let metadata: BookMetadata | null = null;
    try {
      metadata = await this.source.readMetadata(newFile);
    } catch {
      metadata = null;
    }
    const id = this.source.resolveId(newFile);
    const reading = await this.getStoredReading(id);
    this.entries.set(id, {
      book: {
        id,
        locator: newFile,
        metadata,
        sourceModifiedAt: newFile.modifiedAt,
        addedToLibraryAt: null,
        coverPath: null,
        // refreshBook 走的是 lookup 路径, 不读 pinnedAtByBookId — 视为未 pin.
        // 重新打开 vault 时 doInitialize 会用最新的 setPinnedAt 覆盖这里.
        pinnedAt: null
      },
      reading: reading ?? {
        bookId: id,
        position: null,
        status: "unread",
        favorite: false,
        lastOpenedAt: null,
        totalReadingMs: 0
      }
    });
    this.emit();
  }

  private async getStoredReading(bookId: BookId): Promise<ReadingState | undefined> {
    const all = await this.annotations.listReading();
    return all.find((r) => r.bookId === bookId);
  }

  /** Persist a reading state change. */
  async updateReading(state: ReadingState): Promise<void> {
    await this.annotations.upsertReading(state);
    const existing = this.entries.get(state.bookId);
    if (existing) {
      this.entries.set(state.bookId, { book: existing.book, reading: state });
      this.emit();
    }
  }

  /** Apply a filter and sort, returning the slice the shelf renders. By default only
   *  books the user has explicitly added to the library are returned. Pass
   *  `includeUntracked: true` to surface discovered-but-unadded books as well. */
  list(
    filter: ShelfFilter = emptyFilter(),
    sort: SortCriterion = DEFAULT_SORT,
    includeUntracked = false
  ): ReadonlyArray<LibraryEntry> {
    const filtered = [...this.entries.values()].filter((entry) => {
      if (!includeUntracked && entry.book.addedToLibraryAt === null) return false;
      return matches(entry, filter);
    });
    filtered.sort((a, b) => compare(a, b, sort));
    return filtered;
  }

  /** Look up a single entry by id. */
  get(bookId: string): LibraryEntry | undefined {
    return this.entries.get(bookId);
  }

  /** Add a book to the user's library. Idempotent. */
  async addToLibrary(bookId: string, now = Date.now()): Promise<void> {
    const entry = this.entries.get(bookId);
    if (!entry) return;
    if (entry.book.addedToLibraryAt !== null) return;
    await this.annotations.addToLibrary(bookId);
    // Persist the original add timestamp so it survives vault reopens.
    await this.annotations.setAddedAt(bookId, now);
    this.entries.set(bookId, {
      book: { ...entry.book, addedToLibraryAt: now },
      reading: entry.reading
    });
    this.emit();
  }

  /** Add every currently-discovered book to the library. Idempotent. */
  async addAllToLibrary(now = Date.now()): Promise<number> {
    const ids = [...this.entries.values()].filter((entry) => entry.book.addedToLibraryAt === null).map((entry) => entry.book.id);
    if (ids.length === 0) return 0;
    // P0 修复: 之前 `Promise.all([...addToLibrary, ...setAddedAt])` 触发 2N
    // 个串行 mutate, 100 本书 = 200 个 saveData (~10s). 新方法把 add +
    // stamp 合并到 1 个 mutate — 100 本书降到 1 个 saveData (~50ms).
    await this.annotations.addToLibraryBatchWithStamp(ids, now);
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      this.entries.set(id, {
        book: { ...entry.book, addedToLibraryAt: now },
        reading: entry.reading
      });
    }
    this.emit();
    return ids.length;
  }

  /** Remove a book from the library. The underlying file stays in the Vault. */
  async removeFromLibrary(bookId: string): Promise<void> {
    const entry = this.entries.get(bookId);
    if (!entry || entry.book.addedToLibraryAt === null) return;
    await this.annotations.removeFromLibrary(bookId);
    this.entries.set(bookId, {
      book: { ...entry.book, addedToLibraryAt: null },
      reading: entry.reading
    });
    this.emit();
  }

  /**
   * Update a book's cover path. Called by the cover-extraction flow once
   * the user has opened the book and the engine has surfaced an image.
   */
  setCoverPath(bookId: string, coverPath: string | null): void {
    const entry = this.entries.get(bookId);
    if (!entry) return;
    if (entry.book.coverPath === coverPath) return;
    this.entries.set(bookId, {
      book: { ...entry.book, coverPath },
      reading: entry.reading
    });
    this.emit();
  }

  /**
   * Toggle the "pinned to top" flag for `bookId`. Idempotent: calling
   * when already pinned un-pins, and vice versa. Persists to the
   * annotation store and emits a single change event so the shelf
   * re-renders exactly once.
   */
  async togglePin(bookId: string, now = Date.now()): Promise<boolean> {
    const entry = this.entries.get(bookId);
    if (!entry) return false;
    const isPinned = entry.book.pinnedAt !== null;
    const nextPinnedAt = isPinned ? null : now;
    await this.annotations.setPinnedAt(bookId, nextPinnedAt);
    this.entries.set(bookId, {
      book: { ...entry.book, pinnedAt: nextPinnedAt },
      reading: entry.reading
    });
    this.emit();
    return nextPinnedAt !== null;
  }

  /** Aggregate stats the shelf toolbar shows (counts per status, languages, etc.). */
  stats(): LibraryStats {
    const statuses: Record<ReadingStatus, number> = {
      unread: 0,
      reading: 0,
      finished: 0,
      abandoned: 0
    };
    const languages = new Map<string, number>();
    let inLibrary = 0;
    for (const entry of this.entries.values()) {
      if (entry.book.addedToLibraryAt === null) continue;
      inLibrary += 1;
      statuses[entry.reading.status] += 1;
      for (const lang of entry.book.metadata?.languages ?? []) {
        languages.set(lang, (languages.get(lang) ?? 0) + 1);
      }
    }
    return { total: this.entries.size, inLibrary, statuses, languages };
  }

  /** Subscribe to data changes. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Tear down subscriptions and clear state. */
  dispose(): void {
    for (const d of this.sourceDisposables) d.dispose();
    this.sourceDisposables.length = 0;
    this.listeners.clear();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export interface LibraryStats {
  readonly total: number;
  readonly inLibrary: number;
  readonly statuses: Record<ReadingStatus, number>;
  readonly languages: ReadonlyMap<string, number>;
}

const matches = (entry: LibraryEntry, filter: ShelfFilter): boolean => {
  if (filter.query && filter.query.trim().length > 0) {
    if (!matchesQuery(entry, filter.query)) return false;
  }
  if (filter.statuses && filter.statuses.length > 0 && !filter.statuses.includes(entry.reading.status)) {
    return false;
  }
  if (filter.formats && filter.formats.length > 0 && !filter.formats.includes(entry.book.locator.format)) {
    return false;
  }
  if (filter.languages && filter.languages.length > 0) {
    const langs = entry.book.metadata?.languages ?? [];
    if (!langs.some((lang) => filter.languages!.includes(lang))) return false;
  }
  if (filter.progressBuckets && filter.progressBuckets.length > 0) {
    if (!filter.progressBuckets.includes(bucketFor(entry.reading))) return false;
  }
  if (filter.recency) {
    if (!matchesRecency(entry.reading.lastOpenedAt, filter.recency)) return false;
  }
  return true;
};

const matchesQuery = (entry: LibraryEntry, rawQuery: string): boolean => {
  const needle = rawQuery.trim().toLocaleLowerCase();
  if (!needle) return true;
  const haystack: string[] = [entry.book.metadata?.title ?? entry.book.locator.path];
  for (const author of entry.book.metadata?.authors ?? []) haystack.push(author);
  if (entry.book.metadata?.identifier) haystack.push(entry.book.metadata.identifier);
  return haystack.some((h) => h.toLocaleLowerCase().includes(needle));
};

const matchesRecency = (lastOpenedAt: number | null, bucket: RecencyBucket): boolean => {
  const now = Date.now();
  if (!lastOpenedAt) return bucket === "never";
  const dayMs = 24 * 60 * 60 * 1000;
  const elapsed = now - lastOpenedAt;
  switch (bucket) {
    case "today":
      return elapsed <= dayMs;
    case "thisWeek":
      return elapsed <= 7 * dayMs;
    case "thisMonth":
      return elapsed <= 30 * dayMs;
    case "older":
      return elapsed > 30 * dayMs;
    case "never":
      return false;
  }
};

export const bucketFor = (reading: ReadingState): ProgressBucket => {
  const fraction = progressFraction(reading);
  if (!reading.position || fraction === 0) return "untouched";
  if (fraction >= 0.95) return "finished";
  if (fraction >= 0.66) return "late";
  if (fraction >= 0.33) return "middle";
  return "early";
};

const compare = (a: LibraryEntry, b: LibraryEntry, sort: SortCriterion): number => {
  // Pinned books always sort before unpinned ones, regardless of the
  // active sort criterion. Within the pinned group we keep the chosen
  // criterion (so "title A→Z" still orders pinned titles alphabetically
  // if two books are pinned at the same timestamp; falls back to the
  // natural timestamp desc order otherwise).
  const ap = a.book.pinnedAt;
  const bp = b.book.pinnedAt;
  if (ap !== null && bp === null) return -1;
  if (ap === null && bp !== null) return 1;
  if (ap !== null && bp !== null && ap !== bp) return bp - ap;
  switch (sort) {
    case "titleAsc":
      return (a.book.metadata?.title ?? a.book.locator.path).localeCompare(
        b.book.metadata?.title ?? b.book.locator.path
      );
    case "titleDesc":
      return (b.book.metadata?.title ?? b.book.locator.path).localeCompare(
        a.book.metadata?.title ?? a.book.locator.path
      );
    case "authorAsc":
      return (a.book.metadata?.authors[0] ?? "").localeCompare(b.book.metadata?.authors[0] ?? "");
    case "addedDesc":
      return b.book.sourceModifiedAt - a.book.sourceModifiedAt;
    case "openedDesc":
      return (b.reading.lastOpenedAt ?? 0) - (a.reading.lastOpenedAt ?? 0);
    case "progressDesc":
      return progressFraction(b.reading) - progressFraction(a.reading);
  }
};