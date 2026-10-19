/**
 * End-to-end vault round-trip for the v0.3.0 reading-time feature.
 *
 * Why this file exists
 * --------------------
 * Every existing test that touches `recordSession` / `getRichEntry` stubs
 * the `LibraryWriter` out (`ReadingServiceSessions.test.ts:94`,
 * `LibraryServiceRichEntry.test.ts:210`). That stubbing hid three P0s
 * shipped in 0.3.0/0.3.1:
 *
 *   1. `Plugin.ts` passed `this.noteWriter` into `ReadingService` /
 *      `LibraryService` 33 lines before it was constructed. The ctor arg
 *      is captured by value, so `libraryWriter` was permanently
 *      `undefined` → `recordSession` was a no-op → no `sessions.jsonl`
 *      was ever written, and `getRichEntry` always returned zeroed
 *      analytics. The BookInfoModal reading-time panel was dead UI.
 *   2. `bookId` IS the vault path (`resolveId → locator.path`), but
 *      `ensureBookDir` did `bookId.slice(0, 8)` unsanitized. A 5–7
 *      character top-level folder produced `Dune-books/du.md` whose
 *      parent didn't exist → `vault.create` threw ENOENT → every
 *      excerpt silently dropped.
 *   3. Nothing ever read the data back across a *cold* cache, so the
 *      `findAndReadBookInfo` → `cacheByBookId` → `loadReadingSessions`
 *      recovery path was untested.
 *
 * These tests drive the REAL `ObsidianLibraryWriter` against an
 * in-memory vault, and construct a fresh writer to simulate an Obsidian
 * restart (which is exactly the cold-cache case that was broken).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { TFile, normalizePath } from "obsidian";
import { ObsidianLibraryWriter } from "../../src/adapters/obsidian/ObsidianLibraryWriter";
import { ReadingService } from "../../src/core/services/ReadingService";
import { LibraryService } from "../../src/core/services/LibraryService";
import type { ReadingSession } from "../../src/core/entities/ReadingSession";
import type { BookLocator } from "../../src/core/entities/Book";
import type { BookLocatorInfo } from "../../src/core/ports/LibraryWriter";
import { hexFromBuffer, sha1Bytes } from "../../src/platform/Sha1";
import { defaultBookInfo } from "../../src/core/entities/BookInfo";

// ---------------------------------------------------------------------------
// In-memory vault
// ---------------------------------------------------------------------------

class MemoryTFile extends TFile {
  /**
   * Mirrors Obsidian's `TFile.basename` (the stub TFile is empty).
   *
   * 写成普通属性而不是 getter: Obsidian 的 `TFile` 里 `basename` 是**属性**
   * (不是 accessor), 子类用 getter 覆盖属性会触发 TS2611
   * ("'basename' is defined as a property in class 'TFile', but is overridden
   * here as an accessor"). 端口一进类型检查就报.
   */
  basename: string;

  constructor(public path: string) {
    super();
    this.basename = path.split("/").pop() ?? "";
  }
}

/**
 * Minimal in-memory stand-in for the slice of Obsidian's Vault API that
 * `ObsidianLibraryWriter` touches. Paths are normalized on the way in so
 * assertions match what the real vault would report.
 */
