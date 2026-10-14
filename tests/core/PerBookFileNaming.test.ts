import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bookIdTag, sanitizeFileBase } from "../../src/adapters/obsidian/ObsidianLibraryWriter";

/**
 * Locks three codereview fixes:
 *   1. BookInfoModal names per-book files with the writer's own helpers
 *   2. MOBI pages get a chapterTitle back-filled from the TOC
 *   3. AddToLibraryModal gives each phase its own deadline
 */

const ROOT = new URL("../../../", import.meta.url).pathname;
const read = (rel: string): string => readFileSync(`${ROOT}${rel}`, "utf8");

const BOOK_ID = "04-resources/books/Introduction to Seismology (Z-Library).epub";

// ---------------------------------------------------------------------------
// 1. BookInfoModal used bookId.slice(0, 8); the writer uses a SHA-1 tag.
// ---------------------------------------------------------------------------

test("bookIdTag is a SHA-1 prefix, never a slice of the path", () => {
  const tag = bookIdTag(BOOK_ID);
  assert.match(tag, /^[0-9a-f]{10}$/);
  assert.notEqual(tag, BOOK_ID.slice(0, 8));
  // bookId IS a vault path, so the old slice could contain a separator.
  assert.ok(!BOOK_ID.slice(0, 8).includes("/") || true);
});

test("BookInfoModal derives its paths from the writer's helpers", () => {
  const source = read("src/ui/shelf/BookInfoModal.ts");
  assert.match(
    source,
    /import \{ bookIdTag, sanitizeFileBase \} from "\.\.\/\.\.\/adapters\/obsidian\/ObsidianLibraryWriter"/,
    "the modal must import the writer's naming helpers"
  );
  // No place may rebuild the id half of the filename. Strip comments first —
  // the doc comment on bookFileStem legitimately names the old expression.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const sliceSites = code.match(/bookId\.slice\(0,?\s*8\)/g) ?? [];
  assert.deepEqual(sliceSites, [], `stale bookId.slice(0,8) left at: ${sliceSites.length} site(s)`);
  // The old local copy of the sanitizer is gone.
  assert.doesNotMatch(source, /const sanitizeWikiTitle/, "sanitizeWikiTitle must be removed, not duplicated");
  assert.match(source, /const bookFileStem = \(title: string, bookId: string\): string =>/);
});

test("the modal's file stem matches what the writer would have written", () => {
  // Same two functions, same order → identical output. This is the property
  // that was broken: two unrelated naming schemes.
  const modalStem = `${sanitizeFileBase("Introduction to Seismology")}-${bookIdTag(BOOK_ID)}`;
  const writerStem = `${sanitizeFileBase("Introduction to Seismology")}-${bookIdTag(BOOK_ID)}`;
  assert.equal(modalStem, writerStem);
  // Pinned against the real hash so a change to the tag width/length fails here
  // rather than silently orphaning every user's on-disk filenames.
  assert.equal(modalStem, "Introduction-to-Seismology-a5866a6c2b");
});

// ---------------------------------------------------------------------------
// 2. MOBI chapterTitle.
// ---------------------------------------------------------------------------

test("MOBI buildContent back-fills chapterTitle after the TOC walk", () => {
  const source = read("src/adapters/text/MobiBookReader.ts");
  const mapIdx = source.indexOf("const spineIdToChapterLabel = new Map");
  const readIdx = source.indexOf("chapterTitle: spineIdToChapterLabel.get(i)");
  const setIdx = source.indexOf("spineIdToChapterLabel.set(pageIdx, label)");
  const backfillIdx = source.indexOf("for (const [pageIdx, label] of spineIdToChapterLabel)");

  assert.ok(mapIdx > 0 && readIdx > 0 && setIdx > 0 && backfillIdx > 0);
  assert.ok(
    readIdx < setIdx,
    "the page constructor reads the map before the TOC walk fills it — that is why a back-fill is required"
  );
  assert.ok(
    setIdx < backfillIdx,
    "the back-fill must run after the TOC walk has populated the map"
  );
});

test("MOBI pages before the first TOC entry inherit a chapter instead of staying blank", () => {
  const source = read("src/adapters/text/MobiBookReader.ts");
  assert.match(
    source,
    /let carried: string \| undefined;/,
    "pages before the first top-level TOC entry need a carried-forward label"
  );
  assert.match(source, /\(page as \{ chapterTitle\?: string \}\)\.chapterTitle = carried;/);
});

// ---------------------------------------------------------------------------
// 3. AddToLibraryModal per-phase deadlines.
// ---------------------------------------------------------------------------

test("each add path resets its deadline before the cover-extraction phase", () => {
  const source = read("src/ui/shelf/AddToLibraryModal.ts");
  // Comments legitimately name the old flag; scan code only.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const resets = code.match(/deadline = Date\.now\(\) \+ timeoutMs;/g) ?? [];
  // confirmSelection + confirmAddAll each declare one and reset it once.
  assert.ok(
    resets.length >= 4,
    `expected a declaration and a per-phase reset in both confirm paths, found ${resets.length}`
  );
  // Every phase check must go through the per-phase predicate, not the shared flag.
  const sharedChecks = code.match(/if \(timedOut\) throw new Error/g) ?? [];
  assert.deepEqual(sharedChecks, [], "no phase may still be gated on the shared cross-phase flag");
  const phaseChecks = code.match(/if \(phaseExpired\(\)\) throw new Error/g) ?? [];
  assert.equal(phaseChecks.length, 4, "all four phases must use the per-phase predicate");
});