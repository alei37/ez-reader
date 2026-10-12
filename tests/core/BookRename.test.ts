/**
 * Regression tests for book-file renames.
 *
 * `BookId` IS the vault path (`ObsidianBookSource.resolveId` returns
 * `locator.path`), so renaming a book mints a new id and strands everything
 * keyed by the old one. The source used to report renames as plain
 * "modified" events, which meant:
 *
 *   - the shelf kept an entry under the old id,
 *   - a second entry appeared for the new path with no history,
 *   - progress / bookmarks / excerpts / cover / pin / TOC progress all
 *     stayed in `data.json`, unreachable,
 *   - and `ezreader/{notes,info,sessions}/<title>-<hash>.md` stayed under a
 *     name nothing would ever look up again.
 *
 * The user's notes were still on disk — the plugin just stopped being able
 * to find them. These tests pin the recovery path in three layers:
 * the pure snapshot rewrite, the `LibraryService` wiring, and the event
 * the adapter emits.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { TFile } from "obsidian";
import { renameInSnapshot } from "../../src/core/utils/renameSnapshot";
import { LibraryService } from "../../src/core/services/LibraryService";
import { ObsidianBookSource } from "../../src/adapters/obsidian/ObsidianBookSource";
import type { AnnotationSnapshot } from "../../src/core/ports/AnnotationStore";
import type {
  BookChangeEvent,
  BookChangeHandler,
  BookSource
} from "../../src/core/ports/BookSource";
import type { BookLocator, BookMetadata, BookFormat, CoverImage } from "../../src/core/entities/Book";
import type { Disposable } from "../../src/core/utils/Disposable";
import { DEFAULT_PLUGIN_SETTINGS } from "../../src/core/types/ReaderSettings";

// ---------------------------------------------------------------------------
// renameInSnapshot — the pure rewrite
// ---------------------------------------------------------------------------

const OLD = "books/dune.epub";
const NEW = "library/Dune 2.epub";
const OTHER = "books/other.epub";

const snapshot = (over: Partial<AnnotationSnapshot> = {}): AnnotationSnapshot => ({
  version: 1,
  settings: DEFAULT_PLUGIN_SETTINGS,
  library: [OTHER, OLD],
  reading: [
    { bookId: OTHER, position: null, status: "finished", favorite: false, lastOpenedAt: null, totalReadingMs: 5 },
    { bookId: OLD, position: null, status: "reading", favorite: true, lastOpenedAt: 10, totalReadingMs: 99 }
  ],
  bookmarks: [
    { id: "b-other", bookId: OTHER, label: "x", fraction: 0.1, createdAt: 1 } as never,
    { id: "b-old", bookId: OLD, label: "y", fraction: 0.5, createdAt: 2 } as never
  ],
  excerpts: [
    { id: "e-other", bookId: OTHER, text: "a", note: "", tags: [], locator: { fraction: 0.1 }, createdAt: 1 } as never,
    { id: "e-old", bookId: OLD, text: "b", note: "", tags: [], locator: { fraction: 0.2 }, createdAt: 2 } as never
  ],
  coverPaths: { [OTHER]: "app://a", [OLD]: "app://b" },
  addedAtByBookId: { [OTHER]: 100, [OLD]: 200 },
  pinnedAtByBookId: { [OLD]: 300 },
  richMetadataByBookId: { [OLD]: { title: "Dune", authors: [], languages: [], cachedAt: 1 } },
  visitedTocIdsByBookId: { [OLD]: ["c1", "c2"] },
  ...over
});

test("renameInSnapshot: library / reading / bookmarks / excerpts 全部换 key", () => {
  const next = renameInSnapshot(snapshot(), OLD, NEW);
  assert.deepEqual(next.library, [OTHER, NEW], "insertion order is preserved");
  assert.equal(next.reading.find((s) => s.bookId === OLD), undefined);
  assert.equal(next.reading.find((s) => s.bookId === NEW)?.totalReadingMs, 99);
  assert.equal(next.bookmarks.find((b) => b.bookId === NEW)?.id, "b-old");
  assert.equal(next.excerpts.find((e) => e.bookId === NEW)?.id, "e-old");
});

test("renameInSnapshot: reading 的其他字段完整保留", () => {
  const next = renameInSnapshot(snapshot(), OLD, NEW);
  const moved = next.reading.find((s) => s.bookId === NEW)!;
  assert.equal(moved.status, "reading");
  assert.equal(moved.favorite, true);
  assert.equal(moved.lastOpenedAt, 10);
  assert.equal(moved.totalReadingMs, 99);
});

test("renameInSnapshot: 五个 map 全部换 key", () => {
  const next = renameInSnapshot(snapshot(), OLD, NEW);
  assert.equal(next.coverPaths?.[NEW], "app://b");
  assert.equal(next.addedAtByBookId?.[NEW], 200);
  assert.equal(next.pinnedAtByBookId?.[NEW], 300);
  assert.equal(next.richMetadataByBookId?.[NEW]?.title, "Dune");
  assert.deepEqual(next.visitedTocIdsByBookId?.[NEW], ["c1", "c2"]);
});

test("renameInSnapshot: 旧 key 全部消失,不会残留孤儿数据", () => {
  const next = renameInSnapshot(snapshot(), OLD, NEW);
  assert.ok(!(OLD in (next.coverPaths ?? {})));
  assert.ok(!(OLD in (next.addedAtByBookId ?? {})));
  assert.ok(!(OLD in (next.pinnedAtByBookId ?? {})));
  assert.ok(!(OLD in (next.richMetadataByBookId ?? {})));
  assert.ok(!(OLD in (next.visitedTocIdsByBookId ?? {})));
  assert.equal(next.library.includes(OLD), false);
});

test("renameInSnapshot: 别的书一条都不动", () => {
  const next = renameInSnapshot(snapshot(), OLD, NEW);
  assert.equal(next.reading.find((s) => s.bookId === OTHER)?.totalReadingMs, 5);
  assert.equal(next.coverPaths?.[OTHER], "app://a");
  assert.equal(next.addedAtByBookId?.[OTHER], 100);
  assert.equal(next.bookmarks.find((b) => b.bookId === OTHER)?.id, "b-other");
  assert.equal(next.excerpts.find((e) => e.bookId === OTHER)?.id, "e-other");
});

test("renameInSnapshot: 未定义的 map 保持 undefined,不被凭空创建", () => {
  const bare = snapshot({
    coverPaths: undefined,
    addedAtByBookId: undefined,
    pinnedAtByBookId: undefined,
    richMetadataByBookId: undefined,
    visitedTocIdsByBookId: undefined
  });
  const next = renameInSnapshot(bare, OLD, NEW);
  assert.equal(next.coverPaths, undefined);
  assert.equal(next.richMetadataByBookId, undefined);
  assert.equal(next.visitedTocIdsByBookId, undefined);
});

test("renameInSnapshot: from === to 返回原对象", () => {
  const input = snapshot();
  assert.equal(renameInSnapshot(input, OLD, OLD), input);
});

test("renameInSnapshot: 目标已有数据时,目标优先,源数据丢弃", () => {
  const collided = snapshot({
    coverPaths: { [OLD]: "app://loser", [NEW]: "app://winner" },
    addedAtByBookId: { [OLD]: 1, [NEW]: 2 }
  });
  const next = renameInSnapshot(collided, OLD, NEW);
  assert.equal(next.coverPaths?.[NEW], "app://winner", "destination data is not overwritten");
  assert.equal(next.addedAtByBookId?.[NEW], 2);
  assert.equal(Object.keys(next.coverPaths ?? {}).length, 1, "the source key is dropped, not duplicated");
});

test("renameInSnapshot: 目标已在 library 里时不会产生重复条目", () => {
  const collided = snapshot({ library: [OLD, NEW, OTHER] });
  const next = renameInSnapshot(collided, OLD, NEW);
  assert.deepEqual(next.library, [NEW, OTHER]);
});

test("renameInSnapshot: re-key 后出现的重复 reading state 被折叠(后者胜)", () => {
  const dup = snapshot({
    reading: [
      { bookId: OLD, position: null, status: "unread", favorite: false, lastOpenedAt: null, totalReadingMs: 1 },
      { bookId: NEW, position: null, status: "unread", favorite: false, lastOpenedAt: null, totalReadingMs: 2 },
      { bookId: OLD, position: null, status: "unread", favorite: false, lastOpenedAt: null, totalReadingMs: 3 }
    ]
  });
  const next = renameInSnapshot(dup, OLD, NEW);
  const forNew = next.reading.filter((s) => s.bookId === NEW);
  assert.equal(forNew.length, 1, "upsert is last-write-wins, so the store must not grow duplicates");
  assert.equal(forNew[0]!.totalReadingMs, 3);
});

// ---------------------------------------------------------------------------
// LibraryService wiring
// ---------------------------------------------------------------------------

class FakeSource implements BookSource {
  readonly handlers: BookChangeHandler[] = [];
  readonly locators = new Map<string, BookLocator>();
  readonly titles = new Map<string, string>();

  add(path: string, title: string): void {
    this.locators.set(path, { path, format: "epub", sizeBytes: 10, modifiedAt: 1 });
    this.titles.set(path, title);
  }
  emit(event: BookChangeEvent): void {
    for (const h of this.handlers) h(event);
  }
  async *scan(_f: ReadonlySet<BookFormat>): AsyncIterable<BookLocator> {
    for (const l of this.locators.values()) yield l;
  }
  async read(): Promise<ArrayBuffer> {
    return new ArrayBuffer(10);
  }
  async readMetadata(locator: BookLocator): Promise<BookMetadata | null> {
    const title = this.titles.get(locator.path);
    return title ? { title, authors: [], languages: [], cachedAt: 1 } : null;
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
    return this.locators.get(id) ?? null;
  }
  async lookup(path: string): Promise<BookLocator | null> {
    return this.locators.get(path) ?? null;
  }
}

/** Applies the real `renameInSnapshot`, so the integration test exercises it. */
class RenamingStore {
  snapshot: AnnotationSnapshot;
  readonly renames: Array<[string, string]> = [];
  constructor(initial: AnnotationSnapshot) {
    this.snapshot = initial;
  }
  async load(): Promise<AnnotationSnapshot> {
    return this.snapshot;
  }
  async listReading() {
    return this.snapshot.reading;
  }
  async listLibrary() {
    return this.snapshot.library;
  }
  async getAddedAt(id: string) {
    return this.snapshot.addedAtByBookId?.[id] ?? null;
  }
  async getPinnedAt(id: string) {
    return this.snapshot.pinnedAtByBookId?.[id] ?? null;
  }
  async loadRichMetadata(id: string) {
    return this.snapshot.richMetadataByBookId?.[id] ?? null;
  }
  async renameBookId(from: string, to: string): Promise<void> {
    this.renames.push([from, to]);
    this.snapshot = renameInSnapshot(this.snapshot, from, to);
  }
}

