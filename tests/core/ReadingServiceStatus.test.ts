import { test } from "node:test";
import { strict as assert } from "node:assert";
import { ReadingService } from "../../src/core/services/ReadingService";
import type {
  AnnotationSnapshot,
  AnnotationStore
} from "../../src/core/ports/AnnotationStore";
import type { BookId, BookMetadata } from "../../src/core/entities/Book";
import type { Bookmark } from "../../src/core/entities/Bookmark";
import type { Excerpt } from "../../src/core/entities/Excerpt";
import type { ReadingState } from "../../src/core/entities/ReadingState";
import type { PluginSettings } from "../../src/core/types/ReaderSettings";
import { renameInSnapshot } from "../../src/core/utils/renameSnapshot";

/**
 * Unit tests for ReadingService state transitions. We don't drive the
 * service through plugin onload — that requires an obsidian runtime —
 * instead we substitute the AnnotationStore with an in-memory map.
 *
 * The previous tests exercised happy-path CRUD. These cover the
 * openBook / setStatus / toggleFavorite state machine, which is the
 * surface the ShelfView and reader UI rely on.
 */
class InMemoryStore implements AnnotationStore {
  private snapshot: AnnotationSnapshot = {
    version: 1,
    settings: undefined as never,
    library: [],
    reading: [],
    bookmarks: [],
    excerpts: [],
    coverPaths: {}
  };

  async load(): Promise<AnnotationSnapshot> {
    return this.snapshot;
  }
  async save(snapshot: AnnotationSnapshot): Promise<void> {
    this.snapshot = snapshot;
  }
  async listLibrary(): Promise<ReadonlyArray<BookId>> {
    return this.snapshot.library;
  }
  async addToLibrary(bookId: BookId): Promise<void> {
    if (!this.snapshot.library.includes(bookId)) {
      this.snapshot = { ...this.snapshot, library: [...this.snapshot.library, bookId] };
    }
  }
  async removeFromLibrary(bookId: BookId): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      library: this.snapshot.library.filter((id) => id !== bookId)
    };
  }
  async listReading(): Promise<ReadonlyArray<ReadingState>> {
    return this.snapshot.reading;
  }
  async upsertReading(state: ReadingState): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      reading: [...this.snapshot.reading.filter((r) => r.bookId !== state.bookId), state]
    };
  }

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
  /** 只 patch note / tags, 其余字段 (id / text / locator / createdAt) 保持原值. */
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
  // 端口漂移修复: 下面这几个方法端口上有, 桩里以前没有 —— 补成真的实现.
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
  async addToLibraryBatchWithStamp(bookIds: ReadonlyArray<BookId>, addedAt: number): Promise<void> {
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
  // P2: visited toc ids mock — 这套测试不验证 visited 行为, 但仍走真实的
  // read-modify-write, 免得桩的行为跟真 adapter 分叉.
  async loadVisitedTocIds(bookId: string): Promise<ReadonlyArray<string>> {
    return this.snapshot.visitedTocIdsByBookId?.[bookId] ?? [];
  }
  async saveVisitedTocIds(bookId: string, ids: ReadonlyArray<string>): Promise<void> {
    const current = this.snapshot.visitedTocIdsByBookId ?? {};
    this.snapshot = { ...this.snapshot, visitedTocIdsByBookId: { ...current, [bookId]: [...ids] } };
  }
  /** 复用 core 的纯函数, 跟真 adapter 走同一条 re-key 路径. */
  async renameBookId(fromBookId: BookId, toBookId: BookId): Promise<void> {
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

const newService = async (): Promise<ReadingService> => {
  const store = new InMemoryStore();
  return new ReadingService(store);
};

test("openBook: unread → reading + lastOpenedAt set", async () => {
  const svc = await newService();
  const result = await svc.openBook("book-1");
  assert.equal(result.status, "reading");
  assert.ok(result.lastOpenedAt !== null && result.lastOpenedAt > 0);
});

test("openBook: reading → reading (idempotent, lastOpenedAt advances)", async () => {
  const svc = await newService();
  const first = await svc.openBook("book-1");
  // wait 10ms so timestamps differ
  await new Promise((r) => globalThis.setTimeout(r, 10));
  const second = await svc.openBook("book-1");
  assert.equal(second.status, "reading");
  assert.ok((second.lastOpenedAt ?? 0) > (first.lastOpenedAt ?? 0));
});

test("openBook: finished is preserved (NOT auto-reset to reading)", async () => {
  const svc = await newService();
  await svc.setStatus("book-1", "finished");
  await svc.openBook("book-1");
  const state = await svc.getState("book-1");
  assert.equal(state.status, "finished", "finished books should not silently flip back to reading");
});

test("openBook: abandoned is preserved", async () => {
  const svc = await newService();
  await svc.setStatus("book-1", "abandoned");
  await svc.openBook("book-1");
  const state = await svc.getState("book-1");
  assert.equal(state.status, "abandoned");
});

test("setStatus: explicit transitions update status field", async () => {
  const svc = await newService();
  await svc.setStatus("book-1", "finished");
  assert.equal((await svc.getState("book-1")).status, "finished");
  await svc.setStatus("book-1", "abandoned");
  assert.equal((await svc.getState("book-1")).status, "abandoned");
});

test("toggleFavorite: flips state on each call", async () => {
  const svc = await newService();
  assert.equal((await svc.toggleFavorite("book-1")).favorite, true);
  assert.equal((await svc.toggleFavorite("book-1")).favorite, false);
  assert.equal((await svc.toggleFavorite("book-1")).favorite, true);
});

// P0-3: PDF 翻页推进进度 — 之前 progressFraction 对 PDF 永远 0,
// 现在有 totalPages 字段就计算 (page-1) / totalPages.
test("updatePosition: PDF with totalPages transitions unread → reading", async () => {
  const svc = await newService();
  const result = await svc.updatePosition("book-1", { kind: "pdf", page: 5, totalPages: 100 });
  assert.equal(result.status, "reading", "PDF with any page progress should auto-flip to reading");
});

test("updatePosition: PDF at 95%+ transitions to finished", async () => {
  const svc = await newService();
  const result = await svc.updatePosition("book-1", { kind: "pdf", page: 100, totalPages: 100 });
  assert.equal(result.status, "finished");
});

test("updatePosition: PDF without totalPages stays at current status (no regression)", async () => {
  const svc = await newService();
  // 老 data.json 可能没 totalPages 字段. 这种情况 progressFraction 返回 0,
  // 状态机不能推断, 保持 unread. 这是兼容行为 — 不应该让老数据触发
  // 错误的 status 转换.
  const result = await svc.updatePosition("book-1", { kind: "pdf", page: 5 });
  assert.equal(result.status, "unread", "no totalPages means status inference can't fire");
});
