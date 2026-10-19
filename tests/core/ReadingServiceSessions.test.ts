import { test } from "node:test";
import { strict as assert } from "node:assert";
import { ReadingService } from "../../src/core/services/ReadingService";
import type { AnnotationSnapshot, AnnotationStore } from "../../src/core/ports/AnnotationStore";
import type { Bookmark } from "../../src/core/entities/Bookmark";
import type { BookMetadata } from "../../src/core/entities/Book";
import type { Excerpt } from "../../src/core/entities/Excerpt";
import type { ReadingState } from "../../src/core/entities/ReadingState";
import type { ReadingSession } from "../../src/core/entities/ReadingSession";
import type { BookDirRef, LibraryWriter } from "../../src/core/ports/LibraryWriter";
import type { PluginSettings } from "../../src/core/types/ReaderSettings";
import { renameInSnapshot } from "../../src/core/utils/renameSnapshot";

/** Minimal in-memory AnnotationStore (mirrors the one in
 *  LibraryServiceRichEntry.test.ts — only used by ReadingService's state
 *  methods; analytics methods go through LibraryWriter). */
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
      richMetadataByBookId: initial.richMetadataByBookId,
      visitedTocIdsByBookId: initial.visitedTocIdsByBookId,
      onboardingDismissed: initial.onboardingDismissed,
      migratedToV030: initial.migratedToV030,
      migratedToV030Attempts: initial.migratedToV030Attempts
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
      reading: [...this.snapshot.reading.filter((r) => r.bookId !== state.bookId), state]
    };
  }

  // 端口漂移修复: 以前签名写的是 `(current: undefined) => unknown`, 跟端口
  // 的 `(current: ReadingState | undefined) => ReadingState | null` 对不上 ——
  // `implements AnnotationStore` 一直是假的. 这里改成跟端口一致, 并且真的
  // 走 read-modify-write (读当前状态 → 交给 patch → 写回).
  async patchReading(
    bookId: string,
    patch: (current: ReadingState | undefined) => ReadingState | null
  ): Promise<void> {
    const current = this.snapshot.reading.find((r) => r.bookId === bookId);
    const next = patch(current);
    if (next === null) return;
    this.snapshot = {
      ...this.snapshot,
      reading: [...this.snapshot.reading.filter((r) => r.bookId !== bookId), next]
    };
  }

  async listBookmarks(bookId: string): Promise<ReadonlyArray<Bookmark>> {
    return this.snapshot.bookmarks.filter((b) => b.bookId === bookId);
  }
  async addBookmark(bookmark: Bookmark): Promise<void> {
    this.snapshot = { ...this.snapshot, bookmarks: [...this.snapshot.bookmarks, bookmark] };
  }
  async removeBookmark(bookId: string, bookmarkId: string): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      bookmarks: this.snapshot.bookmarks.filter((b) => !(b.bookId === bookId && b.id === bookmarkId))
    };
  }
  async listExcerpts(bookId: string): Promise<ReadonlyArray<Excerpt>> {
    return this.snapshot.excerpts.filter((e) => e.bookId === bookId);
  }
  async addExcerpt(excerpt: Excerpt): Promise<void> {
    this.snapshot = { ...this.snapshot, excerpts: [...this.snapshot.excerpts, excerpt] };
  }
  async removeExcerpt(bookId: string, excerptId: string): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      excerpts: this.snapshot.excerpts.filter((e) => !(e.bookId === bookId && e.id === excerptId))
    };
  }
  /** 只 patch note / tags, 其余字段保持原值. */
  async updateExcerptNote(
    bookId: string,
    excerptId: string,
    patch: { note?: string; tags?: ReadonlyArray<string> }
  ): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      excerpts: this.snapshot.excerpts.map((e) => {
        if (e.bookId !== bookId || e.id !== excerptId) return e;
        return {
          ...e,
          ...(patch.note !== undefined ? { note: patch.note } : {}),
          ...(patch.tags !== undefined ? { tags: patch.tags } : {})
        };
      })
    };
  }
  async listSettings(): Promise<PluginSettings> { return this.snapshot.settings; }
  async saveSettings(settings: PluginSettings): Promise<void> {
    this.snapshot = { ...this.snapshot, settings };
  }
  async patchSettings(patch: (s: PluginSettings) => PluginSettings): Promise<void> {
    this.snapshot = { ...this.snapshot, settings: patch(this.snapshot.settings) };
  }
  async loadCoverPaths(): Promise<Readonly<Record<string, string>>> { return this.snapshot.coverPaths ?? {}; }
  async saveCoverPaths(coverPaths: Record<string, string>): Promise<void> {
    this.snapshot = { ...this.snapshot, coverPaths };
  }
  async patchCoverPaths(patch: (paths: Record<string, string>) => Record<string, string>): Promise<void> {
    this.snapshot = { ...this.snapshot, coverPaths: patch(this.snapshot.coverPaths ?? {}) };
  }
  async getAddedAt(bookId: string): Promise<number | null> {
    return this.snapshot.addedAtByBookId?.[bookId] ?? null;
  }
  async setAddedAt(bookId: string, addedAt: number): Promise<void> {
    const current = this.snapshot.addedAtByBookId ?? {};
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

  // 端口漂移修复: 以前签名写的是 `(current: null) => null`, 跟端口的
  // `(current: number | null) => number | null` 对不上. 改成一致并真的写回.
  async patchPinnedAt(bookId: string, patch: (current: number | null) => number | null): Promise<void> {
    const currentMap = this.snapshot.pinnedAtByBookId ?? {};
    const nextValue = patch(currentMap[bookId] ?? null);
    const next = { ...currentMap };
    if (nextValue === null) delete next[bookId];
    else next[bookId] = nextValue;
    this.snapshot = { ...this.snapshot, pinnedAtByBookId: next };
  }

  async saveRichMetadata(bookId: string, metadata: BookMetadata): Promise<void> {
    const current = this.snapshot.richMetadataByBookId ?? {};
    this.snapshot = { ...this.snapshot, richMetadataByBookId: { ...current, [bookId]: metadata } };
  }
  async loadRichMetadata(bookId: string): Promise<BookMetadata | null> {
    return this.snapshot.richMetadataByBookId?.[bookId] ?? null;
  }
  async addToLibraryBatchWithStamp(bookIds: ReadonlyArray<string>, addedAt: number): Promise<void> {
    const existing = new Set(this.snapshot.library);
    const newIds = bookIds.filter((id) => !existing.has(id));
    if (newIds.length === 0) return;
    const addedAtByBookId = { ...(this.snapshot.addedAtByBookId ?? {}) };
    for (const id of newIds) {
      if (addedAtByBookId[id] === undefined || addedAtByBookId[id]! > addedAt) {
        addedAtByBookId[id] = addedAt;
      }
    }
    this.snapshot = {
      ...this.snapshot,
      library: [...this.snapshot.library, ...newIds],
      addedAtByBookId
    };
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
  /** 复用 core 的纯函数, 跟真 adapter 走同一条 re-key 路径. */
  async renameBookId(fromBookId: string, toBookId: string): Promise<void> {
    this.snapshot = renameInSnapshot(this.snapshot, fromBookId, toBookId);
  }
  /** 迁移标记写在 snapshot 顶层 (不是 settings 里), 跟真 adapter 一致. */
  async setMigratedToV030(passed: boolean, attempts?: number): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      migratedToV030: passed,
      ...(attempts === undefined ? {} : { migratedToV030Attempts: attempts })
    };
  }
}

