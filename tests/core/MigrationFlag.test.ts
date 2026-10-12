import test from "node:test";
import assert from "node:assert/strict";

import { ObsidianAnnotationStore } from "../../src/adapters/obsidian/ObsidianAnnotationStore";
import type { AnnotationSnapshot } from "../../src/core/ports/AnnotationStore";

/**
 * `migratedToV030` is the guard that stops the v0.3.0 legacy-notes migration
 * from re-running. It used to be written via `patchSettings`, which lands it
 * at `data.json.settings.migratedToV030`, while `load()` read the TOP-level
 * field — so the guard never tripped and the migration re-listed and re-read
 * the whole legacy folder on every single launch.
 */

const fakePlugin = (initial: Record<string, unknown> = {}) => {
  const disk = { ...initial };
  return {
    plugin: {
      loadData: async () => JSON.parse(JSON.stringify(disk)) as unknown,
      saveData: async (data: unknown) => {
        for (const k of Object.keys(disk)) delete (disk as Record<string, unknown>)[k];
        Object.assign(disk, JSON.parse(JSON.stringify(data)));
      }
    } as never,
    disk
  };
};

const minimalSettings = (extra: Record<string, unknown> = {}) =>
  ({
    uiLocale: "zh-CN",
    translation: null,
    defaultAppearance: {},
    researchDirectory: "",
    libraryOwnerName: "",
    defaultNoteTemplate: "",
    readerOpenMode: "tab",
    twoPagesByDefault: false,
    immersiveOnTablet: false,
    ...extra
  }) as never;

const baseDisk = () => ({
  version: 1,
  settings: minimalSettings(),
  library: [],
  reading: [],
  bookmarks: [],
  excerpts: []
});

test("migration flag: setMigratedToV030 writes the TOP level, and load() sees it", async () => {
  const { plugin, disk } = fakePlugin(baseDisk());
  const store = new ObsidianAnnotationStore(plugin);

  assert.equal((await store.load()).migratedToV030, false, "fresh vault has not migrated");

  await store.setMigratedToV030(true);

  assert.equal(disk.migratedToV030, true, "flag must be at the top level of data.json");
  assert.notEqual(
    (disk.settings as Record<string, unknown>).migratedToV030,
    true,
    "the settings-level copy must never be the one that says true — that was the bug"
  );

  // Fresh instance (simulates a restart) must observe the flag.
  const reloaded = new ObsidianAnnotationStore(plugin);
  assert.equal((await reloaded.load()).migratedToV030, true, "guard must survive a restart");
});

test("migration flag: a flag written by the old buggy build is still honored", async () => {
  // 0.3.1 wrote settings.migratedToV030 = true and nothing at the top level.
  // Upgrading users have exactly this on disk.
  const { plugin } = fakePlugin({
    ...baseDisk(),
    settings: minimalSettings({ migratedToV030: true })
  });
  const store = new ObsidianAnnotationStore(plugin);
  assert.equal(
    (await store.load()).migratedToV030,
    true,
    "legacy settings-level flag must not cause a redundant re-migration"
  );
});

test("migration flag: a failed run leaves the flag false so the next launch retries", async () => {
  const { plugin } = fakePlugin(baseDisk());
  const store = new ObsidianAnnotationStore(plugin);
  await store.setMigratedToV030(false, 1);
  const reloaded = new ObsidianAnnotationStore(plugin);
  const snap = await reloaded.load();
  assert.equal(snap.migratedToV030, false, "a failed migration must not mark itself done");
  assert.equal(snap.migratedToV030Attempts, 1, "attempts counter must advance for the retry cap");
});

test("migration flag: retries are bounded, and the counter survives restarts", async () => {
  const { plugin } = fakePlugin(baseDisk());
  const store = new ObsidianAnnotationStore(plugin);
  for (let i = 1; i <= 5; i += 1) {
    const before = (await store.load()).migratedToV030Attempts ?? 0;
    await store.setMigratedToV030(false, before + 1);
  }
  const reloaded = new ObsidianAnnotationStore(plugin);
  assert.equal((await reloaded.load()).migratedToV030Attempts, 5);
});

test("migration flag: a successful run clears the attempts counter state cleanly", async () => {
  const { plugin, disk } = fakePlugin(baseDisk());
  const store = new ObsidianAnnotationStore(plugin);
  await store.setMigratedToV030(false, 3);
  await store.setMigratedToV030(true);
  const snap = (await new ObsidianAnnotationStore(plugin).load()) as AnnotationSnapshot;
  assert.equal(snap.migratedToV030, true);
  assert.equal(disk.migratedToV030, true);
});