import { test } from "node:test";
import { strict as assert } from "node:assert";
import { LibraryService } from "../../src/core/services/LibraryService";
import type {
  AnnotationSnapshot,
  AnnotationStore
} from "../../src/core/ports/AnnotationStore";
import type {
  BookChangeHandler,
  BookSource
} from "../../src/core/ports/BookSource";
import type { BookLocator, BookMetadata, BookFormat, CoverImage } from "../../src/core/entities/Book";
import type { ReadingState } from "../../src/core/entities/ReadingState";
import type { BookInfo } from "../../src/core/entities/BookInfo";
import type { ReadingSession } from "../../src/core/entities/ReadingSession";
import type { Disposable } from "../../src/core/utils/Disposable";
import type { BookDirRef, LibraryWriter } from "../../src/core/ports/LibraryWriter";

// ---------------------------------------------------------------------------
// Test fakes (kept minimal — only what LibraryService + getRichEntry touch)
// ---------------------------------------------------------------------------

class FakeBookSource implements BookSource {
  readonly handlers: BookChangeHandler[] = [];
  readonly files: Array<{ locator: BookLocator; metadata: BookMetadata | null }>;

  constructor(files: Array<{ locator: BookLocator; metadata: BookMetadata | null }>) {
    this.files = files;
  }

  async *scan(_formats: ReadonlySet<BookFormat>): AsyncIterable<BookLocator> {
    for (const f of this.files) yield f.locator;
  }

  async read(locator: BookLocator): Promise<ArrayBuffer> {
    return new ArrayBuffer(locator.sizeBytes);
  }

  async readMetadata(locator: BookLocator): Promise<BookMetadata | null> {
    return this.files.find((f) => f.locator.path === locator.path)?.metadata ?? null;
  }

  async readCover(_locator: BookLocator): Promise<CoverImage | null> {
    return null;
  }

  watch(handler: BookChangeHandler): Disposable {
    this.handlers.push(handler);
    return { dispose: () => undefined };
  }

  resolveId(locator: BookLocator): string {
    return locator.path;
  }

  async resolveLocator(id: string): Promise<BookLocator | null> {
    return this.files.find((f) => f.locator.path === id)?.locator ?? null;
  }

  async lookup(path: string): Promise<BookLocator | null> {
    return this.files.find((f) => f.locator.path === path)?.locator ?? null;
  }
}

/** Minimal in-memory AnnotationStore — only the methods getRichEntry's
 *  upstream actually calls (loadRichMetadata + read state). */
class InMemoryAnnotationStore implements AnnotationStore {
  snapshot: AnnotationSnapshot;

  constructor(initial: Partial<AnnotationSnapshot> = {}) {
    this.snapshot = {
      version: 1,
      settings: initial.settings ?? {
        uiLocale: "en",
        translation: null,
        defaultAppearance: { fontSize: 100, lineHeight: 1.6, margin: 32, theme: "system", flow: "paginated" },
        notesDirectory: "",
        researchDirectory: "",
        libraryOwnerName: "",
        defaultNoteTemplate: "",
        readerOpenMode: "tab"
      },
      library: initial.library ?? [],
      reading: initial.reading ?? [],
      bookmarks: initial.bookmarks ?? [],
      excerpts: initial.excerpts ?? [],
      coverPaths: initial.coverPaths,
      addedAtByBookId: initial.addedAtByBookId,
      pinnedAtByBookId: initial.pinnedAtByBookId,
      onboardingDismissed: initial.onboardingDismissed
    };
  }

