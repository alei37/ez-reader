import { test } from "node:test";
import { strict as assert } from "node:assert";

import { LibraryService, type LibraryEntry } from "../../src/core/services/LibraryService";
import type {
  AnnotationSnapshot,
  AnnotationStore
} from "../../src/core/ports/AnnotationStore";
import type { BookLocator, BookMetadata, CoverImage, BookFormat } from "../../src/core/entities/Book";
import type { ReadingState } from "../../src/core/entities/ReadingState";
import type {
  BookChangeHandler,
  BookSource
} from "../../src/core/ports/BookSource";
import type { Disposable } from "../../src/core/utils/Disposable";

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
}

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
      onboardingDismissed: initial.onboardingDismissed
    };
  }

  async load(): Promise<AnnotationSnapshot> {
    return this.snapshot;
  }
  async save(snapshot: AnnotationSnapshot): Promise<void> {
    this.snapshot = snapshot;
  }
  async listLibrary(): Promise<ReadonlyArray<string>> {
    return this.snapshot.library;
  }
  async addToLibrary(bookId: string): Promise<void> {
    if (this.snapshot.library.includes(bookId)) return;
    this.snapshot = { ...this.snapshot, library: [...this.snapshot.library, bookId] };
  }
  async removeFromLibrary(bookId: string): Promise<void> {
    this.snapshot = { ...this.snapshot, library: this.snapshot.library.filter((id) => id !== bookId) };
  }
  async listReading(): Promise<ReadonlyArray<ReadingState>> {
    return this.snapshot.reading;
  }
  async upsertReading(state: ReadingState): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      reading: [...this.snapshot.reading.filter((s) => s.bookId !== state.bookId), state]
    };
  }
  async listBookmarks(): Promise<ReadonlyArray<never>> {
    return [];
  }
  async addBookmark(): Promise<void> {
    /* noop */
  }
  async removeBookmark(): Promise<void> {
    /* noop */
  }
  async listExcerpts(): Promise<ReadonlyArray<never>> {
    return [];
  }
  async addExcerpt(): Promise<void> {
    /* noop */
  }
  async removeExcerpt(): Promise<void> {
    /* noop */
  }
  async listSettings() {
    return this.snapshot.settings;
  }
  async saveSettings(settings: AnnotationSnapshot["settings"]): Promise<void> {
    this.snapshot = { ...this.snapshot, settings };
  }
  async patchSettings(patch: (s: AnnotationSnapshot["settings"]) => AnnotationSnapshot["settings"]): Promise<void> {
    this.snapshot = { ...this.snapshot, settings: patch(this.snapshot.settings) };
  }
  async loadCoverPaths(): Promise<Readonly<Record<string, string>>> {
    return this.snapshot.coverPaths ?? {};
  }
  async saveCoverPaths(coverPaths: Record<string, string>): Promise<void> {
    this.snapshot = { ...this.snapshot, coverPaths };
  }
  async getAddedAt(bookId: string): Promise<number | null> {
    return this.snapshot.addedAtByBookId?.[bookId] ?? null;
  }
  async setAddedAt(bookId: string, addedAt: number): Promise<void> {
    const current = this.snapshot.addedAtByBookId ?? {};
    if (current[bookId] !== undefined && current[bookId]! <= addedAt) return;
    this.snapshot = {
      ...this.snapshot,
      addedAtByBookId: { ...current, [bookId]: addedAt }
    };
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
  // P0-2: 测试 mock 也实现 rich metadata 接口, 让 doInitialize 走
  // filename-fallback (mock 默认没 rich metadata) 路径保持原行为.
  async saveRichMetadata(bookId: string, metadata: BookMetadata): Promise<void> {
    const current = this.snapshot.richMetadataByBookId ?? {};
    this.snapshot = { ...this.snapshot, richMetadataByBookId: { ...current, [bookId]: metadata } };
  }
  async loadRichMetadata(bookId: string): Promise<BookMetadata | null> {
    return this.snapshot.richMetadataByBookId?.[bookId] ?? null;
  }
  async getAddedAt(bookId: string): Promise<number | null> {
    return this.snapshot.addedAtByBookId?.[bookId] ?? null;
  }
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
}

