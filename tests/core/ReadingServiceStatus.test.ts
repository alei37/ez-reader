import { test } from "node:test";
import { strict as assert } from "node:assert";
import { ReadingService } from "../../src/core/services/ReadingService";
import type {
  AnnotationSnapshot,
  AnnotationStore
} from "../../src/core/ports/AnnotationStore";
import type { BookId } from "../../src/core/entities/Book";
import type { ReadingState } from "../../src/core/entities/ReadingState";

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
  async listBookmarks(): Promise<ReadonlyArray<unknown>> { return []; }
  async addBookmark(): Promise<void> {}
  async removeBookmark(): Promise<void> {}
  async listExcerpts(): Promise<ReadonlyArray<unknown>> { return []; }
  async addExcerpt(): Promise<void> {}
  async removeExcerpt(): Promise<void> {}
  async listSettings(): Promise<unknown> { return undefined; }
  async saveSettings(): Promise<void> {}
  async patchSettings(): Promise<void> {}
  async loadCoverPaths(): Promise<Readonly<Record<string, string>>> { return {}; }
  async saveCoverPaths(): Promise<void> {}
  async patchCoverPaths(): Promise<void> {}
  async getAddedAt(): Promise<number | null> { return null; }
  async setAddedAt(): Promise<void> {}
  async markOnboardingDismissed(): Promise<void> {}
  async hasOnboardingBeenDismissed(): Promise<boolean> { return false; }
  // P2: visited toc ids mock — 这套测试不验证 visited 行为, 给 noop 即可.
  async loadVisitedTocIds(): Promise<ReadonlyArray<string>> { return []; }
  async saveVisitedTocIds(): Promise<void> { /* noop */ }
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
