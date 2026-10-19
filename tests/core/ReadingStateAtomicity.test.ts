import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ReadingService } from "../../src/core/services/ReadingService";
import { ObsidianAnnotationStore } from "../../src/adapters/obsidian/ObsidianAnnotationStore";
import { coverFileStemForTests } from "../../src/adapters/obsidian/CoverCache";
import type { ReadingState } from "../../src/core/entities/ReadingState";

/**
 * Regression cover for the three data-loss fixes:
 *
 *   1. ReadingState read-modify-write is now atomic (`patchReading`)
 *   2. `mutate()` only advances the in-memory cache after saveData confirms
 *   3. Cover file names are hashed, not character-folded
 */

const ROOT = new URL("../../../", import.meta.url).pathname;
const read = (rel: string): string => readFileSync(`${ROOT}${rel}`, "utf8");
/**
 * Source-level assertions must ignore comments — several of these files
 * deliberately quote the expression they replaced in a doc comment, so a raw
 * scan would match the explanation rather than the code.
 */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

class FakePlugin {
  private store: Record<string, unknown> = {};
  /** Flip to make every saveData reject — simulates a full disk / read-only vault. */
  failSaves = false;
  saves = 0;

  async loadData(): Promise<Record<string, unknown>> {
    return this.store;
  }
  async saveData(data: Record<string, unknown>): Promise<void> {
    // Yield so un-awaited continuations interleave the way they would against
    // real filesystem IO.
    await Promise.resolve();
    if (this.failSaves) throw new Error("EACCES: data.json is not writable");
    this.saves += 1;
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

const readingOf = async (store: ObsidianAnnotationStore, bookId: string): Promise<ReadingState> =>
  (await store.listReading()).find((r) => r.bookId === bookId) as ReadingState;

// ---------------------------------------------------------------------------
// 1. ReadingState lost updates.
// ---------------------------------------------------------------------------

test("concurrent addReadingTime + updatePosition keeps both writes", async () => {
  const plugin = new FakePlugin();
  const store = new ObsidianAnnotationStore(plugin as unknown as never);
  await seed(store);
  const reading = new ReadingService(store);

  await Promise.all([
    reading.addReadingTime("b.epub", 60_000),
    reading.updatePosition("b.epub", { kind: "reflow", fraction: 0.42, cfi: "/6/4" })
  ]);

  const final = await readingOf(store, "b.epub");
  assert.equal(final.totalReadingMs, 60_000, "reading time must survive");
  // `position` 是判别联合 (reflow / text / pdf), `cfi` 只存在于 reflow 分支.
  // 先用 assert.ok 收窄到 reflow 分支再断言字段 —— 不需要任何 `as any`.
  const pos = final.position;
  assert.ok(pos !== null && pos.kind === "reflow", "position must be a reflow position");
  assert.equal(pos.cfi, "/6/4", "position must survive");
});

test("concurrent openBook + addReadingTime keeps both lastOpenedAt and totalReadingMs", async () => {
  const plugin = new FakePlugin();
  const store = new ObsidianAnnotationStore(plugin as unknown as never);
  await seed(store);
  const reading = new ReadingService(store);
  const at = 1_700_000_000_000;

  await Promise.all([reading.openBook("b.epub", at), reading.addReadingTime("b.epub", 30_000)]);

  const final = await readingOf(store, "b.epub");
  assert.equal(final.lastOpenedAt, at);
  assert.equal(final.totalReadingMs, 30_000);
  assert.equal(final.status, "reading");
});

test("20 interleaved reading-time flushes accumulate instead of collapsing to one", async () => {
  const plugin = new FakePlugin();
  const store = new ObsidianAnnotationStore(plugin as unknown as never);
  await seed(store);
  const reading = new ReadingService(store);

  await Promise.all(Array.from({ length: 20 }, () => reading.addReadingTime("b.epub", 1_000)));

  const final = await readingOf(store, "b.epub");
  assert.equal(final.totalReadingMs, 20_000, "every flush must be counted exactly once");
});

test("concurrent toggleFavorite / setStatus / updatePosition do not clobber each other", async () => {
  const plugin = new FakePlugin();
  const store = new ObsidianAnnotationStore(plugin as unknown as never);
  await seed(store);
  const reading = new ReadingService(store);

  await Promise.all([
    reading.toggleFavorite("b.epub"),
    reading.setStatus("b.epub", "finished"),
    reading.updatePosition("b.epub", { kind: "reflow", fraction: 0.5 }),
    reading.addReadingTime("b.epub", 5_000)
  ]);

  const final = await readingOf(store, "b.epub");
  assert.equal(final.favorite, true, "favorite flip must survive");
  assert.equal(final.status, "finished", "explicit status must not be re-inferred away");
  assert.equal(final.totalReadingMs, 5_000, "reading time must survive");
  // `fraction` 只存在于 reflow / text 分支, pdf 分支没有 —— 先收窄再断言.
  const pos = final.position;
  assert.ok(pos !== null && pos.kind === "reflow", "position must be a reflow position");
  assert.equal(pos.fraction, 0.5, "position must survive");
});

test("every ReadingState writer goes through patchReading, not upsertReading", () => {
  const source = codeOnly(read("src/core/services/ReadingService.ts"));
  assert.match(source, /private async patchState\(/, "ReadingService needs one atomic writer");
  // upsertReading replaces the whole record, so any leftover call site is a
  // latent lost update again.
  const direct = source.match(/this\.annotations\.upsertReading\(/g) ?? [];
  assert.deepEqual(direct, [], "no method may still call the non-atomic upsertReading");
});

test("patchReading skips the write when the patch returns null", async () => {
  const plugin = new FakePlugin();
  const store = new ObsidianAnnotationStore(plugin as unknown as never);
  await seed(store);
  const before = plugin.saves;
  await store.patchReading("b.epub", () => null);
  assert.equal(plugin.saves, before, "a null patch must not hit the filesystem");
});

// ---------------------------------------------------------------------------
// 2. mutate() must not advance the cache before saveData confirms.
// ---------------------------------------------------------------------------

test("a failed saveData leaves memory consistent with disk", async () => {
  const plugin = new FakePlugin();
  const store = new ObsidianAnnotationStore(plugin as unknown as never);
  await seed(store);
  await store.setPinnedAt("b.epub", 111);

  plugin.failSaves = true;
  await assert.rejects(() => store.setPinnedAt("b.epub", 222), /not writable/);

  // A store constructed fresh must see the same value the failed write was
  // trying to replace — i.e. the failed write left no trace anywhere.
  const fresh = new ObsidianAnnotationStore(plugin as unknown as never);
  assert.equal(await fresh.getPinnedAt("b.epub"), 111, "the failed write must not be visible on disk");
});

test("after a failed write, the next successful write is based on the persisted state", async () => {
  const plugin = new FakePlugin();
  const store = new ObsidianAnnotationStore(plugin as unknown as never);
  await seed(store);
  const reading = new ReadingService(store);

  plugin.failSaves = true;
  await assert.rejects(() => reading.addReadingTime("b.epub", 10_000));

  plugin.failSaves = false;
  await reading.addReadingTime("b.epub", 1_000);

  const fresh = new ObsidianAnnotationStore(plugin as unknown as never);
  const final = (await fresh.listReading()).find((r) => r.bookId === "b.epub") as ReadingState;
  // The lost 10s must not silently reappear via a cache that ran ahead of disk.
  assert.equal(final.totalReadingMs, 1_000);
});

test("mutate() advances the cache only after saveData resolves", () => {
  const source = codeOnly(read("src/adapters/obsidian/ObsidianAnnotationStore.ts"));
  const mutate = source.slice(source.indexOf("private async mutate("), source.indexOf("private sanitizeStringArray("));
  const saveIdx = mutate.indexOf("await this.plugin.saveData(snapshot)");
  const cacheIdx = mutate.indexOf("this.cache = snapshot");
  assert.ok(saveIdx > 0 && cacheIdx > 0, "mutate must contain both statements");
  assert.ok(saveIdx < cacheIdx, "cache must not run ahead of the filesystem");
});

// ---------------------------------------------------------------------------
// 3. Cover file names.
// ---------------------------------------------------------------------------

test("covers of equal-length CJK titles no longer share a file", () => {
  // The old stem folded every non-ASCII character to "_", so any two titles
  // with the same character count produced the same filename — and
  // writeBinary overwrites, so one cover was permanently destroyed.
  const a = coverFileStemForTests("深入理解计算机系统.epub");
  const b = coverFileStemForTests("深入理解操作系统.pdf");
  assert.notEqual(a, b, "equal-length Chinese titles must not collide");
  assert.match(a, /^[0-9a-f]{10}$/);
  assert.match(b, /^[0-9a-f]{10}$/);
});

test("covers of ASCII paths that used to collide are now distinct", () => {
  const a = coverFileStemForTests("books/a b.epub");
  const b = coverFileStemForTests("books/a_b.epub");
  assert.notEqual(a, b);
});

test("the cover stem is derived from the full bookId, not a prefix", () => {
  const a = coverFileStemForTests("04-resources/books/alpha.epub");
  const b = coverFileStemForTests("04-resources/books/alphabet.epub");
  assert.notEqual(a, b, "a shared path prefix must not make two books collide");
});

test("CoverCache has no leftover character-folding derivation", () => {
  const source = codeOnly(read("src/adapters/obsidian/CoverCache.ts"));
  const fold = source.match(/replace\(\/\[\^A-Za-z0-9\._-\]\/g, "_"\)/g) ?? [];
  assert.deepEqual(fold, [], "the lossy per-character folding must be gone from CoverCache");
  assert.match(source, /const safeId = coverFileStem\(book\.id\);/);
});