const makeLocator = (path: string, format: BookFormat = "epub"): BookLocator => ({
  path,
  format,
  sizeBytes: 1024,
  modifiedAt: 1_700_000_000_000
});

const makeMetadata = (title: string, authors: string[] = [], languages: string[] = []): BookMetadata => ({
  title,
  authors,
  languages,
  cachedAt: 0
});

test("LibraryService.initialize joins book locators with stored reading states", async () => {
  const fileA = { locator: makeLocator("books/a.epub"), metadata: makeMetadata("Alpha", ["Alice"], ["en"]) };
  const fileB = { locator: makeLocator("books/b.epub"), metadata: makeMetadata("Beta", ["Bob"], ["zh-CN"]) };
  const source = new FakeBookSource([fileA, fileB]);
  const store = new InMemoryAnnotationStore();
  const service = new LibraryService(source, store);

  await service.initialize();
  await service.addAllToLibrary();

  const entries = service.list();
  assert.equal(entries.length, 2);
  const titles = entries.map((entry) => entry.book.metadata?.title);
  assert.deepEqual(titles.sort(), ["Alpha", "Beta"]);
});

test("LibraryService.list applies filter by status", async () => {
  const files = [
    { locator: makeLocator("a.epub"), metadata: makeMetadata("A") },
    { locator: makeLocator("b.epub"), metadata: makeMetadata("B") }
  ];
  const source = new FakeBookSource(files);
  const store = new InMemoryAnnotationStore();
  const service = new LibraryService(source, store);
  await service.initialize();
  await service.addAllToLibrary();

  await service.updateReading({
    bookId: "a.epub",
    position: { kind: "reflow", fraction: 0.5 },
    status: "reading",
    favorite: false,
    lastOpenedAt: Date.now(),
    totalReadingMs: 0
  });

  const reading = service.list({ statuses: ["reading"] });
  assert.equal(reading.length, 1);
  assert.equal(reading[0]?.book.locator.path, "a.epub");
});

test("LibraryService.list applies progress buckets", async () => {
  const files = [
    { locator: makeLocator("a.epub"), metadata: makeMetadata("A") },
    { locator: makeLocator("b.epub"), metadata: makeMetadata("B") }
  ];
  const source = new FakeBookSource(files);
  const store = new InMemoryAnnotationStore();
  const service = new LibraryService(source, store);
  await service.initialize();
  await service.addAllToLibrary();

  await service.updateReading({
    bookId: "a.epub",
    position: { kind: "reflow", fraction: 0.5 },
    status: "reading",
    favorite: false,
    lastOpenedAt: null,
    totalReadingMs: 0
  });
  await service.updateReading({
    bookId: "b.epub",
    position: { kind: "reflow", fraction: 0.95 },
    status: "finished",
    favorite: false,
    lastOpenedAt: null,
    totalReadingMs: 0
  });

  const finished = service.list({ progressBuckets: ["finished"] });
  assert.equal(finished.length, 1);
  assert.equal(finished[0]?.book.locator.path, "b.epub");
});

test("LibraryService.list applies recency bucket", async () => {
  const files = [
    { locator: makeLocator("a.epub"), metadata: makeMetadata("A") }
  ];
  const source = new FakeBookSource(files);
  const store = new InMemoryAnnotationStore();
  const service = new LibraryService(source, store);
  await service.initialize();
  await service.addAllToLibrary();

  await service.updateReading({
    bookId: "a.epub",
    position: null,
    status: "unread",
    favorite: false,
    lastOpenedAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
    totalReadingMs: 0
  });

  const older = service.list({ recency: "older" });
  assert.equal(older.length, 1);

  const thisMonth = service.list({ recency: "thisMonth" });
  assert.equal(thisMonth.length, 0);
});

