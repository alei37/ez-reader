import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Wiring assertions for fixes whose classes cannot be instantiated under
 * jsdom — `ReaderView` pulls in foliate and the Obsidian leaf lifecycle,
 * `PdfOverlay` requires a live PDFView DOM, and `Plugin.onload` needs a
 * full App. Each of these bugs was a *call-site* defect: the helper or
 * method was correct, it just wasn't invoked (or was invoked after the
 * gate that was supposed to cover it). Unit-testing the helper alone
 * passed while the defect shipped, so the invariant is pinned on the
 * source instead.
 *
 * Each test below was verified by mutation: reverting the corresponding
 * fix makes it fail.
 */

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../src/${rel}`, import.meta.url)), "utf8");

/** Body of `methodName(...)` inside a file, up to the next member. */
const memberBody = (file: string, signature: string): string => {
  const text = src(file);
  const start = text.indexOf(signature);
  assert.ok(start !== -1, `${signature} must exist in ${file}`);
  const rest = text.slice(start + signature.length);
  const next = /\n  (?!\})[A-Za-z_@#]/.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
};

// ---------------------------------------------------------------------------
// P0-4: exportData must actually redact
// ---------------------------------------------------------------------------

test("export wiring: exportData serializes the redacted snapshot", () => {
  const body = memberBody("ui/settings/SettingsTab.ts", "private async exportData(): Promise<void> {");
  assert.match(
    body,
    /JSON\.stringify\(redactSecrets\(/,
    "exportData must pass through redactSecrets — testing the helper alone missed this"
  );
});

test("export wiring: importData restores the key already in the vault", () => {
  const body = memberBody("ui/settings/SettingsTab.ts", "private async importData(): Promise<void> {");
  assert.match(body, /restoreExportedKeys\(/, "importData must re-apply the stored key");
});

// ---------------------------------------------------------------------------
// P1-3: runV030Migration must write the flag at the top level, and retry
// ---------------------------------------------------------------------------

test("migration wiring: the flag is written via setMigratedToV030, not patchSettings", () => {
  const body = memberBody("Plugin.ts", "private async runV030Migration(): Promise<void> {");
  assert.match(
    body,
    /setMigratedToV030\(/,
    "patchSettings puts the flag under settings.*, which load() never reads — the guard never tripped"
  );
  assert.doesNotMatch(
    body,
    /patchSettings\(\(s\) => \(\{ \.\.\.s, migratedToV030/,
    "writing migratedToV030 through patchSettings is the original bug"
  );
});

test("migration wiring: a failed run does not mark itself done", () => {
  const body = memberBody("Plugin.ts", "private async runV030Migration(): Promise<void> {");
  assert.match(
    body,
    /setMigratedToV030\(clean,/,
    "the success flag must depend on failedNotes, not be unconditional"
  );
  assert.match(
    body,
    /const clean = result\.failedNotes === 0;/,
    "`clean` must actually be derived from failedNotes — hardcoding it true silently strands notes"
  );
});

test("migration wiring: retries are capped", () => {
  const text = src("Plugin.ts");
  assert.match(text, /const MIGRATION_MAX_ATTEMPTS = \d+;/, "a bounded retry cap must exist");
  const body = memberBody("Plugin.ts", "private async runV030Migration(): Promise<void> {");
  assert.match(
    body,
    /attempts >= MIGRATION_MAX_ATTEMPTS/,
    "an unbounded retry re-scans the vault on every startup if the legacy folder is gone"
  );
});

// ---------------------------------------------------------------------------
// P1-2: both time counters must sit behind the same gate
// ---------------------------------------------------------------------------

test("reading-time gate: recordSession sits behind shouldCountReadingTime", () => {
  const body = memberBody("ui/reader/ReaderView.ts", "private flushActiveSession(): void {");
  const gateAt = body.indexOf("shouldCountReadingTime");
  const recordAt = body.indexOf("recordSession");
  assert.ok(gateAt !== -1, "flushActiveSession must gate on shouldCountReadingTime");
  assert.ok(recordAt !== -1, "flushActiveSession must still record the session");
  assert.ok(
    gateAt < recordAt,
    "recordSession bypassed the gate and wrote intervals the cumulative counter never saw"
  );
  assert.ok(
    body.includes("this.lastReadingFlushAt = Date.now()"),
    "the debounce timestamp must advance once per accepted interval"
  );
});

test("reading-time gate: flushReadingTime no longer re-gates on its own", () => {
  const body = memberBody("ui/reader/ReaderView.ts", "private async flushReadingTime(deltaMs: number): Promise<void> {");
  assert.doesNotMatch(
    body,
    /lastReadingFlushAt/,
    "the debounce gate moved to the caller so it can cover recordSession as well; " +
      "any remaining reference here would silently re-introduce a second, narrower gate"
  );
});

test("reading-time gate: the PDF overlay applies the same gate", () => {
  const body = memberBody("ui/reader/pdfOverlay.ts", "private flushPdfActiveSession(): void {");
  const gateAt = body.indexOf("shouldCountReadingTime");
  const recordAt = body.indexOf("recordSession");
  assert.ok(gateAt !== -1, "PdfOverlay must gate too, or PDF totals diverge the same way");
  assert.ok(gateAt < recordAt, "gate must precede recordSession");
});

// ---------------------------------------------------------------------------
// P1-4: switching books resets per-book state
// ---------------------------------------------------------------------------

test("book switch wiring: setEntry clears tocFractions before openSession", () => {
  const body = memberBody("ui/reader/ReaderView.ts", "setEntry(entry: LibraryEntry): void {");
  const clearAt = body.indexOf("this.tocFractions.clear()");
  const openAt = body.indexOf("void this.openSession()");
  assert.ok(clearAt !== -1, "tocFractions must be cleared on book switch");
  assert.ok(clearAt < openAt, "clear must precede the new session merging its persisted ids");
});

// ---------------------------------------------------------------------------
// P1-5: background PDF tabs must unmount
// ---------------------------------------------------------------------------

test("pdf overlay wiring: layout-change triggers the leaf-death check", () => {
  const text = src("ui/reader/pdfOverlay.ts");
  assert.match(
    text,
    /workspace\.on\("layout-change"/,
    "active-leaf-change does not fire when a background tab closes — layout-change does"
  );
  const start = text.indexOf('const onLayoutChange = () => {');
  assert.ok(start !== -1, "an onLayoutChange handler must exist");
  const handler = text.slice(start, start + 400);
  assert.match(handler, /isLeafAlive\(\)/, "the handler must re-check liveness");
  assert.match(handler, /this\.unmount\(\)/, "and unmount when the leaf is gone");
});

test("pdf overlay wiring: the rAF loop no longer repositions unconditionally", () => {
  const text = src("ui/reader/pdfOverlay.ts");
  const tickAt = text.indexOf("const tick = (): void => {");
  assert.ok(tickAt !== -1, "the rAF tick must exist");
  const tick = text.slice(tickAt, tickAt + 1400);
  assert.doesNotMatch(
    tick,
    /const tick = \(\): void => \{\s*rafHandle[\s\S]*?this\.repositionHighlights\(\);\s*\}\s*;/,
    "an unconditional reposition rebuilds every highlight 60×/second"
  );
  assert.match(tick, /dirty \|\| top !== lastScrollTop/, "the loop must be gated on actual movement");
});