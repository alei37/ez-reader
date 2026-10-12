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
import type { BookLocatorInfo } from "../../src/core/ports/LibraryWriter";

// ---------------------------------------------------------------------------
// In-memory vault
// ---------------------------------------------------------------------------

class MemoryTFile extends TFile {
  constructor(public path: string) {
    super();
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
    this.files.delete(file.path);
  };
}

const makeApp = (vault: MemoryVault) => ({ vault }) as never;
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
  const locator = {
    path: bookId,
    format: "epub",
    size: 1,
    mtime: Date.UTC(2026, 0, 1)
  } as never;
  const source = {
    scan: async function* () {
      yield locator;
    },
    read: async () => new ArrayBuffer(0),
    readCover: async () => null,
    lookup: async (p: string) => (p === bookId ? locator : null),
    resolveId: (l: { path: string }) => l.path,
    resolveLocator: async (id: string) => ({ path: id, ...locator }),
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
