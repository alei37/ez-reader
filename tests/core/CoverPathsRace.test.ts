import { test } from "node:test";
import assert from "node:assert/strict";
import { ObsidianAnnotationStore } from "../../src/adapters/obsidian/ObsidianAnnotationStore";

/**
 * Locks the read-modify-write atomicity of `patchCoverPaths` — the P0-3
 * fix for concurrent cover extraction losing entries. Two concurrent
 * patches must both land in the persisted map; the old `loadCoverPaths
 * + saveCoverPaths` pattern would silently drop one entry because both
 * callers snapshotted the same pre-write state.
 */
class FakePlugin {
  private store: Record<string, unknown> = {};
  async loadData(): Promise<Record<string, unknown>> {
    return this.store;
  }
  async saveData(data: Record<string, unknown>): Promise<void> {
    this.store = data;
  }
}

const emptySnapshot = (): unknown => ({
  version: 1,
  settings: {},
  library: [],
  reading: [],
  bookmarks: [],
  excerpts: []
});

test("patchCoverPaths: concurrent patches both land", async () => {
  const plugin = new FakePlugin();
  const store = new ObsidianAnnotationStore(plugin as unknown as never);
  // Seed an empty snapshot so load() returns something with coverPaths defined.
  await store.save(emptySnapshot() as never);
  await store.saveCoverPaths({});

  // Two concurrent callers — old pattern (load then save) would have
  // both read {} and the second save would clobber the first.
  await Promise.all([
    store.patchCoverPaths((cur) => ({ ...cur, book1: "/cover1.png" })),
    store.patchCoverPaths((cur) => ({ ...cur, book2: "/cover2.png" }))
  ]);

  const final = await store.loadCoverPaths();
  assert.equal(final.book1, "/cover1.png");
  assert.equal(final.book2, "/cover2.png");
});

test("patchCoverPaths: many concurrent patches all land", async () => {
  const plugin = new FakePlugin();
  const store = new ObsidianAnnotationStore(plugin as unknown as never);
  await store.save(emptySnapshot() as never);
  await store.saveCoverPaths({});

  const N = 20;
  await Promise.all(
    Array.from({ length: N }, (_, i) =>
      store.patchCoverPaths((cur) => ({ ...cur, [`book${i}`]: `/c${i}.png` }))
    )
  );

  const final = await store.loadCoverPaths();
  for (let i = 0; i < N; i++) {
    assert.equal(final[`book${i}`], `/c${i}.png`, `book${i} should have its cover path`);
  }
});
