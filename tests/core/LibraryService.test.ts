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
      excerpts: initial.excerpts ?? []
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