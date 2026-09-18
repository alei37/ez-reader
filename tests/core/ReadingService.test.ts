import { test } from "node:test";
import { strict as assert } from "node:assert";

import { ReadingService } from "../../src/core/services/ReadingService";
import type {
  AnnotationSnapshot,
  AnnotationStore
} from "../../src/core/ports/AnnotationStore";
import type { Bookmark, BookmarkId } from "../../src/core/entities/Bookmark";
import type { Excerpt, ExcerptId } from "../../src/core/entities/Excerpt";
import type { ReadingState } from "../../src/core/entities/ReadingState";
import type { PluginSettings } from "../../src/core/types/ReaderSettings";

class InMemoryAnnotationStore implements AnnotationStore {
  snapshot: AnnotationSnapshot;

  constructor(initial: Partial<AnnotationSnapshot> = {}) {
    const defaultSettings: PluginSettings = {
      uiLocale: "en",
      translation: null,
      defaultAppearance: { fontSize: 100, lineHeight: 1.6, margin: 32, theme: "system", flow: "paginated" },
      notesDirectory: "",
      researchDirectory: "",
      libraryOwnerName: "",
      defaultNoteTemplate: "",
      readerOpenMode: "tab"
    };
    this.snapshot = {
      version: 1,
      settings: initial.settings ?? defaultSettings,
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
  async listBookmarks(bookId: string): Promise<ReadonlyArray<Bookmark>> {
    return this.snapshot.bookmarks.filter((b) => b.bookId === bookId);
  }
  async addBookmark(bookmark: Bookmark): Promise<void> {
    this.snapshot = { ...this.snapshot, bookmarks: [...this.snapshot.bookmarks, bookmark] };
  }
  async removeBookmark(bookId: string, bookmarkId: BookmarkId): Promise<void> {
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
  async removeExcerpt(bookId: string, excerptId: ExcerptId): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      excerpts: this.snapshot.excerpts.filter((e) => !(e.bookId === bookId && e.id === excerptId))
    };
  }
  async listSettings(): Promise<PluginSettings> {
    return this.snapshot.settings;
  }
  async saveSettings(settings: PluginSettings): Promise<void> {
    this.snapshot = { ...this.snapshot, settings };
  }
  async patchSettings(patch: (s: PluginSettings) => PluginSettings): Promise<void> {
    this.snapshot = { ...this.snapshot, settings: patch(this.snapshot.settings) };
  }
  async loadCoverPaths(): Promise<Readonly<Record<string, string>>> {
    return this.snapshot.coverPaths ?? {};
  }
  async saveCoverPaths(coverPaths: Record<string, string>): Promise<void> {
    this.snapshot = { ...this.snapshot, coverPaths };
  }
  async patchCoverPaths(patch: (paths: Record<string, string>) => Record<string, string>): Promise<void> {
    const current = this.snapshot.coverPaths ?? {};
    this.snapshot = { ...this.snapshot, coverPaths: patch(current) };
  }
  async getAddedAt(): Promise<number | null> { return null; }
  async setAddedAt(bookId: string, addedAt: number): Promise<void> {
    const current = this.snapshot.addedAtByBookId ?? {};
    this.snapshot = { ...this.snapshot, addedAtByBookId: { ...current, [bookId]: addedAt } };
  }
  async markOnboardingDismissed(): Promise<void> {
    this.snapshot = { ...this.snapshot, onboardingDismissed: true };
  }
  async hasOnboardingBeenDismissed(): Promise<boolean> {
    return this.snapshot.onboardingDismissed === true;
  }
  // P2: visited toc ids mock — 跟 ObsidianAnnotationStore 同样的 in-memory 实现.
  async loadVisitedTocIds(bookId: string): Promise<ReadonlyArray<string>> {
    return this.snapshot.visitedTocIdsByBookId?.[bookId] ?? [];
  }
  async saveVisitedTocIds(bookId: string, ids: ReadonlyArray<string>): Promise<void> {
    const current = this.snapshot.visitedTocIdsByBookId ?? {};
    this.snapshot = {
      ...this.snapshot,
      visitedTocIdsByBookId: { ...current, [bookId]: [...ids] }
    };
  }
}

test("ReadingService.openBook transitions unread -> reading and stamps lastOpenedAt", async () => {
  const store = new InMemoryAnnotationStore();
  const service = new ReadingService(store);
  const before = Date.now();
  const state = await service.openBook("a.epub");
  const after = Date.now();
  assert.equal(state.status, "reading");
  assert.ok(state.lastOpenedAt !== null);
  assert.ok(state.lastOpenedAt! >= before && state.lastOpenedAt! <= after);
});

test("ReadingService.openBook preserves finished state when", async () => {
  const store = new InMemoryAnnotationStore({
    reading: [
      {
        bookId: "a.epub",
        position: { kind: "reflow", fraction: 1 },
        status: "finished",
        favorite: false,
        lastOpenedAt: 100,
        totalReadingMs: 0
      }
    ]
  });
  const service = new ReadingService(store);
  const state = await service.openBook("a.epub");
  assert.equal(state.status, "finished");
});

test("ReadingService.updatePosition classifies finished at >=0.95", async () => {
  const store = new InMemoryAnnotationStore();
  const service = new ReadingService(store);
  await service.openBook("a.epub");
  const next = await service.updatePosition("a.epub", { kind: "reflow", fraction: 0.96 });
  assert.equal(next.status, "finished");
});

test("ReadingService.updatePosition classifies reading at 0 < f < 0.95", async () => {
  const store = new InMemoryAnnotationStore();
  const service = new ReadingService(store);
  await service.openBook("a.epub");
  const next = await service.updatePosition("a.epub", { kind: "reflow", fraction: 0.5 });
  assert.equal(next.status, "reading");
});

test("ReadingService.setStatus persists explicitly chosen status", async () => {
  const store = new InMemoryAnnotationStore();
  const service = new ReadingService(store);
  await service.openBook("a.epub");
  const next = await service.setStatus("a.epub", "abandoned");
  assert.equal(next.status, "abandoned");
});

test("ReadingService.toggleFavorite flips", async () => {
  const store = new InMemoryAnnotationStore();
  const service = new ReadingService(store);
  await service.openBook("a.epub");
  const first = await service.toggleFavorite("a.epub");
  assert.equal(first.favorite, true);
  const second = await service.toggleFavorite("a.epub");
  assert.equal(second.favorite, false);
});

test("ReadingService.addBookmark + removeBookmark", async () => {
  const store = new InMemoryAnnotationStore();
  const service = new ReadingService(store);
  const bookmark: Bookmark = {
    id: "bm-1",
    bookId: "a.epub",
    locator: { position: { kind: "reflow", fraction: 0.1 }, chapter: "ch" },
    label: "Important",
    createdAt: Date.now()
  };
  await service.addBookmark(bookmark);
  const list = await service.listBookmarks("a.epub");
  assert.equal(list.length, 1);
  assert.equal(list[0]?.label, "Important");
  await service.removeBookmark("a.epub", "bm-1");
  const after = await service.listBookmarks("a.epub");
  assert.equal(after.length, 0);
});

test("ReadingService.addExcerpt stores with tags", async () => {
  const store = new InMemoryAnnotationStore();
  const service = new ReadingService(store);
  const excerpt: Excerpt = {
    id: "ex-1",
    bookId: "a.epub",
    text: "selected text",
    locator: { position: { kind: "reflow", fraction: 0.5 } },
    note: "some thought",
    tags: ["important", "reread"],
    createdAt: Date.now()
  };
  await service.addExcerpt(excerpt);
  const list = await service.listExcerpts("a.epub");
  assert.equal(list.length, 1);
  assert.deepEqual(list[0]?.tags, ["important", "reread"]);
});

// =========================================================
// P2: visited toc ids 包装 — 验证 ReadingService.getVisitedTocIds /
// saveVisitedTocIds 正确透传到 AnnotationStore.
// =========================================================

test("ReadingService.getVisitedTocIds: 空 store → 空 array", async () => {
  const store = new InMemoryAnnotationStore();
  const service = new ReadingService(store);
  const ids = await service.getVisitedTocIds("a.epub");
  assert.deepEqual(ids, []);
});

test("ReadingService.saveVisitedTocIds + getVisitedTocIds round-trip", async () => {
  const store = new InMemoryAnnotationStore();
  const service = new ReadingService(store);
  await service.saveVisitedTocIds("a.epub", ["toc-0", "toc-3", "toc-7"]);
  // 同一个 service instance 应该看到自己刚写的
  const ids = await service.getVisitedTocIds("a.epub");
  assert.deepEqual(ids, ["toc-0", "toc-3", "toc-7"]);
  // 不同的 service instance (模拟重启) 也应能读 — 因为 store 持久化层
  // 是 InMemoryAnnotationStore, snapshot 是共享的.
  const service2 = new ReadingService(store);
  const ids2 = await service2.getVisitedTocIds("a.epub");
  assert.deepEqual(ids2, ["toc-0", "toc-3", "toc-7"]);
});

test("ReadingService.saveVisitedTocIds: overwrite (replace, 不 merge)", async () => {
  // ReaderView schedulePersistVisited 每次 flush 都把当前 tocFractions.keys()
  // 全发过来 — store 端是 overwrite 语义. 验证不会因为旧 ids 残留.
  const store = new InMemoryAnnotationStore();
  const service = new ReadingService(store);
  await service.saveVisitedTocIds("a.epub", ["toc-0", "toc-1"]);
  await service.saveVisitedTocIds("a.epub", ["toc-1", "toc-2"]);
  const ids = await service.getVisitedTocIds("a.epub");
  assert.deepEqual(ids, ["toc-1", "toc-2"], "旧 toc-0 应被新 array 覆盖掉");
});

test("ReadingService.saveVisitedTocIds: 不同 book 互不影响", async () => {
  const store = new InMemoryAnnotationStore();
  const service = new ReadingService(store);
  await service.saveVisitedTocIds("a.epub", ["toc-0"]);
  await service.saveVisitedTocIds("b.epub", ["toc-5", "toc-6"]);
  const a = await service.getVisitedTocIds("a.epub");
  const b = await service.getVisitedTocIds("b.epub");
  assert.deepEqual(a, ["toc-0"]);
  assert.deepEqual(b, ["toc-5", "toc-6"]);
});