/** Test double for LibraryWriter with explicit counters so we can verify
 *  call order and arguments without spawning real adapters. */
class FakeLibraryWriter implements LibraryWriter {
  ensureBookDirCalls: Array<{ bookId: string; bookTitle: string; bookPath: string }> = [];
  appendReadingSessionCalls: Array<{ ref: BookDirRef; session: ReadingSession }> = [];
  /** Pre-canned sessions returned by loadReadingSessions. */
  sessions: ReadonlyArray<ReadingSession> = [];
  /** If set, loadReadingSessions throws. */
  loadSessionsError: Error | null = null;
  /** If set, appendReadingSession throws. */
  appendError: Error | null = null;

  async ensureBookDir(input: { bookId: string; bookTitle: string; bookPath: string }): Promise<BookDirRef> {
    this.ensureBookDirCalls.push(input);
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
  async readBookInfo(): Promise<null> { return null; }
  async appendReadingSession(ref: BookDirRef, session: ReadingSession): Promise<void> {
    if (this.appendError) throw this.appendError;
    this.appendReadingSessionCalls.push({ ref, session });
  }
  async loadReadingSessions(_bookId: string): Promise<ReadonlyArray<ReadingSession>> {
    if (this.loadSessionsError) throw this.loadSessionsError;
    return this.sessions;
  }
  async resolveExcerptLink(): Promise<null> { return null; }
  async migrateLegacyNotes(): Promise<{ migratedNotes: 0; failedNotes: 0; migratedBookIds: [] }> {
    return { migratedNotes: 0, failedNotes: 0, migratedBookIds: [] };
  }
  async renameBookFiles(): Promise<{ moved: []; missing: [] }> {
    return { moved: [], missing: [] };
  }
}

const makeSession = (durationMs: number, chapter?: string): ReadingSession => {
  const now = Date.now();
  return {
    startedAt: now,
    endedAt: now + durationMs,
    durationMs,
    progressStart: 0,
    progressEnd: 0,
    chapter
  };
};

// ===========================================================================
// recordSession
// ===========================================================================

test("recordSession: durationMs <= 0 → no-op (no ensureBookDir / appendReadingSession calls)", async () => {
  const writer = new FakeLibraryWriter();
  const service = new ReadingService(new InMemoryAnnotationStore(), undefined, writer);

  await service.recordSession("book-x", makeSession(0));
  await service.recordSession("book-x", makeSession(-1000));

  assert.equal(writer.ensureBookDirCalls.length, 0, "ensureBookDir not invoked");
  assert.equal(writer.appendReadingSessionCalls.length, 0, "appendReadingSession not invoked");
});

test("recordSession: durationMs > 0 → ensureBookDir + appendReadingSession both called in order", async () => {
  const writer = new FakeLibraryWriter();
  const service = new ReadingService(new InMemoryAnnotationStore(), undefined, writer);

  const session = makeSession(30 * 60_000, "Chapter 3");
  await service.recordSession("book-x", session);

  assert.equal(writer.ensureBookDirCalls.length, 1, "ensureBookDir called once");
  assert.equal(writer.appendReadingSessionCalls.length, 1, "appendReadingSession called once");

  // Order matters — ref from ensureBookDir is passed into append
  assert.equal(writer.appendReadingSessionCalls[0]?.ref.bookId, "book-x");
  assert.equal(writer.appendReadingSessionCalls[0]?.session.durationMs, 30 * 60_000);
});

test("recordSession: LibraryWriter undefined → no-op (no throw)", async () => {
  const service = new ReadingService(new InMemoryAnnotationStore());
  // 无 libraryWriter — 应静默 no-op,不 throw
  await service.recordSession("book-x", makeSession(30 * 60_000));
  // 不应崩溃
});

test("recordSession: appendReadingSession throws → console.warn, no rethrow", async () => {
  const writer = new FakeLibraryWriter();
  writer.appendError = new Error("disk full");
  // capture warnings
  const warns: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args.map(String).join(" "));
  };
  try {
    const service = new ReadingService(new InMemoryAnnotationStore(), undefined, writer);
    // 不应 throw
    await service.recordSession("book-x", makeSession(30 * 60_000));
    assert.ok(
      warns.some((w) => w.includes("recordSession failed")),
      `expected a recordSession warn; got: ${JSON.stringify(warns)}`
    );
  } finally {
    console.warn = originalWarn;
  }
});

