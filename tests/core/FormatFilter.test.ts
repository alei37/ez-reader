import { test } from "node:test";
import { strict as assert } from "node:assert";

import { LibraryService } from "../../src/core/services/LibraryService";
import {
  READER_CAPABLE_FORMATS,
  SUPPORTED_BOOK_FORMATS,
  type BookFormat,
  type BookLocator,
  type BookMetadata,
  type CoverImage
} from "../../src/core/entities/Book";
import type {
  AnnotationSnapshot,
  AnnotationStore
} from "../../src/core/ports/AnnotationStore";
import type { BookChangeHandler, BookSource } from "../../src/core/ports/BookSource";
import type { Disposable } from "../../src/core/utils/Disposable";
import type { ReadingState } from "../../src/core/entities/ReadingState";
import type { Bookmark } from "../../src/core/entities/Bookmark";
import type { Excerpt } from "../../src/core/entities/Excerpt";
import type { PluginSettings } from "../../src/core/types/ReaderSettings";
import { renameInSnapshot } from "../../src/core/utils/renameSnapshot";

/**
 * 锁定"reader-capable 格式才能上架"的合约。当前已经实现了 EPUB / PDF /
 * TXT / MOBI / AZW3 五个 reader。`.azw` (老的 DRM-免费 Kindle 格式) 暂未实现,
 * 所以仍被过滤掉 — 等哪天补上 azw reader, 把这一行改成 `.has("azw")` 即可。
 *
 * 加新 adapter 时必须:
 *  1. 在 `src/core/entities/Book.ts` 把新 format 加进 READER_CAPABLE_FORMATS
 *  2. 在 `src/Plugin.ts` 注册对应的 BookReader
 *  3. 在 `src/adapters/text/*BookReader.ts` 写实现
 *  4. 加单元测试覆盖关键代码路径 (看 `TxtPagination.test.ts`)
 *  5. 更新这个文件让测试反映新合约
 */

class InMemoryStore implements AnnotationStore {
  snapshot: AnnotationSnapshot = {
    version: 1,
    settings: undefined as never,
    library: [],
    reading: [],
    bookmarks: [],
    excerpts: [],
    coverPaths: {}
  };

  async read(): Promise<AnnotationSnapshot> {
    return JSON.parse(JSON.stringify(this.snapshot));
  }

  async write(next: AnnotationSnapshot): Promise<void> {
    this.snapshot = JSON.parse(JSON.stringify(next));
  }

  async load(): Promise<AnnotationSnapshot> {
    return this.read();
  }

  async save(snapshot: AnnotationSnapshot): Promise<void> {
    await this.write(snapshot);
  }

  async listSettings(): Promise<PluginSettings> {
    return this.snapshot.settings ?? (await this.read()).settings ?? ({} as never);
  }

  async saveSettings(settings: PluginSettings): Promise<void> {
    this.snapshot = { ...this.snapshot, settings };
  }

  async patchSettings(patch: (s: PluginSettings) => PluginSettings): Promise<void> {
    this.snapshot = { ...this.snapshot, settings: patch(this.snapshot.settings) };
  }

  async getAddedAt(bookId: string): Promise<number | null> {
    return this.snapshot.addedAtByBookId?.[bookId] ?? null;
  }

  async setAddedAt(bookId: string, addedAt: number): Promise<void> {
    const current = this.snapshot.addedAtByBookId ?? {};
    this.snapshot = { ...this.snapshot, addedAtByBookId: { ...current, [bookId]: addedAt } };
  }

  async addToLibrary(bookId: string): Promise<void> {
    if (this.snapshot.library.includes(bookId)) return;
    this.snapshot = { ...this.snapshot, library: [...this.snapshot.library, bookId] };
  }

  async removeFromLibrary(bookId: string): Promise<void> {
    this.snapshot = { ...this.snapshot, library: this.snapshot.library.filter((id) => id !== bookId) };
  }