  async load(): Promise<AnnotationSnapshot> { return this.snapshot; }
  async save(snapshot: AnnotationSnapshot): Promise<void> { this.snapshot = snapshot; }
  async listLibrary(): Promise<ReadonlyArray<string>> { return this.snapshot.library; }
  async addToLibrary(bookId: string): Promise<void> {
    if (this.snapshot.library.includes(bookId)) return;
    this.snapshot = { ...this.snapshot, library: [...this.snapshot.library, bookId] };
  }
  async removeFromLibrary(bookId: string): Promise<void> {
    this.snapshot = { ...this.snapshot, library: this.snapshot.library.filter((id) => id !== bookId) };
  }
  async listReading(): Promise<ReadonlyArray<ReadingState>> { return this.snapshot.reading; }
  async upsertReading(state: ReadingState): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      reading: [...this.snapshot.reading.filter((s) => s.bookId !== state.bookId), state]
    };
  }
  async listBookmarks(): Promise<ReadonlyArray<never>> { return []; }
  async addBookmark(): Promise<void> {}
  async removeBookmark(): Promise<void> {}
  async listExcerpts(): Promise<ReadonlyArray<never>> { return []; }
  async addExcerpt(): Promise<void> {}
  async removeExcerpt(): Promise<void> {}
  async listSettings() { return this.snapshot.settings; }
  async saveSettings(settings: AnnotationSnapshot["settings"]): Promise<void> {
    this.snapshot = { ...this.snapshot, settings };
  }
  async patchSettings(patch: (s: AnnotationSnapshot["settings"]) => AnnotationSnapshot["settings"]): Promise<void> {
    this.snapshot = { ...this.snapshot, settings: patch(this.snapshot.settings) };
  }
  async loadCoverPaths(): Promise<Readonly<Record<string, string>>> { return this.snapshot.coverPaths ?? {}; }
  async saveCoverPaths(coverPaths: Record<string, string>): Promise<void> {
    this.snapshot = { ...this.snapshot, coverPaths };
  }
  async patchCoverPaths(patch: (paths: Record<string, string>) => Record<string, string>): Promise<void> {
    const current = this.snapshot.coverPaths ?? {};
    this.snapshot = { ...this.snapshot, coverPaths: patch(current) };
  }
  async getAddedAt(bookId: string): Promise<number | null> {
    return this.snapshot.addedAtByBookId?.[bookId] ?? null;
  }
  async setAddedAt(bookId: string, addedAt: number): Promise<void> {
    const current = this.snapshot.addedAtByBookId ?? {};
    if (current[bookId] !== undefined && current[bookId]! <= addedAt) return;
    this.snapshot = { ...this.snapshot, addedAtByBookId: { ...current, [bookId]: addedAt } };
  }
  async getPinnedAt(bookId: string): Promise<number | null> {
    return this.snapshot.pinnedAtByBookId?.[bookId] ?? null;
  }
  async setPinnedAt(bookId: string, pinnedAt: number | null): Promise<void> {
    const current = this.snapshot.pinnedAtByBookId ?? {};
    const next = { ...current };
    if (pinnedAt === null) delete next[bookId];
    else next[bookId] = pinnedAt;
    this.snapshot = { ...this.snapshot, pinnedAtByBookId: next };
  }
  async saveRichMetadata(bookId: string, metadata: BookMetadata): Promise<void> {
    const current = this.snapshot.richMetadataByBookId ?? {};
    this.snapshot = { ...this.snapshot, richMetadataByBookId: { ...current, [bookId]: metadata } };
  }
  async loadRichMetadata(_bookId: string): Promise<BookMetadata | null> { return null; }
  async addToLibraryBatchWithStamp(bookIds: ReadonlyArray<string>, addedAt: number): Promise<void> {
    const existingLibrary = new Set(this.snapshot.library);
    const existingAddedAt = this.snapshot.addedAtByBookId ?? {};
    const newIds = bookIds.filter((id) => !existingLibrary.has(id));
    if (newIds.length === 0) return;
    const library = [...this.snapshot.library, ...newIds];
    const addedAtByBookId = { ...existingAddedAt };
    for (const id of newIds) {
      if (addedAtByBookId[id] === undefined || addedAtByBookId[id]! > addedAt) {
        addedAtByBookId[id] = addedAt;
      }
    }
    this.snapshot = { ...this.snapshot, library, addedAtByBookId };
  }
  async markOnboardingDismissed(): Promise<void> {
    this.snapshot = { ...this.snapshot, onboardingDismissed: true };
  }
  async hasOnboardingBeenDismissed(): Promise<boolean> {
    return this.snapshot.onboardingDismissed === true;
  }
  async loadVisitedTocIds(bookId: string): Promise<ReadonlyArray<string>> {
    return this.snapshot.visitedTocIdsByBookId?.[bookId] ?? [];
  }
  async saveVisitedTocIds(bookId: string, ids: ReadonlyArray<string>): Promise<void> {
    const current = this.snapshot.visitedTocIdsByBookId ?? {};
    this.snapshot = { ...this.snapshot, visitedTocIdsByBookId: { ...current, [bookId]: [...ids] } };
  }
}

/**
 * Test double for LibraryWriter. We build this on top of an in-memory
 * backing object so each test can shape the result of readBookInfo and
 * loadReadingSessions without touching shared state.
 */