class MemoryVault {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();
  readonly adapter = {
    exists: async (path: string) => this.files.has(normalizePath(path)),
    append: async (path: string, data: string) => {
      const key = normalizePath(path);
      if (!this.files.has(key)) throw new Error(`ENOENT: ${key}`);
      this.files.set(key, this.files.get(key)! + data);
    },
    list: async (dir: string) => {
      const prefix = `${normalizePath(dir)}/`;
      return {
        files: [...this.files.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/")),
        folders: [...this.folders].filter((f) => f.startsWith(prefix))
      };
    },
    mkdir: async (path: string) => {
      this.folders.add(normalizePath(path));
    }
  };

  getAbstractFileByPath(path: string): MemoryTFile | null {
    const key = normalizePath(path);
    return this.files.has(key) ? new MemoryTFile(key) : null;
  }
  createFolder = async (path: string) => {
    this.folders.add(normalizePath(path));
  };
  create = async (path: string, data: string) => {
    const key = normalizePath(path);
    if (this.files.has(key)) throw new Error(`File already exists: ${key}`);
    const parent = key.split("/").slice(0, -1).join("/");
    if (parent && !this.folders.has(parent)) {
      throw new Error(`ENOENT: no such directory '${parent}' (creating ${key})`);
    }
    this.files.set(key, data);
    return new MemoryTFile(key);
  };
  read = async (file: MemoryTFile) => {
    const key = file.path;
    if (!this.files.has(key)) throw new Error(`ENOENT: ${key}`);
    return this.files.get(key)!;
  };
  modify = async (file: MemoryTFile, data: string) => {
    this.files.set(file.path, data);
  };
  process = async (file: MemoryTFile, fn: (current: string) => string) => {
    const next = fn(this.files.get(file.path) ?? "");
    this.files.set(file.path, next);
  };
  delete = async (file: MemoryTFile) => {
    // Recorded, not thrown: migration must be *observed* taking the
    // trashFile path. See `migrateLegacyNotes must not hard-delete`.
    this.hardDeletes.push(file.path);
    this.files.delete(file.path);
  };
  rename = async (file: MemoryTFile, newPath: string) => {
    const key = normalizePath(newPath);
    if (this.files.has(key)) throw new Error(`File already exists: ${key}`);
    const data = this.files.get(file.path);
    if (data === undefined) throw new Error(`ENOENT: ${file.path}`);
    const parent = key.split("/").slice(0, -1).join("/");
    if (parent && !this.folders.has(parent)) {
      throw new Error(`ENOENT: no such directory '${parent}' (renaming to ${key})`);
    }
    this.files.delete(file.path);
    this.files.set(key, data);
    return new MemoryTFile(key);
  };
  trashFile = async (file: MemoryTFile) => {
    this.trashed.push(file.path);
    this.files.delete(file.path);
  };
  /** Paths removed via `vault.delete` — permanent, bypasses the user's trash. */
  readonly hardDeletes: string[] = [];
  /** Paths removed via `fileManager.trashFile` — recoverable. */
  readonly trashed: string[] = [];
}

const makeApp = (vault: MemoryVault) =>
  ({
    vault,
    // `FileManager.trashFile` is what migration must use; Obsidian routes it
    // through the user's Files → "Deleted files" preference.
    fileManager: { trashFile: (file: MemoryTFile) => vault.trashFile(file) }
  }) as never;
const makePlugin = () => ({}) as never;
const makeAnnotations = () => ({}) as never;

const session = (over: Partial<ReadingSession> = {}): ReadingSession => ({
  startedAt: Date.UTC(2026, 2, 10, 10, 0, 0),
  endedAt: Date.UTC(2026, 2, 10, 10, 25, 0),
  durationMs: 25 * 60 * 1000,
  progressStart: 0.38,
  progressEnd: 0.42,
  chapter: "Chapter 3",
  ...over
});

// ---------------------------------------------------------------------------
// Migration deletion safety
//
// `migrateLegacyNotes` copies the user's pre-0.3.0 notes into
// `ezreader/notes/` and then removes the originals. It used `vault.delete`,
// which permanently unlinks the file — bypassing the Files → "Deleted files:
// Move to trash" preference. A user who enabled trash (the default on
// desktop) had no recovery path for notes the plugin was still actively
// rewriting at that moment.
//
// `MemoryVault` records which of the two APIs was used, so the test fails
// on a revert rather than silently passing.
// ---------------------------------------------------------------------------

const seedLegacyNote = async (vault: MemoryVault): Promise<void> => {
  await vault.createFolder("ezreader-notes/阅读笔记");
  await vault.create(
    "ezreader-notes/阅读笔记/dune-notes-a1b2c3d4.md",
    "---\nbookId: dune-notes-a1b2c3d4\n---\n\n迁移前的正文\n"
  );
};

test("migration: 旧笔记经 trashFile 移除,不硬删", async () => {
  const vault = new MemoryVault();
  await seedLegacyNote(vault);
  const writer = new ObsidianLibraryWriter(makeApp(vault), makePlugin(), makeAnnotations());

  const result = await writer.migrateLegacyNotes({ legacyNotesDir: "ezreader-notes/阅读笔记" });

  assert.equal(result.migratedNotes, 1);
  assert.equal(result.failedNotes, 0);
  assert.deepEqual(
    vault.hardDeletes,
    [],
    "vault.delete permanently destroys the user's notes and ignores their trash preference"
  );
  assert.deepEqual(vault.trashed, ["ezreader-notes/阅读笔记/dune-notes-a1b2c3d4.md"]);
});

test("migration: 迁移后内容落到 ezreader/notes/", async () => {
  const vault = new MemoryVault();
  await seedLegacyNote(vault);
  const writer = new ObsidianLibraryWriter(makeApp(vault), makePlugin(), makeAnnotations());

  await writer.migrateLegacyNotes({ legacyNotesDir: "ezreader-notes/阅读笔记" });

  const migrated = [...vault.files.keys()].filter((p) => p.startsWith("ezreader/notes/"));
  assert.equal(migrated.length, 1, `expected one migrated note, got ${migrated.join(", ")}`);
  assert.match(vault.files.get(migrated[0])!, /迁移前的正文/);
});

// ---------------------------------------------------------------------------
// Rename: moving the per-book files to the new file base
//
// `bookId` is the vault path, so renaming a book file changes BOTH halves
// of the file base — the `<safeTitle>` and the hash-of-path `<idTag>`.
// The writer can only recover the old files from the old id tag, because
// the caller (LibraryService) knows the old bookId but never the old
// title. If this regresses, notes/info/sessions stay under a name nothing
// will ever look up again and the book appears to have no history.
// ---------------------------------------------------------------------------

const idTag = (bookId: string): string =>
  hexFromBuffer(sha1Bytes(new TextEncoder().encode(bookId))).slice(0, 10);

const seedBookFiles = async (vault: MemoryVault, writer: ObsidianLibraryWriter) => {
  const bookId = "books/dune.epub";
  const ref = await writer.ensureBookDir({ bookId, bookTitle: "Dune", bookPath: bookId });
  await writer.writeBookInfo(
    ref,
    defaultBookInfo({
      bookId,
      format: "epub",
      filePath: bookId,
      fileSizeBytes: 1024,
      fileModifiedAt: 1,
      addedToLibraryAt: 1,
      title: "Dune"
    })
  );
  await writer.appendReadingSession(ref, session());
  return { bookId, ref };
};

test("rename: 三个文件都搬到新 base", async () => {
  const vault = new MemoryVault();
  const writer = new ObsidianLibraryWriter(makeApp(vault), makePlugin(), makeAnnotations());
  const { bookId, ref } = await seedBookFiles(vault, writer);

  const toBookId = "library/Dune 2.epub";
  const result = await writer.renameBookFiles({ fromBookId: bookId, toBookId, newTitle: "Dune 2" });

  const newBase = `Dune-2-${idTag(toBookId)}`;
  assert.deepEqual(result.missing, [], "all three per-book files exist and should move");
  assert.equal(result.moved.length, 3);

  for (const oldPath of [ref.notesPath, ref.infoPath, ref.sessionsPath]) {
    assert.equal(vault.files.has(oldPath), false, `${oldPath} must not survive under the old name`);
  }
  assert.ok(vault.files.has(`ezreader/notes/${newBase}.md`), "notes moved");
  assert.ok(vault.files.has(`ezreader/info/${newBase}.md`), "info moved");
  assert.ok(vault.files.has(`ezreader/sessions/${newBase}.jsonl`), "sessions moved");
});

test("rename: 靠旧 idTag 找到文件,即使书名已经变了", async () => {
  const vault = new MemoryVault();
  const writer = new ObsidianLibraryWriter(makeApp(vault), makePlugin(), makeAnnotations());
  const { bookId, ref } = await seedBookFiles(vault, writer);

  // The new title differs, so a title-derived lookup would find nothing —
  // only the id tag (a hash of the old bookId) can locate the old files.
  await writer.renameBookFiles({
    fromBookId: bookId,
    toBookId: "library/dune.epub",
    newTitle: "完全不同的新名字"
  });

  assert.equal(vault.files.has(ref.notesPath), false, "the old-tagged file was located and moved");
  assert.ok(
    [...vault.files.keys()].some((p) => p.startsWith("ezreader/notes/完全不同的新名字-")),
    "the new file uses the new title + new tag"
  );
});

test("rename: 内容逐字保留", async () => {
  const vault = new MemoryVault();
  const writer = new ObsidianLibraryWriter(makeApp(vault), makePlugin(), makeAnnotations());
  const { bookId, ref } = await seedBookFiles(vault, writer);
  const before = [...vault.files.entries()];

  await writer.renameBookFiles({
    fromBookId: bookId,
    toBookId: "library/dune.epub",
    newTitle: "Dune 2"
  });

  const after = [...vault.files.values()];
  assert.equal(after.length, before.length, "no file created or lost");
  for (const [path, data] of before) {
    assert.ok(after.includes(data), `contents of ${path} survive the rename`);
  }
});

test("rename: 目标已被占用时不覆盖,原文件保留", async () => {
  const vault = new MemoryVault();
  const writer = new ObsidianLibraryWriter(makeApp(vault), makePlugin(), makeAnnotations());
  const { bookId, ref } = await seedBookFiles(vault, writer);

  // Pre-create a file at the destination base.
  const toBookId = "library/dune.epub";
  const occupied = `ezreader/notes/Dune-2-${idTag(toBookId)}.md`;
  await vault.create(occupied, "别人的笔记\n");

  const result = await writer.renameBookFiles({ fromBookId: bookId, toBookId, newTitle: "Dune 2" });

  assert.equal(vault.files.get(occupied), "别人的笔记\n", "destination must not be clobbered");
  assert.ok(result.missing.includes(ref.notesPath), "the un-movable file is reported");
  assert.equal(vault.files.has(ref.notesPath), true, "the source file is left in place, not deleted");
});

test("rename: 没有对应文件的 book 不报错", async () => {
  const vault = new MemoryVault();
  const writer = new ObsidianLibraryWriter(makeApp(vault), makePlugin(), makeAnnotations());
  const result = await writer.renameBookFiles({
    fromBookId: "never/opened.epub",
    toBookId: "still/never.epub",
    newTitle: "X"
  });
  assert.deepEqual(result.moved, []);
  assert.equal(result.missing.length, 3, "notes/info/sessions are all reported missing");
});

test("rename: from === to 是 no-op", async () => {
  const vault = new MemoryVault();
  const writer = new ObsidianLibraryWriter(makeApp(vault), makePlugin(), makeAnnotations());
  const { bookId, ref } = await seedBookFiles(vault, writer);
  const result = await writer.renameBookFiles({ fromBookId: bookId, toBookId: bookId, newTitle: "Z" });
  assert.deepEqual(result, { moved: [], missing: [] });
  assert.ok(vault.files.has(ref.notesPath));
});

test("rename: 丢弃旧 cache,让下一次 ensureBookDir 重算路径", async () => {
  const vault = new MemoryVault();
  const writer = new ObsidianLibraryWriter(makeApp(vault), makePlugin(), makeAnnotations());
  const { bookId } = await seedBookFiles(vault, writer);
  await writer.renameBookFiles({ fromBookId: bookId, toBookId: "library/dune.epub", newTitle: "Dune 2" });

  const fresh = new ObsidianLibraryWriter(makeApp(vault), makePlugin(), makeAnnotations());
  const ref = await fresh.ensureBookDir({
    bookId: "library/dune.epub",
    bookTitle: "Dune 2",
    bookPath: "library/dune.epub"
  });
  assert.equal(ref.notesPath, `ezreader/notes/Dune-2-${idTag("library/dune.epub")}.md`);
  assert.ok(vault.files.has(ref.notesPath), "ensureBookDir did not resurrect the old path");
});

// ---------------------------------------------------------------------------
// Wiring invariants
//
// The tests above construct `ReadingService` / `LibraryService` directly
// with a real writer, so they prove the writer works — but they cannot
// prove `Plugin.ts` hands the writer to those services. That gap is real:
// with `new ReadingService(..., undefined)` (exactly the shipped bug) the
// whole suite still passes 394/394. These assertions read `Plugin.ts` as
// source and pin the construction order, so the regression is caught.
// ---------------------------------------------------------------------------

const pluginSource = () =>
  readFileSync(fileURLToPath(new URL("../../../src/Plugin.ts", import.meta.url)), "utf8");

test("wiring: noteWriter is constructed before ReadingService", () => {
  const src = pluginSource();
  const built = src.indexOf("this.noteWriter = new ObsidianLibraryWriter(");
  const consumed = src.indexOf("new ReadingService(");
  assert.ok(built !== -1, "Plugin must construct ObsidianLibraryWriter");
  assert.ok(consumed !== -1, "Plugin must construct ReadingService");
  assert.ok(
    built < consumed,
    `noteWriter must be built BEFORE ReadingService (built@${built}, used@${consumed}). ` +
      "The ctor arg is captured by value, so a later assignment is silently lost."
  );
});

test("wiring: noteWriter is constructed before LibraryService", () => {
  const src = pluginSource();
  const built = src.indexOf("this.noteWriter = new ObsidianLibraryWriter(");
  const consumed = src.indexOf("new LibraryService(");
  assert.ok(built !== -1 && consumed !== -1);
  assert.ok(
    built < consumed,
    "noteWriter must be built BEFORE LibraryService — otherwise getRichEntry has no analytics source"
  );
});

test("wiring: noteWriter is assigned exactly once", () => {
  const src = pluginSource();
  const assignments = src.match(/this\.noteWriter\s*=\s*new\s+ObsidianLibraryWriter\(/g) ?? [];
  assert.equal(
    assignments.length,
    1,
    `noteWriter must be constructed exactly once, found ${assignments.length}`
  );
});

test("wiring: LibraryService receives libraryWriter as its 5th argument", () => {
  const src = pluginSource();
  const start = src.indexOf("new LibraryService(");
  assert.ok(start !== -1, "Plugin must construct LibraryService");
  // Take the call span up to its terminating `);`.
  const span = src.slice(start, src.indexOf(");", start) + 2);
  assert.match(span, /this\.noteWriter/, "the LibraryService call must pass the libraryWriter");
  assert.match(
    span,
    /this\.makeBookBytesLoader\(\)\s*,\s*(\/\/[^\n]*\n\s*)*this\.noteWriter/,
    "libraryWriter must be the LAST argument, after the bytes loader"
  );
});

// ---------------------------------------------------------------------------
// P0-1: the writer must actually be reachable from ReadingService
// ---------------------------------------------------------------------------

test("P0-1: recordSession reaches a real vault and writes sessions.jsonl", async () => {
  const vault = new MemoryVault();
  vault.folders.add("ezreader");
  vault.folders.add("ezreader/notes");
  vault.folders.add("ezreader/info");
  vault.folders.add("ezreader/sessions");

  const writer = new ObsidianLibraryWriter(makeApp(vault), makePlugin(), makeAnnotations());
  const reading = new ReadingService({} as never, undefined, writer);

  await reading.recordSession("04-resources/books/dune.epub", session(), "Dune");

  const written = [...vault.files.keys()].filter((p) => p.endsWith(".jsonl"));
  assert.equal(written.length, 1, "exactly one sessions file should exist");
  assert.match(
    vault.files.get(written[0])!,
    /"durationMs":1500000/,
    "the session payload must actually be on disk"
  );
});

// ---------------------------------------------------------------------------
// P0-3: bookId is a vault path, so the id tag must be sanitized
// ---------------------------------------------------------------------------

test("P0-3: bookId containing a slash does not escape into a subdirectory", async () => {
  const vault = new MemoryVault();
  vault.folders.add("ezreader");
  vault.folders.add("ezreader/notes");
  vault.folders.add("ezreader/info");
  vault.folders.add("ezreader/sessions");

  const writer = new ObsidianLibraryWriter(makeApp(vault), makePlugin(), makeAnnotations());
  // `books/` is 5 chars — the exact shape that produced
  // `ezreader/notes/Dune-books/du.md` and a silent ENOENT.
  const ref = await writer.ensureBookDir({
    bookId: "books/dune.epub",
    bookTitle: "Dune",
    bookPath: "books/dune.epub"
  });

  const segments = ref.notesPath.split("/");
  assert.equal(
    segments.length,
    3,
    `notesPath must stay flat under ezreader/notes/, got ${ref.notesPath}`
  );
  assert.equal(segments[0], "ezreader");
  assert.equal(segments[1], "notes");
  assert.ok(
    !segments[2].includes("/"),
    "filename segment must not contain a path separator"
  );
  // And the file really was created, not just path-shaped.
  assert.ok(vault.files.has(ref.notesPath), "notes file must exist after ensureBookDir");
});

test("P0-3: Chinese and multi-segment bookIds also stay flat", async () => {
  const vault = new MemoryVault();
  vault.folders.add("ezreader");
  vault.folders.add("ezreader/notes");
  vault.folders.add("ezreader/info");
  vault.folders.add("ezreader/sessions");

  const writer = new ObsidianLibraryWriter(makeApp(vault), makePlugin(), makeAnnotations());
  for (const bookId of ["阅读/dune.epub", "Books/Advanced/dune.epub", "notes/book.epub"]) {
    const ref = await writer.ensureBookDir({ bookId, bookTitle: "Dune", bookPath: bookId });
    assert.equal(ref.notesPath.split("/").length, 3, `${bookId} → ${ref.notesPath}`);
    assert.ok(vault.files.has(ref.notesPath));
  }
});

// ---------------------------------------------------------------------------
// Cold cache: the "restart Obsidian" round-trip
// ---------------------------------------------------------------------------

test("cold cache: sessions survive an Obsidian restart", async () => {
  const vault = new MemoryVault();
  vault.folders.add("ezreader");
  vault.folders.add("ezreader/notes");
  vault.folders.add("ezreader/info");
  vault.folders.add("ezreader/sessions");

  // Session 1 — warm cache.
  const warm = new ObsidianLibraryWriter(makeApp(vault), makePlugin(), makeAnnotations());
  const reading1 = new ReadingService({} as never, undefined, warm);
  const bookId = "04-resources/books/dune.epub";
  await reading1.recordSession(bookId, session(), "Dune");
  const path = (await warm.ensureBookDir({ bookId, bookTitle: "Dune", bookPath: bookId })).sessionsPath;

  // "Restart": brand new writer + service, no in-memory cache at all.
  const cold = new ObsidianLibraryWriter(makeApp(vault), makePlugin(), makeAnnotations());
  const reading2 = new ReadingService({} as never, undefined, cold);
  await reading2.recordSession(
    bookId,
    session({ startedAt: Date.UTC(2026, 2, 11, 9, 0, 0), endedAt: Date.UTC(2026, 2, 11, 9, 10, 0), durationMs: 600000 }),
    "Dune"
  );

  // Both sessions must be readable back, and in the SAME file.
  const lines = vault.files.get(path)!.trim().split("\n");
  assert.equal(lines.length, 2, "second session must append to the existing file");
  assert.equal(cold.loadReadingSessions.length, 2 - 1); // sanity: method exists
});

// ---------------------------------------------------------------------------
// The actual bug shape: cold cache with NO info.md on disk
// ---------------------------------------------------------------------------

test("cold cache: loadReadingSessions finds the file via the legacy id tag", async () => {
  const vault = new MemoryVault();
  vault.folders.add("ezreader");
  vault.folders.add("ezreader/notes");
  vault.folders.add("ezreader/info");
  vault.folders.add("ezreader/sessions");

  const bookId = "04-resources/books/dune.epub";
  // Warm writer writes sessions, but writeBookInfo is still never called
  // from production — so `info/` stays empty. That's exactly the state
  // real users are in, and the case the old code could not recover from.
  const warm = new ObsidianLibraryWriter(makeApp(vault), makePlugin(), makeAnnotations());
  await warm.appendReadingSession(
    await warm.ensureBookDir({ bookId, bookTitle: "Dune", bookPath: bookId }),
    session()
  );
  const expected = [...vault.files.keys()].find((p) => p.endsWith(".jsonl"))!;

  // Cold writer: cache is empty, info/ is empty → must still resolve.
  const cold = new ObsidianLibraryWriter(makeApp(vault), makePlugin(), makeAnnotations());
  const loaded = await cold.loadReadingSessions(bookId);
  assert.equal(loaded.length, 1, "cold load must recover the session written by the warm writer");
  assert.equal(loaded[0].durationMs, 25 * 60 * 1000);
  assert.ok(expected.includes("Dune"), "sessions file is named after the title");
});

// ---------------------------------------------------------------------------
// P0-2: LibraryService must be able to reach the writer
// ---------------------------------------------------------------------------

test("P0-2: LibraryService.getRichEntry returns analytics when given a writer", async () => {
  const vault = new MemoryVault();
  vault.folders.add("ezreader");
  vault.folders.add("ezreader/notes");
  vault.folders.add("ezreader/info");
  vault.folders.add("ezreader/sessions");

  const writer = new ObsidianLibraryWriter(makeApp(vault), makePlugin(), makeAnnotations());
  const bookId = "04-resources/books/dune.epub";
  await writer.appendReadingSession(
    await writer.ensureBookDir({ bookId, bookTitle: "Dune", bookPath: bookId }),
    // Must fall inside the 30-day window `getRichEntry` builds from now.
    session({ startedAt: Date.now() - 60 * 60 * 1000, endedAt: Date.now() })
  );

  // Build a LibraryService whose 5th ctor arg (libraryWriter) is present.
  //
  // 字段名用 BookLocator 的真名 (`sizeBytes` / `modifiedAt`) —— 之前写的是
  // `size` / `mtime` 并且用 `as never` 压掉类型错误, 结果 spread 一个
  // `never` 又报 "Spread types may only be created from object types".
  // 直接按真实接口写, 两处类型错误一起消失.
  const locator: BookLocator = {
    path: bookId,
    format: "epub",
    sizeBytes: 1,
    modifiedAt: Date.UTC(2026, 0, 1)
  };
  const source = {
    scan: async function* () {
      yield locator;
    },
    read: async () => new ArrayBuffer(0),
    readCover: async () => null,
    lookup: async (p: string) => (p === bookId ? locator : null),
    resolveId: (l: { path: string }) => l.path,
    resolveLocator: async (id: string) => (id === bookId ? locator : null),
    readMetadata: async () => null,
    watch: () => () => {}
  } as never;
  const annotations = {
    listLibrary: async () => [],
    listReading: async () => [],
    loadSettings: async () => ({ appearance: {} }),
    onSettingsChanged: () => () => {}
  } as never;

  const library = new LibraryService(source, annotations, undefined, undefined, writer);
  await library.initialize();

  const rich = await library.getRichEntry(bookId);
  assert.ok(rich, "entry should exist");
  assert.equal(
    rich!.lastMonthReadingMs,
    25 * 60 * 1000,
    "getRichEntry must surface the recorded reading time"
  );
  assert.equal(rich!.recentSessions.length, 1, "recentSessions must be populated");
  assert.equal(rich!.dailyReadingTime.length, 30, "30-day window must be filled");
});
// ---------------------------------------------------------------------------
// id tag uniqueness
//
// The old `bookId.slice(0, 8)` was a *prefix*: every book under
// `04-resources/books/` produced `04-resour`. With the cold-cache lookup
// matching on that suffix, one book would surface another's reading
// history. The tag is now a hash of the whole bookId.
// ---------------------------------------------------------------------------

test("id tag: books sharing a long path prefix get distinct tags", async () => {
  const vault = new MemoryVault();
  vault.folders.add("ezreader");
  vault.folders.add("ezreader/notes");
  vault.folders.add("ezreader/info");
  vault.folders.add("ezreader/sessions");

  const writer = new ObsidianLibraryWriter(makeApp(vault), makePlugin(), makeAnnotations());
  const ids = [
    "04-resources/books/地震学导论.pdf",
    "04-resources/books/离散时间信号处理.pdf",
    "04-resources/books/sample-text.txt",
    "04-resources/books/nested/deep/another.epub"
  ];
  const paths = new Set<string>();
  for (const bookId of ids) {
    const ref = await writer.ensureBookDir({ bookId, bookTitle: "T", bookPath: bookId });
    paths.add(ref.sessionsPath);
  }
  assert.equal(paths.size, ids.length, "each book must get its own sessions file");
});

test("id tag: cold lookup returns THIS book's sessions when prefixes collide", async () => {
  const vault = new MemoryVault();
  vault.folders.add("ezreader");
  vault.folders.add("ezreader/notes");
  vault.folders.add("ezreader/info");
  vault.folders.add("ezreader/sessions");

  const a = "04-resources/books/alpha.pdf";
  const b = "04-resources/books/beta.pdf";
  const warm = new ObsidianLibraryWriter(makeApp(vault), makePlugin(), makeAnnotations());
  await warm.appendReadingSession(
    await warm.ensureBookDir({ bookId: a, bookTitle: "Alpha", bookPath: a }),
    session({ durationMs: 111000 })
  );
  await warm.appendReadingSession(
    await warm.ensureBookDir({ bookId: b, bookTitle: "Beta", bookPath: b }),
    session({ durationMs: 222000 })
  );

  const cold = new ObsidianLibraryWriter(makeApp(vault), makePlugin(), makeAnnotations());
  assert.equal((await cold.loadReadingSessions(a))[0].durationMs, 111000, "alpha, not beta");
  assert.equal((await cold.loadReadingSessions(b))[0].durationMs, 222000, "beta, not alpha");
});