const FakeWriter = class {
  readonly moves: Array<{ fromBookId: string; toBookId: string; newTitle: string }> = [];
  async renameBookFiles(input: { fromBookId: string; toBookId: string; newTitle: string }) {
    this.moves.push(input);
    return { moved: [], missing: [] };
  }
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

const buildService = async () => {
  const source = new FakeSource();
  source.add(OLD, "Dune");
  const store = new RenamingStore(snapshot({ library: [OLD] }));
  const writer = new FakeWriter();
  const service = new LibraryService(
    source as unknown as BookSource,
    store as never,
    undefined,
    undefined,
    writer as never
  );
  await service.initialize();
  return { source, store, writer, service };
};

test("rename: LibraryService 把 in-memory entry 迁到新 id", async () => {
  const { source, service } = await buildService();
  const before = service.get(OLD);
  assert.equal(before?.reading.totalReadingMs, 99);

  source.add(NEW, "Dune 2");
  source.emit({ kind: "renamed", path: NEW, format: "epub", oldPath: OLD });
  await settle();

  assert.equal(service.get(OLD), undefined, "old id is retired");
  const after = service.get(NEW);
  assert.ok(after, "new id has an entry");
  assert.equal(after!.book.id, NEW);
  assert.equal(after!.book.locator.path, NEW);
  assert.equal(after!.reading.bookId, NEW);
  assert.equal(after!.reading.totalReadingMs, 99, "progress survives the rename");
});

test("rename: LibraryService 调用 store.renameBookId 并真的改写了数据", async () => {
  const { source, store, service } = await buildService();
  source.add(NEW, "Dune 2");
  source.emit({ kind: "renamed", path: NEW, format: "epub", oldPath: OLD });
  await settle();

  assert.deepEqual(store.renames, [[OLD, NEW]]);
  assert.equal(store.snapshot.library.includes(OLD), false);
  assert.ok(store.snapshot.library.includes(NEW));
  assert.equal(store.snapshot.reading.find((s) => s.bookId === NEW)?.totalReadingMs, 99);
  assert.equal(store.snapshot.bookmarks.find((b) => b.bookId === NEW)?.id, "b-old");
  assert.deepEqual(store.snapshot.visitedTocIdsByBookId?.[NEW], ["c1", "c2"]);
  // The shelf entry is joined against the store on read, so both sides
  // agreeing is what makes the book look untouched.
  assert.equal(service.get(NEW)?.reading.totalReadingMs, 99);
});

test("rename: LibraryService 让 writer 搬 ezreader/ 下的三个文件", async () => {
  const { source, writer } = await buildService();
  source.add(NEW, "Dune 2");
  source.emit({ kind: "renamed", path: NEW, format: "epub", oldPath: OLD });
  await settle();

  assert.deepEqual(writer.moves, [{ fromBookId: OLD, toBookId: NEW, newTitle: "Dune" }]);
});

test("rename: 缺少 oldPath 时什么都不做", async () => {
  const { source, store, writer, service } = await buildService();
  source.add(NEW, "Dune 2");
  source.emit({ kind: "renamed", path: NEW, format: "epub" });
  await settle();

  assert.deepEqual(store.renames, []);
  assert.deepEqual(writer.moves, []);
  assert.ok(service.get(OLD), "the old entry is left intact");
});

test("rename: oldPath === path 时是 no-op", async () => {
  const { source, store, writer } = await buildService();
  source.emit({ kind: "renamed", path: OLD, format: "epub", oldPath: OLD });
  await settle();
  assert.deepEqual(store.renames, []);
  assert.deepEqual(writer.moves, []);
});

test("rename: 未知 book 的 rename 不会创建 entry", async () => {
  const { source, service } = await buildService();
  source.add("other/never-seen.epub", "Ghost");
  source.emit({
    kind: "renamed",
    path: "other/never-seen.epub",
    format: "epub",
    oldPath: "other/ghost.epub"
  });
  await settle();
  assert.equal(service.get("other/never-seen.epub"), undefined);
});

// ---------------------------------------------------------------------------
// ObsidianBookSource.watch — what the adapter actually emits
// ---------------------------------------------------------------------------

const buildVaultEvents = () => {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const vault = {
    on(name: string, cb: (...args: unknown[]) => void) {
      (listeners[name] ??= []).push(cb);
      return { name, cb };
    },
    offref() {},
    fire(name: string, ...args: unknown[]) {
      for (const cb of listeners[name] ?? []) cb(...args);
    }
  };
  return { vault, fire: vault.fire };
};

test("watch: rename 发出 renamed + oldPath,而不是 modified", () => {
  const { vault } = buildVaultEvents();
  const source = new ObsidianBookSource({ vault } as never);
  const seen: BookChangeEvent[] = [];
  source.watch((e) => seen.push(e));

  const file = Object.assign(new TFile(), {
    path: "library/Dune 2.epub",
    extension: "epub",
    basename: "Dune 2"
  });

  vault.fire("rename", file, "books/dune.epub");

  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.kind, "renamed");
  assert.equal(seen[0]!.path, "library/Dune 2.epub");
  assert.equal(seen[0]!.oldPath, "books/dune.epub");
});

test("watch: 改成不支持的扩展名 → 降级为 removed(旧 id)", () => {
  const { vault } = buildVaultEvents();
  const source = new ObsidianBookSource({ vault } as never);
  const seen: BookChangeEvent[] = [];
  source.watch((e) => seen.push(e));

  const file = Object.assign(new TFile(), {
    path: "books/dune.epub.bak",
    extension: "bak",
    basename: "dune"
  });

  vault.fire("rename", file, "books/dune.epub");

  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.kind, "removed");
  assert.equal(seen[0]!.path, "books/dune.epub", "reports the OLD path so the id is retired");
});

function require0(): never {
  throw new Error("unused");
}