  // 端口签名是 ReadonlyArray —— 之前写成 `string[]` / `ReadingState[]`,
  // 跟 snapshot 里的 readonly 数组对不上 (TS4104). 改成 ReadonlyArray,
  // 返回值直接透传 snapshot 里的 readonly 数组.
  async listLibrary(): Promise<ReadonlyArray<string>> {
    return this.snapshot.library;
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

  // 端口漂移修复: 以前签名写的是 `(current: undefined) => unknown`, 跟端口的
  // `(current: ReadingState | undefined) => ReadingState | null` 对不上 ——
  // `implements AnnotationStore` 一直是假的. 这里改成跟端口一致, 并且真的
  // 走 read-modify-write.
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

  async loadCoverPaths(): Promise<Readonly<Record<string, string>>> {
    return this.snapshot.coverPaths ?? {};
  }

  async saveCoverPaths(coverPaths: Record<string, string>): Promise<void> {
    this.snapshot = { ...this.snapshot, coverPaths };
  }

  async patchCoverPaths(patch: (paths: Record<string, string>) => Record<string, string>): Promise<void> {
    this.snapshot = { ...this.snapshot, coverPaths: patch(this.snapshot.coverPaths ?? {}) };
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

  // P2: visited toc ids mock — 跟真 adapter 一样的 in-memory 实现.
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

class FakeSource implements BookSource {
  handlers: BookChangeHandler[] = [];
  files: Array<{ locator: BookLocator; metadata: BookMetadata | null }>;

  constructor(files: Array<{ locator: BookLocator; metadata: BookMetadata | null }>) {
    this.files = files;
  }

  async *scan(formats: ReadonlySet<BookFormat>): AsyncIterable<BookLocator> {
    for (const f of this.files) {
      if (formats.has(f.locator.format)) yield f.locator;
    }
  }

  async read(locator: BookLocator): Promise<ArrayBuffer> {
    return new ArrayBuffer(locator.sizeBytes);
  }

  async readMetadata(locator: BookLocator): Promise<BookMetadata | null> {
    return this.files.find((f) => f.locator.path === locator.path)?.metadata ?? null;
  }

  async readCover(): Promise<CoverImage | null> {
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

  /**
   * 端口漂移修复: BookSource 端口有 lookup, 桩里以前没有 ——
   * `implements BookSource` 一直是假的. 按 path 查, 行为跟 resolveLocator 一致
   * (跟 ObsidianBookSource 的 O(1) 索引查找语义对齐).
   */
  async lookup(path: string): Promise<BookLocator | null> {
    return this.files.find((f) => f.locator.path === path)?.locator ?? null;
  }
}

const makeLocator = (path: string, format: BookFormat): BookLocator => ({
  path,
  format,
  sizeBytes: 1024,
  modifiedAt: 1
});

test("READER_CAPABLE_FORMATS 只包含有 adapter 的格式 (epub / pdf / txt / mobi / azw3)", () => {
  // 这是硬合约 — 将来加新 adapter 时必须改这里, 让测试推动你加单元测试。
  assert.deepEqual([...READER_CAPABLE_FORMATS].sort(), ["azw3", "epub", "mobi", "pdf", "txt"]);
  assert.ok(!READER_CAPABLE_FORMATS.has("azw"), "azw 还没实现 reader, 暂被过滤");
});

test("SUPPORTED_BOOK_FORMATS 是识别范围, 仍保留 azw 等未实现格式", () => {
  assert.ok(SUPPORTED_BOOK_FORMATS.has("txt"));
  assert.ok(SUPPORTED_BOOK_FORMATS.has("mobi"));
  assert.ok(SUPPORTED_BOOK_FORMATS.has("azw"));
  assert.ok(SUPPORTED_BOOK_FORMATS.has("azw3"));
  assert.ok(SUPPORTED_BOOK_FORMATS.has("epub"));
  assert.ok(SUPPORTED_BOOK_FORMATS.has("pdf"));
});

test("READER_CAPABLE_FORMATS 是 SUPPORTED_BOOK_FORMATS 的子集", () => {
  for (const format of READER_CAPABLE_FORMATS) {
    assert.ok(
      SUPPORTED_BOOK_FORMATS.has(format),
      `${format} 在 READER_CAPABLE_FORMATS 里但不在 SUPPORTED_BOOK_FORMATS 里 — 类型不一致`
    );
  }
});

test("LibraryService.scan 只上架 reader-capable 格式, azw 被过滤", async () => {
  const source = new FakeSource([
    { locator: makeLocator("/books/a.epub", "epub"), metadata: null },
    { locator: makeLocator("/books/b.pdf", "pdf"), metadata: null },
    { locator: makeLocator("/books/c.txt", "txt"), metadata: null },
    { locator: makeLocator("/books/d.mobi", "mobi"), metadata: null },
    { locator: makeLocator("/books/e.azw3", "azw3"), metadata: null },
    { locator: makeLocator("/books/f.azw", "azw"), metadata: null }
  ]);
  const store = new InMemoryStore();
  const library = new LibraryService(source, store);
  await library.initialize();

  const list = library.list({}, "titleAsc", true);
  const paths = list.map((entry) => entry.book.locator.path).sort();
  assert.deepEqual(paths, [
    "/books/a.epub",
    "/books/b.pdf",
    "/books/c.txt",
    "/books/d.mobi",
    "/books/e.azw3"
  ]);

  // azw 没有 reader, 不能进 entries map
  const all = library.list({}, "titleAsc", true);
  assert.ok(!all.find((e) => e.book.locator.format === "azw"), "azw 不应在列表里");
});

test("LibraryService.scan 让 txt / mobi / azw3 上架 (有 reader)", async () => {
  const source = new FakeSource([
    { locator: makeLocator("/books/c.txt", "txt"), metadata: null },
    { locator: makeLocator("/books/d.mobi", "mobi"), metadata: null },
    { locator: makeLocator("/books/e.azw3", "azw3"), metadata: null }
  ]);
  const store = new InMemoryStore();
  const library = new LibraryService(source, store);
  await library.initialize();

  const paths = library.list({}, "titleAsc", true).map((entry) => entry.book.locator.path).sort();
  assert.deepEqual(paths, ["/books/c.txt", "/books/d.mobi", "/books/e.azw3"]);
});