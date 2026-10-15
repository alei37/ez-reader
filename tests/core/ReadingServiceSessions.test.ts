import { test } from "node:test";
import { strict as assert } from "node:assert";
import { ReadingService } from "../../src/core/services/ReadingService";
import type {
  AnnotationSnapshot,
  AnnotationStore
} from "../../src/core/ports/AnnotationStore";
import type { ReadingSession } from "../../src/core/entities/ReadingSession";
import type { BookDirRef, LibraryWriter } from "../../src/core/ports/LibraryWriter";

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
      excerpts: initial.excerpts ?? []
    };
  }

  async load(): Promise<AnnotationSnapshot> { return this.snapshot; }
  async save(snapshot: AnnotationSnapshot): Promise<void> { this.snapshot = snapshot; }
  async listLibrary(): Promise<ReadonlyArray<string>> { return this.snapshot.library; }
  async addToLibrary(): Promise<void> {}
  async removeFromLibrary(): Promise<void> {}
  async listReading(): Promise<ReadonlyArray<never>> { return []; }
  async upsertReading(): Promise<void> {}
  async patchReading(
    _bookId: string,
    patch: (current: undefined) => unknown
  ): Promise<void> {
    patch(undefined);
  }

  async listBookmarks(): Promise<ReadonlyArray<never>> { return []; }
  async addBookmark(): Promise<void> {}
  async removeBookmark(): Promise<void> {}
  async listExcerpts(): Promise<ReadonlyArray<never>> { return []; }
  async addExcerpt(): Promise<void> {}
  async removeExcerpt(): Promise<void> {}
  async listSettings() { return this.snapshot.settings; }
  async saveSettings(): Promise<void> {}
  async patchSettings(): Promise<void> {}
  async loadCoverPaths(): Promise<Readonly<Record<string, string>>> { return {}; }
  async saveCoverPaths(): Promise<void> {}
  async patchCoverPaths(): Promise<void> {}
  async getAddedAt(): Promise<number | null> { return null; }
  async setAddedAt(): Promise<void> {}
  async getPinnedAt(): Promise<number | null> { return null; }
  async setPinnedAt(): Promise<void> {}
  async saveRichMetadata(): Promise<void> {}
  async loadRichMetadata(): Promise<null> { return null; }
  async addToLibraryBatchWithStamp(): Promise<void> {}
  async markOnboardingDismissed(): Promise<void> {}
  async hasOnboardingBeenDismissed(): Promise<boolean> { return false; }
  async loadVisitedTocIds(): Promise<ReadonlyArray<string>> { return []; }
  async saveVisitedTocIds(): Promise<void> {}
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