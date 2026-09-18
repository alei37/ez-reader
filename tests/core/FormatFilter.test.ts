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

  async save(snapshot: AnnotationSnapshot): Promise<void> {
    await this.write(snapshot);
  }

  async listSettings() {
    return this.snapshot.settings ?? (await this.read()).settings ?? ({} as never);
  }

  async saveSettings(): Promise<void> { /* no-op */ }
  async patchSettings(): Promise<void> { /* no-op */ }
  async getAddedAt(): Promise<number | null> { return null; }
  async setAddedAt(): Promise<void> { /* no-op */ }

  async listLibrary(): Promise<string[]> {
    return this.snapshot.library;
  }

  async listReading(): Promise<ReadingState[]> {
    return this.snapshot.reading;
  }

  async upsertReading(): Promise<void> {
    /* no-op */
  }

  async listBookmarks() {
    return [];
  }

  async upsertBookmark(): Promise<void> {
    /* no-op */
  }

  async removeBookmark(): Promise<void> {
    /* no-op */
  }

  async listExcerpts() {
    return [];
  }

  async upsertExcerpt(): Promise<void> {
    /* no-op */
  }

  async removeExcerpt(): Promise<void> {
    /* no-op */
  }

  async listCoverPaths() {
    return {};
  }

  async upsertCoverPath(): Promise<void> {
    /* no-op */
  }

  async removeCoverPath(): Promise<void> {
    /* no-op */
  }

  async markOnboardingDismissed(): Promise<void> {
    /* no-op — in-memory stub doesn't need to persist */
  }

  async hasOnboardingBeenDismissed(): Promise<boolean> {
    return false;
  }

  // P2: visited toc ids mock — noop stub.
  async loadVisitedTocIds(): Promise<ReadonlyArray<string>> { return []; }
  async saveVisitedTocIds(): Promise<void> { /* no-op */ }
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