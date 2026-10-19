import { test } from "node:test";
import assert from "node:assert/strict";
import { ReadingService } from "../../src/core/services/ReadingService";
import { LibraryService } from "../../src/core/services/LibraryService";
import { ObsidianAnnotationStore } from "../../src/adapters/obsidian/ObsidianAnnotationStore";
import type { ReadingState } from "../../src/core/entities/ReadingState";
import type { BookLocator, BookMetadata, CoverImage } from "../../src/core/entities/Book";
import type { BookChangeEvent, BookSource } from "../../src/core/ports/BookSource";

/**
 * Batch-5 codereview regressions. Every test here corresponds to a defect
 * found by review, not to a hypothetical one. They are written to fail
 * against the code as it stood before the fix.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class FakePlugin {
  private store: Record<string, unknown> = {};
  async loadData(): Promise<Record<string, unknown>> {
    return this.store;
  }
  async saveData(data: Record<string, unknown>): Promise<void> {
    // Yield to the microtask queue so a caller's un-awaited continuation
    // interleaves the same way it would against real filesystem IO.
    await Promise.resolve();
    this.store = data;
  }
}

const seedSnapshot = async (store: ObsidianAnnotationStore): Promise<void> => {
  await store.save({
    version: 1,
    settings: undefined as never,
    library: [],
    reading: [],
    bookmarks: [],
    excerpts: []
  } as never);
};

const locatorOf = (path: string, modifiedAt: number): BookLocator => ({
  path,
  format: "epub",
  sizeBytes: 1000,
  modifiedAt
});

const metaOf = (title: string): BookMetadata => ({
  title,
  authors: ["Someone"],
  languages: [],
  cachedAt: 1
});

// ---------------------------------------------------------------------------
// Finding 2 (P1): `addedDesc` is labelled "最近添加" in the shelf toolbar but
// sorted by the FILE's mtime, so the order changes whenever anything else
// touches the file.
// ---------------------------------------------------------------------------

class StaticSource implements BookSource {
  watchCount = 0;
  private handler: ((event: BookChangeEvent) => void) | null = null;
  constructor(public locators: ReadonlyArray<BookLocator>) {}
  /** Drive a vault event, the way Obsidian would. */
  emit(event: BookChangeEvent): void {
    this.handler?.(event);
  }
  async *scan(): AsyncGenerator<BookLocator> {
    for (const l of this.locators) yield l;
  }
  resolveId(locator: BookLocator): string {
    return locator.path;
  }
  async readMetadata(): Promise<BookMetadata | null> {
    return null;
  }
  async lookup(path: string): Promise<BookLocator | null> {
    return this.locators.find((l) => l.path === path) ?? null;
  }
  /**
   * 端口漂移修复: BookSource 端口有 read / readCover / resolveLocator,
   * 桩里以前没有 —— `implements BookSource` 一直是假的, 所以调用方只能写
   * `source as unknown as BookSource` 硬绕过去. 现在桩真的实现了端口,
   * 那个断言也就能删掉了 (类型检查重新变得有意义).
   */
  async read(locator: BookLocator): Promise<ArrayBuffer> {
    return new ArrayBuffer(locator.sizeBytes);
  }
  async readCover(): Promise<CoverImage | null> {
    return null;
  }
  async resolveLocator(id: string): Promise<BookLocator | null> {
    return this.lookup(id);
  }
  watch(handler: (event: BookChangeEvent) => void): { dispose: () => void } {
    this.watchCount += 1;
    this.handler = handler;
    return { dispose: () => undefined };
  }
}

const emptyStore = () => {
  const plugin = new FakePlugin();
  return new ObsidianAnnotationStore(plugin as unknown as never);
};

test("LibraryService: addedDesc sorts by when the user added the book, not by file mtime", async () => {
  const store = emptyStore();
  await seedSnapshot(store);
  // a.epub was added FIRST but its file has the newest mtime. The two
  // orderings disagree, which is the whole point of the test.
  const source = new StaticSource([locatorOf("a.epub", 9_000), locatorOf("b.epub", 1_000)]);
  const library = new LibraryService(source, store);
  await library.initialize();

  await library.addToLibrary("a.epub", 1_000);
  await library.addToLibrary("b.epub", 2_000);

  const sorted = library.list(undefined, "addedDesc");
  assert.deepEqual(
    sorted.map((e) => e.book.id),
    ["b.epub", "a.epub"],
    "b.epub was added second, so it must sort first under 「最近添加」"
  );
});