class FakeLibraryWriter implements LibraryWriter {
  /** bookId → BookInfo */
  bookInfos: Map<string, BookInfo | "throw"> = new Map();
  /** bookId → ReadingSession[] */
  sessions: Map<string, ReadonlyArray<ReadingSession>> = new Map();

  readBookInfoCalls = 0;
  loadReadingSessionsCalls = 0;

  async ensureBookDir(input: { bookId: string; bookTitle: string; bookPath: string }): Promise<BookDirRef> {
    return {
      bookId: input.bookId,
      title: input.bookTitle,
      bookPath: input.bookPath,
      notesPath: `notes/${input.bookId}.md`,
      infoPath: `info/${input.bookId}.md`,
      sessionsPath: `sessions/${input.bookId}.jsonl`
    };
  }
  async appendExcerpt(): Promise<void> {}
  async appendThought(): Promise<void> {}
  async writeBookInfo(): Promise<void> {}

  async readBookInfo(bookId: string): Promise<BookInfo | null> {
    this.readBookInfoCalls += 1;
    const v = this.bookInfos.get(bookId);
    if (v === "throw") throw new Error("fake readBookInfo failure");
    return v ?? null;
  }
  async appendReadingSession(): Promise<void> {}
  async loadReadingSessions(bookId: string): Promise<ReadonlyArray<ReadingSession>> {
    this.loadReadingSessionsCalls += 1;
    return this.sessions.get(bookId) ?? [];
  }
  async resolveExcerptLink(): Promise<null> { return null; }
  async migrateLegacyNotes(): Promise<{ migratedNotes: 0; failedNotes: 0; migratedBookIds: [] }> {
    return { migratedNotes: 0, failedNotes: 0, migratedBookIds: [] };
  }
}

const makeLocator = (path: string, format: BookFormat = "epub"): BookLocator => ({
  path,
  format,
  sizeBytes: 1024,
  modifiedAt: 1_700_000_000_000
});

const makeMetadata = (title: string, authors: string[] = []): BookMetadata => ({
  title,
  authors,
  languages: ["zh-CN"],
  cachedAt: 0
});

const makeBookInfo = (overrides: Partial<BookInfo> = {}): BookInfo => ({
  schemaVersion: 1,
  title: "Test",
  authors: [],
  bookId: "test",
  format: "epub",
  filePath: "test.epub",
  fileSizeBytes: 1024,
  fileModifiedAt: 1,
  addedToLibraryAt: 1,
  lastOpenedAt: null,
  status: "reading",
  progressFraction: 0.42,
  totalReadingMs: 0,
  excerptCount: 0,
  bookmarkCount: 0,
  thoughtCount: 0,
  favorite: false,
  pinnedAt: null,
  coverPath: null,
  updatedAt: 1,
  ...overrides
});

const session = (startedAt: Date, durationMs: number): ReadingSession => ({
  startedAt: startedAt.getTime(),
  endedAt: startedAt.getTime() + durationMs,
  durationMs,
  progressStart: 0,
  progressEnd: 0
});

// ===========================================================================
// getRichEntry
// ===========================================================================

test("getRichEntry: book not in entries → null", async () => {
  const source = new FakeBookSource([{ locator: makeLocator("books/a.epub"), metadata: makeMetadata("Alpha") }]);
  const store = new InMemoryAnnotationStore();
  const writer = new FakeLibraryWriter();
  const service = new LibraryService(source, store, undefined, undefined, writer);

  await service.initialize();

  const result = await service.getRichEntry("nonexistent-id");
  assert.equal(result, null);
});

test("getRichEntry: LibraryWriter undefined → RichLibraryEntry with zero analytics", async () => {
  const source = new FakeBookSource([{ locator: makeLocator("books/a.epub"), metadata: makeMetadata("Alpha") }]);
  const store = new InMemoryAnnotationStore();
  const service = new LibraryService(source, store); // no libraryWriter

  await service.initialize();
  await service.addToLibrary("books/a.epub");

  const result = await service.getRichEntry("books/a.epub");
  assert.ok(result, "should return RichLibraryEntry even without LibraryWriter");
  assert.equal(result.entry.book.id, "books/a.epub");
  // Analytics all 0 / empty
  assert.equal(result.dailyReadingTime.length, 0);
  assert.equal(result.recentSessions.length, 0);
  assert.equal(result.readingStreakDays, 0);
  assert.equal(result.todayReadingMs, 0);
  assert.equal(result.lastWeekReadingMs, 0);
  assert.equal(result.lastMonthReadingMs, 0);
  // bookInfo falls back to synthesized one — title from metadata
  assert.equal(result.bookInfo?.title, "Alpha");
});

