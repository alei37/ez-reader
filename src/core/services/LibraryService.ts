import type { Book, BookFormat } from "../entities/Book";
import type { ReadingState, ReadingStatus } from "../entities/ReadingState";
import type { AnnotationStore } from "../ports/AnnotationStore";
import type { BookSource } from "../ports/BookSource";
import {
  DEFAULT_SORT,
  emptyFilter,
  PROGRESS_BUCKETS,
  RECENCY_BUCKETS,
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

  constructor(
    private readonly source: BookSource,
    private readonly annotations: AnnotationStore
  ) {}

  /** Initial load: scan the source and join against stored reading state. */
  async initialize(): Promise<void> {
    const [reading, library] = await Promise.all([
      this.annotations.listReading(),
      this.annotations.listLibrary()
    ]);
    const readingByPath = new Map(reading.map((state) => [state.bookId, state]));
    const librarySet = new Set(library);

    const formats = new Set<BookFormat>(["epub", "mobi", "azw", "azw3", "txt", "pdf"]);
    for await (const locator of this.source.scan(formats)) {
      const id = this.source.resolveId(locator);
      let metadata = null;
      try {
        metadata = await this.source.readMetadata(locator);
      } catch {
        metadata = null;
      }
      const addedToLibraryAt = librarySet.has(id) ? Date.now() : null;
      const book: Book = {
        id,
        locator,
        metadata,
        sourceModifiedAt: locator.modifiedAt,
        addedToLibraryAt,
        coverPath: null
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
          // For added events, re-run the scan to surface the new file plus
          // any sibling files that Obsidian has just loaded. Refresh-on-id
          // would miss new entries.
          void this.initialize();
        } else {
          // "modified" only needs to refresh the one book we already know about.
          void this.refreshBook(event.path);
        }
      })
    );

    this.emit();
  }

  /** Re-read a single book from the source, e.g. after a modify event. */
  async refreshBook(path: string): Promise<void> {
    const existing = [...this.entries.values()].find((entry) => entry.book.locator.path === path);
    if (!existing) return;
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
    this.entries.set(bookId, {
      book: { ...entry.book, addedToLibraryAt: now },
      reading: entry.reading
    });
    this.emit();
  }

  /** Add every currently-discovered book to the library. Idempotent. */
  async addAllToLibrary(now = Date.now()): Promise<number> {
    const ids = [...this.entries.values()].filter((entry) => entry.book.addedToLibraryAt === null).map((entry) => entry.book.id);
    for (const id of ids) await this.annotations.addToLibrary(id);
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

export const BUCKETS = PROGRESS_BUCKETS;
export const RECENCY = RECENCY_BUCKETS;

const compare = (a: LibraryEntry, b: LibraryEntry, sort: SortCriterion): number => {
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