// ---------------------------------------------------------------------------
// Finding 3 (P1): load() rebuilds every rich-metadata entry from scratch and
// drops every field it does not explicitly know about — so publisher,
// published, identifier, description and languages are destroyed on every
// Obsidian restart, permanently.
// ---------------------------------------------------------------------------

test("ObsidianAnnotationStore: rich metadata survives a restart with all fields intact", async () => {
  const plugin = new FakePlugin();
  const store = new ObsidianAnnotationStore(plugin as unknown as never);
  await seedSnapshot(store);

  const full: BookMetadata = {
    title: "地震学导论",
    authors: ["万永革"],
    publisher: "中国地质大学出版社",
    published: "2018",
    identifier: "978-7-5623",
    description: "一本讲地震学的书",
    languages: ["zh", "en"],
    cachedAt: 1_700_000_000_000
  };
  await store.saveRichMetadata("b.epub", full);

  // Simulate a restart: fresh store instance over the same data.json.
  const reloaded = new ObsidianAnnotationStore(plugin as unknown as never);
  const after = await reloaded.loadRichMetadata("b.epub");

  assert.deepEqual(
    after,
    full,
    "every persisted metadata field must round-trip through a restart"
  );
});

test("ObsidianAnnotationStore: a second restart is idempotent (no progressive field loss)", async () => {
  const plugin = new FakePlugin();
  const store = new ObsidianAnnotationStore(plugin as unknown as never);
  await seedSnapshot(store);
  await store.saveRichMetadata("b.epub", {
    title: "T",
    authors: ["A"],
    publisher: "P",
    languages: ["zh"],
    cachedAt: 5
  });

  const second = await new ObsidianAnnotationStore(plugin as unknown as never).loadRichMetadata("b.epub");
  await new ObsidianAnnotationStore(plugin as unknown as never).saveRichMetadata("b.epub", second!);
  const third = await new ObsidianAnnotationStore(plugin as unknown as never).loadRichMetadata("b.epub");

  assert.deepEqual(third, second);
});

// ---------------------------------------------------------------------------
// Finding 4 (P1): every re-run of doInitialize() registers another
// `source.watch()`. The `entries.size === 0` guard means an empty vault
// re-scans and re-registers on every add/remove cycle, leaking 4 vault
// event listeners per cycle and firing every handler once per leaked
// registration (O(n^2) handler invocations).
// ---------------------------------------------------------------------------

test("LibraryService: watch is registered exactly once even when the vault starts empty", async () => {
  const store = emptyStore();
  await seedSnapshot(store);
  const source = new StaticSource([]);
  const library = new LibraryService(source, store);

  await library.initialize();
  assert.equal(source.watchCount, 1, "first initialize registers one watch");

  // Cycle the vault through empty → one book → empty, exactly as a user
  // dragging a file in and then deleting it would. Each cycle currently
  // re-enters doInitialize() because the entries guard only trips when
  // entries.size > 0.
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };

  source.locators = [locatorOf("a.epub", 1)];
  source.emit({ kind: "added", path: "a.epub", format: "epub" });
  await settle();

  source.locators = [];
  source.emit({ kind: "removed", path: "a.epub", format: "epub" });
  await settle();

  source.locators = [locatorOf("b.epub", 1)];
  source.emit({ kind: "added", path: "b.epub", format: "epub" });
  await settle();

  assert.equal(
    source.watchCount,
    1,
    `a second watch registration doubles every handler invocation; got ${source.watchCount}`
  );
});

// ---------------------------------------------------------------------------
// Finding 5 (P2): core/ must not import from adapters/, but ReadingService
// and LibraryService both reach into adapters/obsidian/dailyReadingTime via
// a dynamic import, with a comment claiming the opposite keeps the graph
// one-way.
// ---------------------------------------------------------------------------

test("layering: core/ must not depend on adapters/ (daily reading aggregation)", async () => {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = new URL("../../../src/core/", import.meta.url).pathname;

  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts")) continue;
      // Strip comments: several files name the old `../../adapters/...`
      // specifier in a doc comment explaining what was moved. Scanning raw
      // text would flag the explanation instead of the code.
      const text = readFileSync(full, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
      if (/from\s+"\.\.\/\.\.\/adapters/.test(text) || /import\("\.\.\/\.\.\/adapters/.test(text)) {
        offenders.push(full.slice(root.length));
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], `core/ reached into adapters/: ${offenders.join(", ")}`);
});