/**
 * Regression tests for the 0.3.2 auto-review warning batch.
 *
 * The auto-review flagged 166 warnings. Most are mechanical
 * (`prefer-create-el` ×88, CSS `!important` ×15, `globalThis` ×8) and
 * deliberately left alone — see AGENTS.md §3.7. This file covers only the
 * subset that was an actual defect:
 *
 *   1. `Plugin.ts` — `workspace.revealLeaf` returns `Promise<void>`
 *      (obsidian.d.ts:8029) and three call sites dropped it. Marking it
 *      `void` only silences the linter and still leaks an unhandled
 *      rejection; the fix is to await it.
 *   2. `ReaderView.ts` — `let escapeHandled` sat directly in a `case`
 *      body, so its scope was the entire switch. Wrapped in braces.
 *   3. `BaseTranslationProvider.ts` — `withDeadline` re-threw the raw
 *      rejection reason, which is not guaranteed to be an `Error`.
 *   4. `ObsidianLibraryWriter.ts` — migration used `vault.delete`,
 *      permanently unlinking notes and bypassing the user's trash
 *      preference. (Behavioural coverage lives in `VaultRoundTrip`.)
 *   5/6. `pdfOverlay.ts` / `BookInfoModal.ts` — two variables that were
 *      assigned and never read, left over from unfinished edits.
 *
 * Each test was verified by mutation: reverting the corresponding fix
 * makes it fail.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { withDeadline } from "../../src/adapters/translation/BaseTranslationProvider";

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../src/${rel}`, import.meta.url)), "utf8");

/**
 * A promise that rejects with `reason` *synchronously attached*, so no
 * unhandled-rejection window opens between construction and the handler.
 */
const rejectsWith = <T>(reason: unknown): Promise<T> =>
  new Promise<T>((_resolve, reject) => {
    reject(reason);
  });

// ---------------------------------------------------------------------------
// withDeadline: the rejection reason must always be an Error
// ---------------------------------------------------------------------------

test("withDeadline: 字符串 reason → Error", async () => {
  await assert.rejects(
    withDeadline(rejectsWith("网络错误"), 5_000, "Test"),
    (err: unknown) => err instanceof Error && err.message === "网络错误"
  );
});

test("withDeadline: 对象 reason → JSON 化的 Error", async () => {
  await assert.rejects(
    withDeadline(rejectsWith({ code: 429 }), 5_000, "Test"),
    (err: unknown) => err instanceof Error && err.message === '{"code":429}'
  );
});

test("withDeadline: 循环引用的 reason 不会让自身再抛", async () => {
  const circular: Record<string, unknown> = { name: "loop" };
  circular["self"] = circular;
  await assert.rejects(
    withDeadline(rejectsWith(circular), 5_000, "Test"),
    (err: unknown) => err instanceof Error
  );
});

test("withDeadline: undefined reason → 非空消息的 Error", async () => {
  await assert.rejects(
    withDeadline(rejectsWith(undefined), 5_000, "Test"),
    (err: unknown) => err instanceof Error && err.message.length > 0
  );
});

test("withDeadline: 本来就是 Error 时原样透传(不丢类型)", async () => {
  const original = new RangeError("bad range");
  await assert.rejects(
    withDeadline(rejectsWith(original), 5_000, "Test"),
    (err: unknown) => err === original
  );
});

test("withDeadline: 成功路径不受归一化影响", async () => {
  assert.equal(await withDeadline(Promise.resolve(42), 5_000, "Test"), 42);
});

test("withDeadline: 超时 reason 本身是 Error", async () => {
  await assert.rejects(
    withDeadline(new Promise<never>(() => {}), 10, "Test"),
    (err: unknown) => err instanceof Error && /翻译请求超时/.test(err.message)
  );
});

// ---------------------------------------------------------------------------
// Plugin.ts: revealLeaf must be awaited, not merely voided
// ---------------------------------------------------------------------------

test("Plugin: revealLeaf 的每一处调用都被 await", () => {
  const text = src("Plugin.ts");
  const calls = text.match(/^.*this\.app\.workspace\.revealLeaf\(.*$/gm) ?? [];
  // 数量不是重点 —— 重点是**每一处**都被 await。重点不能退化成"只检查一处",
  // 所以这里保留下限断言: 低于它说明正则没匹配上(文件结构变了), 测试仍然有效。
  //
  // 4 = openShelf 的 existing / openShelf 新建 / openInBuiltInViewer /
  //     openReader 复用已打开的那本书的 leaf (v0.3.3 加的)。
  assert.ok(calls.length >= 4, `expected at least 4 revealLeaf call sites, found ${calls.length}`);
  for (const call of calls) {
    assert.match(
      call,
      /await this\.app\.workspace\.revealLeaf\(/,
      `revealLeaf must be awaited: ${call.trim()}`
    );
  }
});

test("Plugin: 不用 void 压制 revealLeaf —— void 不阻止 unhandled rejection", () => {
  assert.doesNotMatch(
    src("Plugin.ts"),
    /void\s+this\.app\.workspace\.revealLeaf\(/,
    "`void p` satisfies no-floating-promises but leaves the rejection unhandled"
  );
});

// ---------------------------------------------------------------------------
// ReaderView.ts: case bodies must not declare lexical bindings
// ---------------------------------------------------------------------------

test("ReaderView: case \"escape\" 的作用域被花括号隔离", () => {
  assert.match(src("ui/reader/ReaderView.ts"), /case "escape": \{/);
});

test("ReaderView: 没有任何 case body 裸声明 let/const", () => {
  assert.doesNotMatch(
    src("ui/reader/ReaderView.ts"),
    /case "[a-z]+":\n\s*(let|const)\s/,
    "a lexical declaration in a case body is scoped to the whole switch — a later case can shadow it"
  );
});

// ---------------------------------------------------------------------------
// Dead bindings left over from unfinished edits
// ---------------------------------------------------------------------------

test("pdfOverlay: search bar 不再保留从未被读取的 lastQuery", () => {
  assert.doesNotMatch(
    src("ui/reader/pdfOverlay.ts"),
    /\blastQuery\b/,
    "commit() receives fromStart per call, so the closure variable was write-only"
  );
});

test("BookInfoModal: placeholder 节点不再绑定到未使用的变量", () => {
  assert.doesNotMatch(
    src("ui/shelf/BookInfoModal.ts"),
    /const\s+placeholder\s*=/,
    "the node is created for its side effect; the binding was never read"
  );
});