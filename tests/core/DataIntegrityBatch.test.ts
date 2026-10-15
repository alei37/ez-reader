import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sanitizeBookMetadata } from "../../src/core/utils/metadata";
import { ObsidianAnnotationStore } from "../../src/adapters/obsidian/ObsidianAnnotationStore";
import { LibraryService } from "../../src/core/services/LibraryService";
import type { BookLocator, BookMetadata } from "../../src/core/entities/Book";
import type { BookChangeEvent, BookSource } from "../../src/core/ports/BookSource";

/**
 * Regression cover for the batch-C fixes: rich-metadata field loss, the
 * unguarded data import, cross-book progress bleed, togglePin lost updates,
 * the addedDesc sort key, the duplicate source watch, and core → adapters.
 */

const ROOT = new URL("../../../", import.meta.url).pathname;
const read = (rel: string): string =>
  readFileSync(`${ROOT}${rel}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

class FakePlugin {
  private store: Record<string, unknown> = {};
  async loadData(): Promise<Record<string, unknown>> {
    return this.store;
  }
  async saveData(data: Record<string, unknown>): Promise<void> {
    this.store = data;
  }
}

const seed = async (store: ObsidianAnnotationStore): Promise<void> => {
  await store.save({
    version: 1,
    settings: undefined as never,
    library: [],
    reading: [],
    bookmarks: [],
    excerpts: []
  } as never);
};

// ---------------------------------------------------------------------------
// 1. Rich metadata must survive a restart field for field.
// ---------------------------------------------------------------------------

test("sanitizeBookMetadata keeps every known field", () => {
  const full = {
    title: "  地震学导论  ",
    authors: ["万永革", "  ", 42, "李四"],
    publisher: "中国地质大学出版社",
    published: "2018",
    languages: ["zh", "en-US", "not a tag", ""],
    identifier: "978-7-5623",
    description: "一本讲地震学的书",
    cachedAt: 1_700_000_000_000
  };
  const out = sanitizeBookMetadata(full);
  assert.equal(out.title, "地震学导论", "title is trimmed");
  assert.deepEqual(out.authors, ["万永革", "李四"], "non-strings and blanks dropped");
  assert.equal(out.publisher, "中国地质大学出版社");
  assert.equal(out.published, "2018");
  assert.equal(out.identifier, "978-7-5623");
  assert.equal(out.description, "一本讲地震学的书");
  assert.deepEqual(out.languages, ["zh", "en-US"], "malformed locale tags dropped, valid ones kept");
  assert.equal(out.cachedAt, 1_700_000_000_000);
});

test("sanitizeBookMetadata passes unknown fields through", () => {
  // So adding a field to BookMetadata later cannot shred existing data.json
  // through this path again.
  const out = sanitizeBookMetadata({
    title: "T",
    authors: [],
    languages: [],
    cachedAt: 1,
    futureField: { nested: true },
    anotherOne: ["x"]
  });
  assert.deepEqual((out as unknown as Record<string, unknown>).futureField, { nested: true });
  assert.deepEqual((out as unknown as Record<string, unknown>).anotherOne, ["x"]);
});

test("sanitizeBookMetadata gives up on a corrupt cachedAt rather than pinning the entry", () => {
  assert.ok(sanitizeBookMetadata({ title: "T", cachedAt: 0 }).cachedAt > 0);
  assert.ok(sanitizeBookMetadata({ title: "T", cachedAt: Number.NaN }).cachedAt > 0);
  assert.ok(sanitizeBookMetadata({ title: "T" }).cachedAt > 0);
});

test("rich metadata round-trips through a restart", async () => {
  const plugin = new FakePlugin();
  const store = new ObsidianAnnotationStore(plugin as unknown as never);
  await seed(store);

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

  const after = await new ObsidianAnnotationStore(plugin as unknown as never).loadRichMetadata("b.epub");
  assert.deepEqual(after, full, "every persisted field must survive a restart");

  // And a third cycle must not degrade anything further.
  const third = new ObsidianAnnotationStore(plugin as unknown as never);
  await third.saveRichMetadata("b.epub", after!);
  const final = await new ObsidianAnnotationStore(plugin as unknown as never).loadRichMetadata("b.epub");
  assert.deepEqual(final, after, "repeated restarts must be idempotent");
});

test("the store no longer rebuilds languages as an empty array", () => {
  const source = read("src/adapters/obsidian/ObsidianAnnotationStore.ts");
  assert.doesNotMatch(source, /languages: \[\]/, "languages must come from the stored value");
  assert.match(source, /sanitizeBookMetadata\(m\)/);
});

// ---------------------------------------------------------------------------
// 2. Import must not be a silent full overwrite.
// ---------------------------------------------------------------------------

test("import asks for confirmation and backs up before overwriting", () => {
  const source = read("src/ui/settings/SettingsTab.ts");
  const importBody = source.slice(
    source.indexOf("private async importData("),
    source.indexOf("private async backupCurrentData(")
  );
  // Confirmation must come before the save, not after.
  const confirmAt = importBody.indexOf("ConfirmModal");
  const saveAt = importBody.indexOf("this.annotations.save(");
  const backupAt = importBody.indexOf("this.backupCurrentData()");
  assert.ok(confirmAt > 0, "import must confirm with the user");
  assert.ok(backupAt > 0, "import must back the current data up first");
  assert.ok(confirmAt < saveAt, "confirmation must precede the destructive write");
  assert.ok(backupAt < saveAt, "the backup must be taken before the destructive write");
  assert.match(source, /openAndWait\(\)/);
  // ...and actually honour the answer. Showing a modal whose result is
  // discarded is worse than no modal at all.
  assert.match(
    importBody,
    /if \(!ok\) \{[\s\S]{0,120}return;/,
    "declining the confirmation must abort before the write"
  );
});

test("the backup writes to the plugin folder, not through the store it is protecting", () => {
  const source = read("src/ui/settings/SettingsTab.ts");
  const backup = source.slice(source.indexOf("private async backupCurrentData("));
  assert.match(backup, /ezreader\/backups/, "backups belong next to the user's other ez-reader data");
  assert.match(backup, /adapter\.writeBinary/);
  // Reading the snapshot is fine; writing through annotations.save would recurse
  // straight back into the thing we are about to overwrite.
  const backupSaves = backup.match(/annotations\.save\(/g) ?? [];
  assert.deepEqual(backupSaves, []);
});

// ---------------------------------------------------------------------------
// 3. setEntry must drop the pending progress write.
// ---------------------------------------------------------------------------

test("setEntry clears the pending progress debounce", () => {
  const source = read("src/ui/reader/ReaderView.ts");
  const start = source.indexOf("setEntry(entry: LibraryEntry): void {");
  assert.ok(start > 0, "setEntry must exist");
  const end = source.indexOf("private async openSessionInner(");
  assert.ok(end > start, `openSessionInner must follow setEntry (start=${start}, end=${end})`);
  const setEntry = source.slice(start, end);
  assert.match(
    setEntry,
    /clearTimeout\(this\.persistProgressTimer\)/,
    "a pending progress write would land on the next book with the previous book's locator"
  );
  assert.match(setEntry, /this\.persistProgressPending = undefined;/);
});

// ---------------------------------------------------------------------------
// 4. togglePin must be atomic.
// ---------------------------------------------------------------------------

const locatorOf = (path: string, modifiedAt: number): BookLocator => ({
  path,
  format: "epub",
  sizeBytes: 1,
  modifiedAt
});

class StubSource implements BookSource {
  constructor(private readonly locators: ReadonlyArray<BookLocator>) {}
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
  watch(): { dispose: () => void } {
    return { dispose: () => undefined };
  }
}

test("two concurrent togglePin calls actually toggle, not just re-pin", async () => {
  const plugin = new FakePlugin();
  const store = new ObsidianAnnotationStore(plugin as unknown as never);
  await seed(store);
  const library = new LibraryService(new StubSource([locatorOf("a.epub", 1)]), store);
  await library.initialize();
  await library.addToLibrary("a.epub");

  // The old code read `entry.book.pinnedAt` outside the store's write chain,
  // so both calls saw `null` and both wrote the same pinned timestamp.
  await Promise.all([library.togglePin("a.epub"), library.togglePin("a.epub")]);

  assert.equal(await store.getPinnedAt("a.epub"), null, "a double-toggle must end up back at unpinned");
});

// ---------------------------------------------------------------------------
// 5. addedDesc must key off addedToLibraryAt, not the file's mtime.
// ---------------------------------------------------------------------------

test("addedDesc sorts by when the book joined the library", async () => {
  const plugin = new FakePlugin();
  const store = new ObsidianAnnotationStore(plugin as unknown as never);
  await seed(store);
  // a.epub added first but its file was touched most recently.
  const library = new LibraryService(
    new StubSource([locatorOf("a.epub", 9_000), locatorOf("b.epub", 1_000)]),
    store
  );
  await library.initialize();
  await library.addToLibrary("a.epub", 1_000);
  await library.addToLibrary("b.epub", 2_000);

  assert.deepEqual(
    library.list(undefined, "addedDesc").map((e) => e.book.id),
    ["b.epub", "a.epub"],
    "「最近添加」must follow the add timestamp"
  );
});

// ---------------------------------------------------------------------------
// 6. The source watch must be registered once.
// ---------------------------------------------------------------------------

test("an empty vault does not re-register the source watch on every add", async () => {
  const plugin = new FakePlugin();
  const store = new ObsidianAnnotationStore(plugin as unknown as never);
  await seed(store);

  let handler: ((event: BookChangeEvent) => void) | null = null;
  let watchCount = 0;
  const source: BookSource = {
    async *scan() {
      /* starts empty */
    },
    resolveId: (l) => l.path,
    readMetadata: async () => null,
    lookup: async (p) => (p === "a.epub" ? locatorOf("a.epub", 1) : null),
    watch(h) {
      watchCount += 1;
      handler = h;
      return { dispose: () => undefined };
    }
  };

  const library = new LibraryService(source, store);
  await library.initialize();
  assert.equal(watchCount, 1);

  const settle = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  // Add then remove, twice. Each cycle returned the shelf to `entries.size === 0`,
  // which used to re-enter doInitialize() and register another 4 listeners.
  for (const path of ["a.epub", "b.epub"]) {
    handler?.({ kind: "added", path, format: "epub" });
    await settle();
    handler?.({ kind: "removed", path, format: "epub" });
    await settle();
  }

  assert.equal(watchCount, 1, `watch must be registered once, got ${watchCount}`);
  assert.equal(library.list().length, 0);
});

// ---------------------------------------------------------------------------
// 7. Layering.
// ---------------------------------------------------------------------------

test("daily reading aggregation lives in core, not adapters", () => {
  assert.match(read("src/core/utils/dailyReadingTime.ts"), /export const aggregateDailyReadingTime/);
  const coreFiles = ["src/core/services/ReadingService.ts", "src/core/services/LibraryService.ts"];
  for (const rel of coreFiles) {
    assert.doesNotMatch(read(rel), /adapters\//, `${rel} must not reach into adapters/`);
  }
});