test("recordSession: chapter undefined falls back to bookId in ensureBookDir input", async () => {
  // recordSession passes `session.chapter ?? bookId` as bookTitle.
  const writer = new FakeLibraryWriter();
  const service = new ReadingService(new InMemoryAnnotationStore(), undefined, writer);

  const s = makeSession(60_000);
  // chapter is undefined here
  await service.recordSession("book-y", s);

  assert.equal(writer.ensureBookDirCalls[0]?.bookTitle, "book-y", "bookTitle falls back to bookId when chapter is missing");
});

// ===========================================================================
// getDailyReadingTime
// ===========================================================================

test("getDailyReadingTime: LibraryWriter undefined → empty array", async () => {
  const service = new ReadingService(new InMemoryAnnotationStore());
  const result = await service.getDailyReadingTime("book-x", 7);
  assert.deepEqual(result, []);
});

test("getDailyReadingTime: sessions empty → returns `days` zero-buckets", async () => {
  const writer = new FakeLibraryWriter();
  writer.sessions = [];
  const service = new ReadingService(new InMemoryAnnotationStore(), undefined, writer);

  const result = await service.getDailyReadingTime("book-x", 7);
  assert.equal(result.length, 7);
  for (const bucket of result) {
    assert.equal(bucket.totalMs, 0);
    assert.equal(bucket.sessionCount, 0);
  }
});

test("getDailyReadingTime: sessions present → aggregated", async () => {
  const writer = new FakeLibraryWriter();
  const now = Date.now();
  writer.sessions = [
    { startedAt: now, endedAt: now, durationMs: 30 * 60_000, progressStart: 0, progressEnd: 0 }
  ];
  const service = new ReadingService(new InMemoryAnnotationStore(), undefined, writer);

  const result = await service.getDailyReadingTime("book-x", 7);
  assert.equal(result.length, 7);
  // Today is index 0 (newest-first)
  assert.equal(result[0]?.totalMs, 30 * 60_000);
  assert.equal(result[0]?.sessionCount, 1);
});

test("getDailyReadingTime: loadReadingSessions throws → empty array + console.warn", async () => {
  const writer = new FakeLibraryWriter();
  writer.loadSessionsError = new Error("file corrupted");
  const warns: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args.map(String).join(" "));
  };
  try {
    const service = new ReadingService(new InMemoryAnnotationStore(), undefined, writer);
    const result = await service.getDailyReadingTime("book-x", 7);
    assert.deepEqual(result, [], "returns empty array on failure");
    assert.ok(
      warns.some((w) => w.includes("loadReadingSessions failed")),
      `expected a loadReadingSessions warn; got: ${JSON.stringify(warns)}`
    );
  } finally {
    console.warn = originalWarn;
  }
});

test("getDailyReadingTime: days parameter respected (1, 7, 30)", async () => {
  const writer = new FakeLibraryWriter();
  writer.sessions = [];
  const service = new ReadingService(new InMemoryAnnotationStore(), undefined, writer);

  assert.equal((await service.getDailyReadingTime("book-x", 1)).length, 1);
  assert.equal((await service.getDailyReadingTime("book-x", 7)).length, 7);
  assert.equal((await service.getDailyReadingTime("book-x", 30)).length, 30);
  assert.equal((await service.getDailyReadingTime("book-x", 0)).length, 0);
});