import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { routeShortcut, DEFAULT_SHORTCUTS } from "../../src/ui/reader/readerShortcuts";
import { OpenAICompatibleTranslationProvider } from "../../src/adapters/translation/OpenAICompatibleTranslationProvider";
import { AnthropicCompatibleTranslationProvider } from "../../src/adapters/translation/AnthropicCompatibleTranslationProvider";

/**
 * Locks the group-B quick fixes:
 *   1. Shift+F actually reaches the immersive toggle
 *   2. PDF translation drops stale results
 *   3. translate() refuses to send the API key over plaintext http
 */

const ROOT = new URL("../../../", import.meta.url).pathname;
const read = (rel: string): string => readFileSync(`${ROOT}${rel}`, "utf8");

const ev = (
  key: string,
  mods: Partial<{ shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}
) => ({ key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...mods });

// ---------------------------------------------------------------------------
// 1. Immersive shortcut.
// ---------------------------------------------------------------------------

test("Shift+F toggles immersive and bare f does not", () => {
  // The documented binding, and the reason the gate exists at all: a plain
  // `f` must stay free for foliate's own find-in-book.
  assert.equal(routeShortcut(ev("F", { shiftKey: true }), DEFAULT_SHORTCUTS), "toggleImmersive");
  assert.equal(routeShortcut(ev("f"), DEFAULT_SHORTCUTS), null);
});

test("the immersive check precedes the catch-all shift gate", () => {
  const source = read("src/ui/reader/readerShortcuts.ts");
  const checkIdx = source.indexOf('if (event.key === "F")');
  const shiftGateIdx = source.indexOf("if (event.shiftKey) {\n    if (event.key === \" \") return \"prev\";");
  assert.ok(checkIdx > 0, "there must be an F check");
  assert.ok(shiftGateIdx > 0, "there must be a catch-all shift gate");
  assert.ok(
    checkIdx < shiftGateIdx,
    "the F check has to run before the gate that returns null for every shifted key"
  );
  // The dead `case "F"` form must not reappear in the second switch.
  assert.doesNotMatch(source, /case "F":\n\s*return "toggleImmersive";/);
});

test("Shift+F does not disturb the other shifted bindings", () => {
  assert.equal(routeShortcut(ev(" ", { shiftKey: true }), DEFAULT_SHORTCUTS), "prev");
  assert.equal(routeShortcut(ev("t", { shiftKey: true }), DEFAULT_SHORTCUTS), "translate");
  assert.equal(routeShortcut(ev("h", { shiftKey: true }), DEFAULT_SHORTCUTS), "excerpt");
  // An unknown shifted key still falls through to null.
  assert.equal(routeShortcut(ev("q", { shiftKey: true }), DEFAULT_SHORTCUTS), null);
});

// ---------------------------------------------------------------------------
// 2. PDF translation stale-result guard.
// ---------------------------------------------------------------------------

test("both PDF translation entry points route through the guarded helper", () => {
  const source = read("src/ui/reader/pdfOverlay.ts");
  // The two call sites must delegate instead of awaiting render themselves.
  const delegating = source.match(/return this\.runTranslation\(/g) ?? [];
  assert.equal(delegating.length, 2, "handleTranslate and handleCycleTranslationTarget both delegate");

  // Stronger than pattern-matching for an unguarded await: the render calls
  // must exist in exactly one place — inside runTranslation, after its guard.
  // If a second call site grows, this fails even if the shape looks different.
  const renders = source.match(/this\.renderTranslationResult\(/g) ?? [];
  const errors = source.match(/this\.renderTranslationError\(/g) ?? [];
  assert.equal(renders.length, 1, "only runTranslation may render a translation result");
  assert.equal(errors.length, 1, "only runTranslation may render a translation error");

  // And both of those live after the generation check inside runTranslation.
  const helper = source.slice(
    source.indexOf("private async runTranslation("),
    source.indexOf("private renderTranslationResult(")
  );
  const guardAt = helper.indexOf("if (generation !== this.translateGeneration) return;");
  assert.ok(guardAt > 0, "runTranslation must check the generation");
  assert.ok(helper.indexOf("this.renderTranslationResult(") > guardAt, "result render must be behind the guard");
  assert.ok(helper.indexOf("this.renderTranslationError(") > guardAt, "error render must be behind the guard");
});

test("the PDF guard drops stale results and stale errors", () => {
  const source = read("src/ui/reader/pdfOverlay.ts");
  assert.match(source, /const generation = \+\+this\.translateGeneration;/);
  // Both the success and the failure branch must be guarded, or a stale
  // rejection overwrites a fresh successful result with an error box.
  assert.match(source, /if \(generation !== this\.translateGeneration\) return; \/\/ stale result/);
  assert.match(source, /if \(generation !== this\.translateGeneration\) return; \/\/ stale error/);
  // unmount invalidates anything still in flight.
  assert.match(source, /unmount\(\): void \{[\s\S]{0,200}this\.translateGeneration \+= 1;/);
});

// ---------------------------------------------------------------------------
// 3. API key must never leave over plaintext http.
// ---------------------------------------------------------------------------

const configWith = (baseUrl: string): string => JSON.stringify({ baseUrl, apiKey: "sk-secret", model: "m" });

test("OpenAI-compatible provider refuses a plaintext baseUrl", async () => {
  const provider = new OpenAICompatibleTranslationProvider();
  // Without the guard this builds an http endpoint and ships
  // `Authorization: Bearer sk-secret` to whatever host is configured.
  await assert.rejects(
    () => provider.translate(configWith("http://evil.example/v1"), { text: "hi", source: "auto", target: "zh-CN" }),
    /https/
  );
});

test("Anthropic-compatible provider refuses a plaintext baseUrl", async () => {
  const provider = new AnthropicCompatibleTranslationProvider();
  await assert.rejects(
    () => provider.translate(configWith("http://127.0.0.1:8080"), { text: "hi", source: "auto", target: "zh-CN" }),
    /https/
  );
});

test("a non-URL baseUrl is rejected rather than passed through", async () => {
  const provider = new OpenAICompatibleTranslationProvider();
  await assert.rejects(
    () => provider.translate(configWith("not-a-url"), { text: "hi", source: "auto", target: "zh-CN" }),
    /https/
  );
});

test("the rejection happens before any request is issued", async () => {
  const source = read("src/adapters/translation/OpenAICompatibleTranslationProvider.ts");
  const translateIdx = source.indexOf("async translate(rawConfig: string");
  const guardIdx = source.indexOf("isValidHttpUrl(config.baseUrl)", translateIdx);
  const endpointIdx = source.indexOf("const endpoint = `${baseUrl}/chat/completions`", translateIdx);
  assert.ok(guardIdx > translateIdx, "translate() must validate the baseUrl");
  assert.ok(guardIdx < endpointIdx, "validation must run before the endpoint is built");

  const anthropic = read("src/adapters/translation/AnthropicCompatibleTranslationProvider.ts");
  const aIdx = anthropic.indexOf("async translate(rawConfig: string");
  assert.ok(
    anthropic.indexOf("isValidHttpUrl(config.baseUrl)", aIdx) < anthropic.indexOf("const endpoint = `${baseUrl}/v1/messages`", aIdx),
    "the Anthropic-compatible provider needs the same gate"
  );
});