test("getRichEntry: info.md missing → fallback (buildFallbackBookInfo)", async () => {
  const source = new FakeBookSource([{ locator: makeLocator("books/a.epub"), metadata: makeMetadata("Alpha", ["Bob"]) }]);
  const store = new InMemoryAnnotationStore();
  const writer = new FakeLibraryWriter();
  // writer has no bookInfo for this book — readBookInfo returns null
  const service = new LibraryService(source, store, undefined, undefined, writer);

  await service.initialize();
  await service.addToLibrary("books/a.epub");

  const result = await service.getRichEntry("books/a.epub");
  assert.ok(result);
  assert.ok(result.bookInfo, "fallback built");
  assert.equal(result.bookInfo?.title, "Alpha");
  assert.equal(result.bookInfo?.authors.length, 1);
  assert.equal(result.bookInfo?.authors[0], "Bob");
  assert.equal(result.bookInfo?.bookId, "books/a.epub");
});

test("getRichEntry: readBookInfo throws → fallback", async () => {
  const source = new FakeBookSource([{ locator: makeLocator("books/a.epub"), metadata: makeMetadata("Alpha") }]);
  const store = new InMemoryAnnotationStore();
  const writer = new FakeLibraryWriter();
  writer.bookInfos.set("books/a.epub", "throw"); // forces readBookInfo to throw
  const service = new LibraryService(source, store, undefined, undefined, writer);

  await service.initialize();
  await service.addToLibrary("books/a.epub");

  const result = await service.getRichEntry("books/a.epub");
  assert.ok(result);
  assert.equal(result.bookInfo?.title, "Alpha", "fallback used after readBookInfo throws");
});