test("LibraryService.list sorts by addedDesc by default", async () => {
  const old = { locator: { ...makeLocator("old.epub"), modifiedAt: 1 }, metadata: makeMetadata("Old") };
  const recent = { locator: { ...makeLocator("new.epub"), modifiedAt: 2 }, metadata: makeMetadata("New") };
  const service = new LibraryService(new FakeBookSource([old, recent]), new InMemoryAnnotationStore());
  await service.initialize();
  await service.addAllToLibrary();

  const entries = service.list();
  assert.equal(entries[0]?.book.locator.path, "new.epub");
  assert.equal(entries[1]?.book.locator.path, "old.epub");
});

test("LibraryService.subscribe fires after updateReading", async () => {
  const source = new FakeBookSource([{ locator: makeLocator("a.epub"), metadata: makeMetadata("A") }]);
  const store = new InMemoryAnnotationStore();
  const service = new LibraryService(source, store);
  await service.initialize();
  await service.addToLibrary("a.epub");

  let fires = 0;
  service.subscribe(() => {
    fires += 1;
  });

  await service.updateReading({
    bookId: "a.epub",
    position: { kind: "reflow", fraction: 0.1 },
    status: "reading",
    favorite: false,
    lastOpenedAt: Date.now(),
    totalReadingMs: 0
  });

  assert.equal(fires, 1);
});

test("LibraryService.stats reports counts per status", async () => {
  const source = new FakeBookSource([
    { locator: makeLocator("a.epub"), metadata: makeMetadata("A") },
    { locator: makeLocator("b.epub"), metadata: makeMetadata("B") }
  ]);
  const service = new LibraryService(source, new InMemoryAnnotationStore());
  await service.initialize();
  await service.addAllToLibrary();

  const stats = service.stats();
  assert.equal(stats.total, 2);
  assert.equal(stats.inLibrary, 2);
  assert.equal(stats.statuses.unread, 2);
});

test("LibraryService.addToLibrary and removeFromLibrary gate list()", async () => {
  const source = new FakeBookSource([
    { locator: makeLocator("a.epub"), metadata: makeMetadata("A") },
    { locator: makeLocator("b.epub"), metadata: makeMetadata("B") }
  ]);
  const service = new LibraryService(source, new InMemoryAnnotationStore());
  await service.initialize();
  assert.equal(service.list().length, 0, "library starts empty until the user opts in");

  await service.addToLibrary("a.epub");
  assert.equal(service.list().length, 1);

  await service.addAllToLibrary();
  assert.equal(service.list().length, 2);

  await service.removeFromLibrary("a.epub");
  const remaining = service.list();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0]?.book.locator.path, "b.epub");
});

test("LibraryService.list(includeUntracked) surfaces candidate books", async () => {
  const source = new FakeBookSource([
    { locator: makeLocator("a.epub"), metadata: makeMetadata("A") },
    { locator: makeLocator("b.epub"), metadata: makeMetadata("B") }
  ]);
  const service = new LibraryService(source, new InMemoryAnnotationStore());
  await service.initialize();

  const all = service.list({}, "titleAsc", true);
  assert.equal(all.length, 2);
  assert.equal(service.list().length, 0);
});

test("LibraryEntry shape", () => {
  // Compile-time sanity check: LibraryEntry exposes book and reading.
  const entry: LibraryEntry = {
    book: {
      id: "x",
      locator: makeLocator("x.epub"),
      metadata: null,
      sourceModifiedAt: 0
    },
    reading: {
      bookId: "x",
      position: null,
      status: "unread",
      favorite: false,
      lastOpenedAt: null,
      totalReadingMs: 0
    }
  };
  assert.ok(entry.book);
  assert.ok(entry.reading);
});

