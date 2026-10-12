import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Switching books must not carry the previous book's chapter-visit state
 * into the new one.
 *
 * `ReaderView.tocFractions` was never reset on book switch, while
 * `openSession` merges the new book's persisted ids into the same Map and
 * `flushVisited` writes `Array.from(tocFractions.keys())` into
 * `visitedTocIdsByBookId[<new book>]`. Reading book A for six chapters and
 * then opening book B in the same reader leaf recorded A's chapter ids as
 * B's — B grew green "visited" dots for chapters never opened, and A's
 * markers appeared on B's toolbar progress bar. Once written to data.json
 * it could not be undone without hand-editing.
 *
 * `ReaderView` cannot be instantiated under jsdom (it pulls in foliate and
 * the Obsidian view lifecycle), so this pins the reset invariant on the
 * source, the same way the wiring assertions in VaultRoundTrip do.
 */

const readerViewSource = () =>
  readFileSync(fileURLToPath(new URL("../../../src/ui/reader/ReaderView.ts", import.meta.url)), "utf8");

/** Body of `setEntry`, i.e. from its signature to the next class member. */
const setEntryBody = (): string => {
  const src = readerViewSource();
  const start = src.indexOf("setEntry(entry: LibraryEntry): void {");
  assert.ok(start !== -1, "setEntry must exist");
  // Next member of the class: a line starting with exactly two spaces
  // followed by a non-space (method / field / brace), skipping the closing
  // brace of setEntry itself.
  const rest = src.slice(start + "setEntry(entry: LibraryEntry): void {".length);
  const nextMember = /\n  (?!\})[A-Za-z_@#]/.exec(rest);
  return nextMember ? rest.slice(0, nextMember.index) : rest;
};

test("book switch: setEntry clears tocFractions", () => {
  const body = setEntryBody();
  assert.match(
    body,
    /this\.tocFractions\.clear\(\)/,
    "setEntry must clear tocFractions or the next book inherits the previous one's chapters"
  );
});

test("book switch: the visited-persist snapshot is reset too", () => {
  const src = readerViewSource();
  const start = src.indexOf("setEntry(entry: LibraryEntry): void {");
  const body = src.slice(start, src.indexOf("\n  private ", start + 10) === -1
    ? src.indexOf("\n  async ", start + 10)
    : src.indexOf("\n  private ", start + 10));
  assert.match(
    body,
    /this\.persistVisitedLastSnapshot\s*=\s*\[\]/,
    "flushVisited skips the write when the snapshot looks unchanged — it must be reset too"
  );
  assert.match(body, /this\.tocItems\s*=\s*\[\]/, "stale TOC rows must not render for the new book");
});

test("book switch: the panel's visited set is cleared", () => {
  const src = readerViewSource();
  const start = src.indexOf("setEntry(entry: LibraryEntry): void {");
  const body = src.slice(start, src.indexOf("\n  private ", start + 10) === -1
    ? src.indexOf("\n  async ", start + 10)
    : src.indexOf("\n  private ", start + 10));
  assert.match(body, /this\.tocPanel\?\.setVisited\(\[\]\)/, "green dots must not survive the switch");
});

test("book switch: the reset happens before openSession merges the new ids", () => {
  const body = setEntryBody();
  const clearAt = body.indexOf("this.tocFractions.clear()");
  const openAt = body.indexOf("void this.openSession()");
  assert.ok(clearAt !== -1 && openAt !== -1);
  assert.ok(clearAt < openAt, "clear must run before the new session merges its persisted ids");
});