test("getRichEntry: 3 sessions across 2 days → daily buckets aggregated correctly", async () => {
  const source = new FakeBookSource([{ locator: makeLocator("books/a.epub"), metadata: makeMetadata("Alpha") }]);
  const store = new InMemoryAnnotationStore();
  const writer = new FakeLibraryWriter();
  writer.bookInfos.set("books/a.epub", makeBookInfo({ title: "Analyzed Book" }));
  // 用 Date.now() 当 today (getRichEntry 不收 now 参数,内部用 Date.now())
  const now = Date.now();
  const todayMidnight = (() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  writer.sessions.set("books/a.epub", [
    session(new Date(todayMidnight + 9 * 60_000), 30 * 60_000),
    session(new Date(todayMidnight + 11 * 60_000), 45 * 60_000),
    session(new Date(todayMidnight - 1 * 24 * 60 * 60_000 + 14 * 60_000), 60 * 60_000) // yesterday
  ]);
  const service = new LibraryService(source, store, undefined, undefined, writer);

  await service.initialize();
  await service.addToLibrary("books/a.epub");

  const result = await service.getRichEntry("books/a.epub");
  assert.ok(result);
  // 30 days → 30 buckets, all zero except today + yesterday
  assert.equal(result.dailyReadingTime.length, 30);
  assert.equal(result.dailyReadingTime[0]?.totalMs, (30 + 45) * 60_000, "today has 75min");
  assert.equal(result.dailyReadingTime[0]?.sessionCount, 2);
  assert.equal(result.dailyReadingTime[1]?.totalMs, 60 * 60_000, "yesterday has 60min");
  assert.equal(result.dailyReadingTime[1]?.sessionCount, 1);
  // todayReadingMs is `daily[0].totalMs`
  assert.equal(result.todayReadingMs, 75 * 60_000);
});

test("getRichEntry: recentSessions capped at 10, newest-first", async () => {
  const source = new FakeBookSource([{ locator: makeLocator("books/a.epub"), metadata: makeMetadata("Alpha") }]);
  const store = new InMemoryAnnotationStore();
  const writer = new FakeLibraryWriter();
  const now = Date.now();
  // 15 sessions, oldest-first (跟 loadReadingSessions 真实 jsonl 读取顺序一致).
  // slice(-10).reverse() 取最后 10 条 → 反转得 newest-first.
  const sessions: ReadingSession[] = [];
  for (let i = 14; i >= 0; i -= 1) {
    sessions.push(session(new Date(now - i * 60_000), 5 * 60_000));
  }
  writer.sessions.set("books/a.epub", sessions);
  const service = new LibraryService(source, store, undefined, undefined, writer);

  await service.initialize();
  await service.addToLibrary("books/a.epub");

  const result = await service.getRichEntry("books/a.epub");
  assert.ok(result);
  assert.equal(result.recentSessions.length, 10, "capped at 10");
  // 15 sessions oldest-first ([now-14, ..., now]) →
  // slice(-10) = [now-9, now-8, ..., now] →
  // reverse() = [now, now-1, ..., now-9]
  assert.equal(result.recentSessions[0]?.startedAt, now, "newest at index 0");
  assert.equal(result.recentSessions[9]?.startedAt, now - 9 * 60_000, "oldest of last 10 at index 9");
});

test("getRichEntry: readingStreakDays correct", async () => {
  const source = new FakeBookSource([{ locator: makeLocator("books/a.epub"), metadata: makeMetadata("Alpha") }]);
  const store = new InMemoryAnnotationStore();
  const writer = new FakeLibraryWriter();
  const now = Date.now();
  const todayMidnight = (() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  // 今天空,昨天 2 session,前天 1 — streak = 2 (skip-today allowed)
  writer.sessions.set("books/a.epub", [
    session(new Date(todayMidnight - 1 * 24 * 60 * 60_000 + 9 * 60_000), 30 * 60_000),
    session(new Date(todayMidnight - 1 * 24 * 60 * 60_000 + 14 * 60_000), 60 * 60_000),
    session(new Date(todayMidnight - 2 * 24 * 60 * 60_000 + 10 * 60_000), 15 * 60_000)
  ]);
  const service = new LibraryService(source, store, undefined, undefined, writer);
  await service.initialize();
  await service.addToLibrary("books/a.epub");

  const result = await service.getRichEntry("books/a.epub");
  assert.ok(result);
  assert.equal(result.readingStreakDays, 2, "today empty, yesterday + day-before have data → 2");
});

test("getRichEntry: lastWeekReadingMs sums first 7 buckets", async () => {
  const source = new FakeBookSource([{ locator: makeLocator("books/a.epub"), metadata: makeMetadata("Alpha") }]);
  const store = new InMemoryAnnotationStore();
  const writer = new FakeLibraryWriter();
  const now = Date.now();
  const todayMidnight = (() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  writer.sessions.set("books/a.epub", [
    session(new Date(todayMidnight + 9 * 60_000), 30 * 60_000), // today
    session(new Date(todayMidnight - 3 * 24 * 60 * 60_000 + 9 * 60_000), 50 * 60_000), // 3 days ago
    session(new Date(todayMidnight - 10 * 24 * 60 * 60_000 + 9 * 60_000), 200 * 60_000) // 10 days ago (outside 7-day window)
  ]);
  const service = new LibraryService(source, store, undefined, undefined, writer);

  await service.initialize();
  await service.addToLibrary("books/a.epub");

  const result = await service.getRichEntry("books/a.epub");
  assert.ok(result);
  // lastWeekReadingMs = sum of daily[0..6] → 30 + 50 = 80min
  assert.equal(result.lastWeekReadingMs, (30 + 50) * 60_000);
  // lastMonthReadingMs = all 30 buckets → 30 + 50 + 200 = 280min
  assert.equal(result.lastMonthReadingMs, (30 + 50 + 200) * 60_000);
});

test("getRichEntry: loadReadingSessions returns empty → analytics zeros", async () => {
  const source = new FakeBookSource([{ locator: makeLocator("books/a.epub"), metadata: makeMetadata("Alpha") }]);
  const store = new InMemoryAnnotationStore();
  const writer = new FakeLibraryWriter();
  writer.bookInfos.set("books/a.epub", makeBookInfo());
  // writer.sessions has no entry for this book → loadReadingSessions returns []
  const service = new LibraryService(source, store, undefined, undefined, writer);

  await service.initialize();
  await service.addToLibrary("books/a.epub");

  const result = await service.getRichEntry("books/a.epub");
  assert.ok(result);
  // 30 zero-buckets are still produced (aggregateDailyReadingTime fills gaps)
  assert.equal(result.dailyReadingTime.length, 30);
  for (const bucket of result.dailyReadingTime) {
    assert.equal(bucket.totalMs, 0);
  }
  assert.equal(result.todayReadingMs, 0);
  assert.equal(result.lastWeekReadingMs, 0);
  assert.equal(result.lastMonthReadingMs, 0);
  assert.equal(result.readingStreakDays, 0);
});