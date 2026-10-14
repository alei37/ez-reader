import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Locks the two EPUB-layer fixes:
 *
 *  - the section sanitizer actually runs for real EPUB MIME types
 *  - `bindSelectionChange` attaches to the section that was already loaded
 *    when `view.open()` returned (the "just opened a book, selection does
 *    nothing until you turn a page" bug)
 */

// The bundle lives in tests/dist/core/, so reaching the repo root is 3 levels up.
const FOLIATE_SRC = new URL("../../../src/adapters/foliate/FoliateBookReader.ts", import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Finding 1: the MIME gate never matched real EPUB content.
// ---------------------------------------------------------------------------

test("sanitize hook accepts application/xhtml+xml (the MIME foliate actually passes)", () => {
  const source = readFileSync(FOLIATE_SRC, "utf8");
  // The gate that decides whether the sanitizer runs at all.
  assert.match(
    source,
    /\^\(\?:application\|text\)\\\/\(\?:xhtml\\\+xml\|html\)\$\/i\.test/,
    "the MIME gate must include application/xhtml+xml — that is what EPUB 2/3 spines use"
  );
  // Guard against the old gate creeping back in.
  assert.doesNotMatch(
    source,
    /if \(!\/text\\\/\(x\?html\)\/i\.test/,
    "the old /text\\/(x?html)/i gate must be gone"
  );
});

test("sanitizeBookContent strips the executable parts of a section", async () => {
  const { sanitizeBookContent } = await import("../../src/adapters/foliate/FoliateBookReader");
  const dirty = [
    '<p>hello</p>',
    '<script>alert(1)</script>',
    '<img src=x onerror="alert(2)">',
    '<a href="javascript:alert(3)">click</a>',
    '<iframe src="https://evil.example/"></iframe>',
    '<meta http-equiv="refresh" content="0;url=https://evil.example/">'
  ].join("");
  const clean = sanitizeBookContent(dirty);

  assert.doesNotMatch(clean, /<script/i);
  assert.doesNotMatch(clean, /onerror/i);
  assert.doesNotMatch(clean, /javascript:/i);
  assert.doesNotMatch(clean, /<iframe/i);
  assert.doesNotMatch(clean, /http-equiv/i);
  // Real content must survive.
  assert.match(clean, /<p>hello<\/p>/);
  assert.match(clean, />click</);
});

// ---------------------------------------------------------------------------
// Finding 2: the first `load` fires during open(), before anyone listens.
// ---------------------------------------------------------------------------

test("FoliateSession is given a getter for the already-loaded section", () => {
  const source = readFileSync(FOLIATE_SRC, "utf8");
  // open() must install a capture hook BEFORE awaiting view.open(...).
  const openIdx = source.indexOf("await view.open(parsed)");
  const captureIdx = source.indexOf("view.addEventListener(\"load\", captureLoad)");
  assert.ok(captureIdx > 0, "open() must register a captureLoad hook");
  assert.ok(captureIdx < openIdx, "captureLoad has to be registered before view.open()");
});

test("bindSelectionChange immediately attaches to the already-loaded section", () => {
  const source = readFileSync(FOLIATE_SRC, "utf8");
  assert.match(
    source,
    /const alreadyLoaded = this\.getLastLoaded\?\.\(\);/,
    "bindSelectionChange must read the captured load instead of waiting for the next one"
  );
  assert.match(source, /attach\(alreadyLoaded\.doc, alreadyLoaded\.index\)/);
});

// ---------------------------------------------------------------------------
// Finding 3: open() failure paths leaked the unpacked book's blob URLs.
// ---------------------------------------------------------------------------

test("both open() failure paths release the parsed book's blob URLs", () => {
  const source = readFileSync(FOLIATE_SRC, "utf8");
  // No session exists yet when view.open() throws → destroyParsedBook directly.
  assert.match(
    source,
    /destroyParsedBook\(parsed, "open-failed"\)/,
    "view.open() must release the unpacked book on its failure path"
  );
  // The applyAppearance path has a session, whose close() calls book.destroy().
  const applyCatch = source.slice(
    source.indexOf("await session.applyAppearance(appearance);"),
    source.indexOf("// 翻页动画")
  );
  assert.match(
    applyCatch,
    /await session\.close\(\);/,
    "applyAppearance failure must run session.close(), which is what calls book.destroy()"
  );
});

test("session.close() actually releases the foliate book", () => {
  const source = readFileSync(FOLIATE_SRC, "utf8");
  const closeBody = source.slice(source.indexOf("async close(): Promise<void> {"));
  assert.match(closeBody, /book\.destroy\(\)/, "close() must destroy the parsed book");
});