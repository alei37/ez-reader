import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { OpenAICompatibleTranslationProvider } from "../../src/adapters/translation/OpenAICompatibleTranslationProvider";
import { AnthropicCompatibleTranslationProvider } from "../../src/adapters/translation/AnthropicCompatibleTranslationProvider";
import { YoudaoTranslationProvider } from "../../src/adapters/translation/YoudaoTranslationProvider";

/**
 * Batch 3: security (cleartext keys, remote beacons), resource cleanup
 * (foliate blob URLs, concurrent opens), and text decoding.
 *
 * The LLM-provider and timeout cases are real behavioural tests. The
 * foliate / ReaderView / TranslationDrawer cases are source assertions —
 * those classes need a live foliate module, an Obsidian leaf, or a real DOM
 * and cannot be instantiated under jsdom. Each assertion below was
 * mutation-verified: reverting the fix makes it fail.
 */

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../src/${rel}`, import.meta.url)), "utf8");

// ---------------------------------------------------------------------------
// P1 security: cleartext API key
// ---------------------------------------------------------------------------

const openaiConfig = (baseUrl: string) =>
  JSON.stringify({ baseUrl, apiKey: "sk-secret-key", model: "gpt-4o-mini" });

test("security: OpenAI-compatible rejects an http:// base URL", async () => {
  const p = new OpenAICompatibleTranslationProvider();
  const r = await p.validateKey(openaiConfig("http://192.168.1.10:8000/v1"));
  assert.equal(r.ok, false, "a cleartext endpoint would send the API key in the clear");
  if (!r.ok) assert.match(r.reason, /https/);
});

test("security: Anthropic-compatible rejects an http:// base URL", async () => {
  const p = new AnthropicCompatibleTranslationProvider();
  const r = await p.validateKey(openaiConfig("http://lan-llm.local/v1"));
  assert.equal(r.ok, false);
});

test("security: https:// is still accepted", async () => {
  const p = new OpenAICompatibleTranslationProvider();
  const r = await p.validateKey(openaiConfig("https://api.example.com/v1"));
  assert.equal(r.ok, true);
});

test("security: non-http schemes are rejected", async () => {
  const p = new OpenAICompatibleTranslationProvider();
  for (const url of ["ftp://x/v1", "file:///etc/passwd", "not-a-url"]) {
    assert.equal((await p.validateKey(openaiConfig(url))).ok, false, `${url} must be rejected`);
  }
});

// ---------------------------------------------------------------------------
// P1: translation requests must not hang forever
// ---------------------------------------------------------------------------

test("timeout: a stalled translation request rejects instead of hanging", async () => {
  // `requestUrl` has neither `timeout` nor `signal` (verified against
  // obsidian.d.ts), so the deadline is enforced by racing. Stub a request
  // that never settles, which is what a TCP connect with no response looks
  // like on hotel wifi.
  const prev = globalThis.__obsidianRequestUrl;
  globalThis.__obsidianRequestUrl = () => new Promise(() => {});
  try {
    // Subclass to lower the deadline: the production value is 20s, which is
    // a long time to add to every CI run for a test whose point is that the
    // deadline exists at all.
    class FastFailingYoudao extends YoudaoTranslationProvider {
      protected override requestTimeoutMs = 50;
    }
    const p = new FastFailingYoudao();
    // Youdao rejects a malformed key before it ever reaches the network, so
    // use the format it actually expects — otherwise this test would pass
    // for the wrong reason.
    const key = JSON.stringify({ appKey: "a".repeat(32), appSecret: "b".repeat(32) });
    const started = Date.now();
    // Outer bound on the assertion itself. Without the provider's deadline
    // the stub never settles and this await would hang forever — and a
    // mutation that HANGS the suite is worse than one that fails it, because
    // CI just stalls until the job timeout. Racing a sentinel turns that into
    // a clean failure.
    const sentinel = Symbol("no-deadline");
    const outcome = await Promise.race([
      p.translate(key, { text: "hello", source: "auto", target: "zh-CN" }).then(
        (r) => ({ kind: "resolved" as const, value: r }),
        (e: unknown) => ({ kind: "rejected" as const, error: e })
      ),
      new Promise<typeof sentinel>((resolve) => setTimeout(() => resolve(sentinel), 3_000))
    ]);
    assert.notEqual(
      outcome,
      sentinel,
      "translation hung — BaseTranslationProvider no longer bounds the request"
    );
    assert.equal((outcome as { kind: string }).kind, "rejected", "must reject, not resolve");
    const message = (outcome as { error: unknown }).error instanceof Error
      ? ((outcome as { error: Error }).error).message
      : String((outcome as { error: unknown }).error);
    assert.match(message, /超时/, `expected a timeout error, got: ${message}`);
    assert.ok(Date.now() - started < 3_000, "the deadline must actually bound the wait");
  } finally {
    if (prev === undefined) delete globalThis.__obsidianRequestUrl;
    else globalThis.__obsidianRequestUrl = prev;
  }
});

test("timeout: BaseTranslationProvider wraps requestUrl in a deadline", () => {
  const text = src("adapters/translation/BaseTranslationProvider.ts");
  assert.match(text, /withDeadline\(\s*requestUrl\(/, "the request must be raced against a deadline");
  assert.match(text, /const TRANSLATION_TIMEOUT_MS = [\d_]+;/, "a finite deadline must be configured");
});

// ---------------------------------------------------------------------------
// P1: foliate parsed-book cleanup
// ---------------------------------------------------------------------------

test("foliate: session.close() destroys the parsed book", () => {
  const text = src("adapters/foliate/FoliateBookReader.ts");
  assert.match(
    text,
    /private parsedBook: unknown;/,
    "the session must retain the parsed book — view.close() does not release its blob URLs"
  );
  const closeAt = text.indexOf("async close(): Promise<void> {");
  assert.ok(closeAt !== -1);
  // Scope to the method body only. A wide slice also picks up the helper's
  // own `book.destroy()` further down the file, which would make this pass
  // even with close() neutered — a mutation that slipped through once.
  const closeEnd = text.indexOf("\n  }", closeAt);
  const close = text.slice(closeAt, closeEnd);
  assert.match(close, /book\.destroy\(\) *;/, "close() must actively call the book's destroy");
});

test("foliate: extractCover and readMetadata destroy in a finally", () => {
  const text = src("adapters/foliate/FoliateBookReader.ts");
  // Both run once per book (cover hydration / metadata sweep), so leaking
  // each one is the same defect as leaking every open.
  assert.match(text, /destroyParsedBook\(parsed, "extractCover"\)/);
  assert.match(text, /destroyParsedBook\(parsed, "readMetadata"\)/);
  // …and they must be inside `finally`, not a straight-line call that a
  // throw would skip.
  const finallyBlocks = text.match(/finally \{\s*destroyParsedBook\(/g) ?? [];
  assert.ok(finallyBlocks.length >= 2, `expected 2 finally-guarded cleanups, found ${finallyBlocks.length}`);
});

test("foliate: destroyParsedBook tolerates a missing or throwing destroy", () => {
  const text = src("adapters/foliate/FoliateBookReader.ts");
  assert.match(text, /typeof book\.destroy !== "function"\) return;/, "cleanup must be optional");
  assert.match(text, /foliate book\.destroy failed/, "a throw must not fail the caller's operation");
});

// ---------------------------------------------------------------------------
// P1: openSession re-entrancy
// ---------------------------------------------------------------------------

test("ReaderView: openSession serialises overlapping calls", () => {
  const text = src("ui/reader/ReaderView.ts");
  assert.match(text, /private openingPromise: Promise<void> \| undefined;/);
  const openAt = text.indexOf("private async openSession(): Promise<void> {");
  assert.ok(openAt !== -1);
  const body = text.slice(openAt, openAt + 1200);
  assert.match(body, /if \(this\.openingPromise\)/, "the in-flight promise must be awaited before mounting");
  assert.match(body, /this\.openingPromise = run;/, "and recorded so the next call can chain onto it");
});

test("ReaderView: the real work moved to openSessionInner", () => {
  const text = src("ui/reader/ReaderView.ts");
  assert.match(
    text,
    /private async openSessionInner\(\): Promise<void> \{/,
    "the guard must wrap the original body, not sit beside it"
  );
});

// ---------------------------------------------------------------------------
// P1: drawer must not render a stale result after hide
// ---------------------------------------------------------------------------

test("TranslationDrawer: hide() invalidates the pending generation", () => {
  const text = src("ui/reader/TranslationDrawer.ts");
  const hideAt = text.indexOf("  hide(): void {");
  assert.ok(hideAt !== -1);
  const hide = text.slice(hideAt, hideAt + 900);
  assert.match(
    hide,
    /this\.translateGeneration \+= 1/,
    "without this the in-flight await still matches the current generation and renders into the hidden drawer"
  );
});