test("LibraryService.addAllToLibrary uses the batch+stamp write (not N serial mutations)", async () => {
  const files = [
    { locator: makeLocator("a.epub"), metadata: makeMetadata("A") },
    { locator: makeLocator("b.epub"), metadata: makeMetadata("B") },
    { locator: makeLocator("c.txt"), metadata: makeMetadata("C") }
  ];
  const source = new FakeBookSource(files);
  let mutationCount = 0;
  let saveCount = 0;
  const store = new InMemoryAnnotationStore();
  const originalMutate = store.addToLibrary.bind(store);
  // Wrap addToLibrary to count calls — we expect addAllToLibrary to NOT
  // invoke addToLibrary at all when the batch path exists.
  store.addToLibrary = async (...args) => {
    mutationCount++;
    return originalMutate(...args);
  };
  const originalBatch = store.addToLibraryBatchWithStamp.bind(store);
  store.addToLibraryBatchWithStamp = async (...args) => {
    saveCount++;
    return originalBatch(...args);
  };
  const service = new LibraryService(source, store);
  await service.initialize();
  const n = await service.addAllToLibrary();
  assert.equal(n, 3);
  assert.equal(mutationCount, 0, "addAllToLibrary should NOT call addToLibrary one-by-one");
  assert.equal(saveCount, 1, "addAllToLibrary should call addToLibraryBatchWithStamp exactly once");
});

test("addToLibraryBatchWithStamp preserves original addedAt for books already in the library", async () => {
  const files = [
    { locator: makeLocator("a.epub"), metadata: makeMetadata("A") },
    { locator: makeLocator("b.epub"), metadata: makeMetadata("B") }
  ];
  const source = new FakeBookSource(files);
  const olderTimestamp = 1_000_000_000_000;
  const newerTimestamp = 2_000_000_000_000;
  const store = new InMemoryAnnotationStore({
    library: ["a.epub"],
    addedAtByBookId: { "a.epub": olderTimestamp }
  });
  const service = new LibraryService(source, store);
  await service.initialize();
  await service.addAllToLibrary(newerTimestamp);
  const library = await store.listLibrary();
  assert.deepEqual([...library].sort(), ["a.epub", "b.epub"]);
  const addedAt = (await store.getAddedAt("a.epub"))!;
  const addedAtB = (await store.getAddedAt("b.epub"))!;
  assert.equal(addedAt, olderTimestamp, "existing book's addedAt must NOT be downgraded");
  assert.equal(addedAtB, newerTimestamp, "new book's addedAt should be the new stamp");
});

test("LibraryService.togglePin flips pinnedAt and persists", async () => {
  const files = [
    { locator: makeLocator("a.epub"), metadata: makeMetadata("A") },
    { locator: makeLocator("b.epub"), metadata: makeMetadata("B") }
  ];
  const source = new FakeBookSource(files);
  const store = new InMemoryAnnotationStore();
  const service = new LibraryService(source, store);
  await service.initialize();
  await service.addAllToLibrary();

  // 初始: 都未 pin
  const before = service.list();
  assert.equal(before.find((e) => e.book.id === "a.epub")!.book.pinnedAt, null);

  // 第一次 togglePin: 置顶 a
  const wasPinned1 = await service.togglePin("a.epub", 1000);
  assert.equal(wasPinned1, true, "first togglePin returns true (now pinned)");
  const after1 = service.list();
  const a1 = after1.find((e) => e.book.id === "a.epub")!;
  const b1 = after1.find((e) => e.book.id === "b.epub")!;
  assert.equal(a1.book.pinnedAt, 1000);
  assert.equal(b1.book.pinnedAt, null);
  assert.ok(after1.indexOf(a1) < after1.indexOf(b1), "pinned book sorts before unpinned");

  // 持久化: 通过 store 直接读, 验证 setPinnedAt 写到了 snapshot
  assert.equal(await store.getPinnedAt("a.epub"), 1000);

  // 第二次 togglePin: 取消置顶 a, 同时置顶 b (re-pin 跳到前)
  const wasPinned2 = await service.togglePin("a.epub", 2000);
  assert.equal(wasPinned2, false, "second togglePin returns false (now unpinned)");
  await service.togglePin("b.epub", 3000);
  const after2 = service.list();
  const a2 = after2.find((e) => e.book.id === "a.epub")!;
  const b2 = after2.find((e) => e.book.id === "b.epub")!;
  assert.equal(a2.book.pinnedAt, null);
  assert.equal(b2.book.pinnedAt, 3000);
  assert.ok(after2.indexOf(b2) < after2.indexOf(a2), "b (newly pinned) sorts before a (now unpinned)");

  // 持久化
  assert.equal(await store.getPinnedAt("a.epub"), null);
  assert.equal(await store.getPinnedAt("b.epub"), 3000);
});

