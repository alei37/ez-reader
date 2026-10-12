import { test } from "node:test";
import { strict as assert } from "node:assert";

import { decodeText } from "../../src/adapters/text/TxtBookReader";

/**
 * P0-4: Encoding-fallback tests for TxtBookReader.decodeText.
 *
 * The user's many GBK-encoded Chinese text files used to render as
 * `□□□` because the strict UTF-8 decoder threw and we had no fallback.
 * Now we try GB18030 before giving up.
 */

test("encoding: ASCII text decodes as UTF-8", () => {
  const bytes = new TextEncoder().encode("Hello, world!").buffer;
  assert.equal(decodeText(bytes), "Hello, world!");
});

test("encoding: UTF-8 Chinese text decodes correctly", () => {
  const bytes = new TextEncoder().encode("你好,世界!这是一个测试。").buffer;
  assert.equal(decodeText(bytes), "你好,世界!这是一个测试。");
});

test("encoding: UTF-8 BOM is stripped", () => {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  const text = new TextEncoder().encode("中文测试");
  const combined = new Uint8Array(bom.length + text.length);
  combined.set(bom, 0);
  combined.set(text, bom.length);
  assert.equal(decodeText(combined.buffer), "中文测试");
});

test("encoding: GB18030 (legacy Chinese) decodes via fallback", () => {
  // "你好，世界!" encoded as GB18030:
  //   你 = 0xC4 0xE3, 好 = 0xBA 0xC3, ， = 0xA3 0xAC (fullwidth comma),
  //   世 = 0xCA 0xC0, 界 = 0xBD 0xE7, ! = 0x21
  // Strict UTF-8 throws → GB18030 fallback decodes successfully.
  // Note: 0xA3 0xAC in GB18030 is the *fullwidth* comma (，), not the
  // ASCII comma — it's the way Chinese text in GBK usually appears.
  const gb = new Uint8Array([0xC4, 0xE3, 0xBA, 0xC3, 0xA3, 0xAC, 0xCA, 0xC0, 0xBD, 0xE7, 0x21]);
  assert.equal(decodeText(gb.buffer), "你好，世界!");
});

test("encoding: GBK-only characters also decode (subset of GB18030)", () => {
  // "简体" in GBK: 简 = 0xBC 0xF2, 体 = 0xCC 0xE5
  const gbk = new Uint8Array([0xBC, 0xF2, 0xCC, 0xE5]);
  assert.equal(decodeText(gbk.buffer), "简体");
});

test("encoding: malformed bytes fall back without throwing", () => {
  // 0xC0 0x80 is overlong UTF-8 (invalid). The contract is "don't refuse to
  // open, return a string of plausible length".
  //
  // P1 fix: this test used to feed `[0xC0, 0x80, 0xFF, 0xFE]` and only
  // assert `typeof === "string" && length > 0`. That `FF FE` IS the UTF-16BE
  // BOM, so this input was really a UTF-16 test — but the assertion passed
  // on pure mojibake, which is exactly why the missing UTF-16 branch went
  // unnoticed for so long. Length alone proves nothing; the dedicated
  // UTF-16 cases below assert real decoded text.
  const malformed = new Uint8Array([0xC0, 0x80, 0x11, 0x22]);
  const result = decodeText(malformed.buffer);
  assert.equal(typeof result, "string");
  assert.ok(result.length > 0);
});

test("encoding: UTF-16LE (Windows 'Unicode encoding') decodes to real text", () => {
  // P1 fix: there was no UTF-16 branch at all. The strict-UTF-8 attempt
  // fails on the interleaved NULs, then GB18030 "succeeds" on binary and
  // returns it as text — so a book saved as UTF-16 opened as a wall of
  // replacement characters.
  const text = "第一章\n\n天地玄黄，宇宙洪荒。\n";
  const bytes: number[] = [0xff, 0xfe];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    bytes.push(code & 0xff, (code >> 8) & 0xff);
  }
  const result = decodeText(new Uint8Array(bytes).buffer);
  assert.ok(result.includes("天地玄黄"), `expected real Chinese text, got ${JSON.stringify(result)}`);
  assert.ok(result.includes("第一章"));
  assert.ok(!result.includes("\u0000"), "no NUL bytes may survive");
  assert.ok(!result.includes("�"), "no replacement characters");
});

test("encoding: UTF-16BE decodes to real text", () => {
  const text = "第一章 天地玄黄";
  const bytes: number[] = [0xfe, 0xff];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    bytes.push((code >> 8) & 0xff, code & 0xff);
  }
  const result = decodeText(new Uint8Array(bytes).buffer);
  assert.equal(result, text);
});

test("encoding: a UTF-8 BOM does not swallow a GB18030 body", () => {
  // P1 fix: the BOM branch decoded permissively, so a GB18030 file that
  // happened to start with the UTF-8 BOM bytes came out as U+FFFD instead
  // of falling through to the GB18030 attempt.
  const gbkBody = [0xd6, 0xd0, 0xce, 0xc4]; // "中文"
  const result = decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...gbkBody]).buffer);
  assert.ok(result.includes("中文"), `expected 中文, got ${JSON.stringify(result)}`);
});

test("encoding: empty input decodes to empty string", () => {
  assert.equal(decodeText(new ArrayBuffer(0)), "");
});