// P0-2: 测试 refreshMetadata 用 reader 解析的真 metadata 升级 title / author,
// 持久化到 store, 并 emit 触发 shelf 重渲染.
test("LibraryService.refreshMetadata upgrades filename-derived title to reader-parsed title and persists", async () => {
  const files = [
    // 文件名 "Introduction to Seismology (Peter M. Shearer) (Z-Library).epub"
    // → filename-derived metadata 是 "Introduction to Seismology (Peter M. Shearer) (Z-Library)"
    { locator: makeLocator("intro.epub"), metadata: makeMetadata("Introduction to Seismology (Peter M. Shearer) (Z-Library)") },
    { locator: makeLocator("gatsby.epub"), metadata: makeMetadata("gatsby") }
  ];
  const source = new FakeBookSource(files);
  const store = new InMemoryAnnotationStore();
  // mock reader: 对 intro.epub 返回 OPF 解析的真 metadata
  const metadataReader: import("../../src/core/ports/BookReader").BookReader = {
    open: async () => {
      throw new Error("not used in refreshMetadata test");
    },
    extractCover: async () => null,
    readMetadata: async (book) => {
      if (book.locator.path === "intro.epub") {
        return makeMetadata("Introduction to Seismology", ["Peter M. Shearer"], ["en"]);
      }
      return null;
    }
  };
  const service = new LibraryService(source, store, metadataReader, async () => new ArrayBuffer(0));
  let emitCount = 0;
  service.subscribe(() => emitCount++);

  await service.initialize();
  assert.equal(emitCount, 1, "initialize emits once");
  const before = service.get("intro.epub");
  assert.equal(before?.book.metadata?.title, "Introduction to Seismology (Peter M. Shearer) (Z-Library)");

  // refreshMetadata: 用真 metadata 替换 filename-derived
  await service.refreshMetadata("intro.epub");
  assert.ok(emitCount >= 2, "refreshMetadata emits when title changes");

  const after = service.get("intro.epub");
  assert.equal(after?.book.metadata?.title, "Introduction to Seismology");
  assert.deepEqual(after?.book.metadata?.authors, ["Peter M. Shearer"]);
  assert.deepEqual(after?.book.metadata?.languages, ["en"]);

  // 持久化: 下一次 initialize 应该读到 rich metadata 而不是 filename
  assert.ok(await store.loadRichMetadata("intro.epub"), "rich metadata persisted to store");

  const freshService = new LibraryService(source, store, metadataReader, async () => new ArrayBuffer(0));
  await freshService.initialize();
  const reopened = freshService.get("intro.epub");
  assert.equal(reopened?.book.metadata?.title, "Introduction to Seismology", "rich metadata survives initialize");
});

test("LibraryService.refreshMetadata is a no-op when reader returns null", async () => {
  const files = [{ locator: makeLocator("broken.epub"), metadata: makeMetadata("fallback title") }];
  const source = new FakeBookSource(files);
  const store = new InMemoryAnnotationStore();
  const metadataReader: import("../../src/core/ports/BookReader").BookReader = {
    open: async () => {
      throw new Error("not used");
    },
    extractCover: async () => null,
    readMetadata: async () => null // reader parse 失败
  };
  const service = new LibraryService(source, store, metadataReader, async () => new ArrayBuffer(0));
  let emitCount = 0;
  service.subscribe(() => emitCount++);

  await service.initialize();
  const emitAfterInit = emitCount;
  await service.refreshMetadata("broken.epub");
  assert.equal(emitCount, emitAfterInit, "no emit when reader returns null");

  const entry = service.get("broken.epub");
  assert.equal(entry?.book.metadata?.title, "fallback title", "filename-derived metadata preserved");
  assert.equal(await store.loadRichMetadata("broken.epub"), null, "no rich metadata persisted");
});