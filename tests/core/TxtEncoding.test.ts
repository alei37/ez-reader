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

test("encoding: malformed bytes fall back to permissive UTF-8 (no throw)", () => {
  // 0xC0 0x80 is overlong UTF-8 (invalid). Both strict-UTF-8 and
  // GB18030 may produce different replacement chars — the contract is
  // "don't refuse to open, return a string of plausible length".
  const malformed = new Uint8Array([0xC0, 0x80, 0xFF, 0xFE]);
  const result = decodeText(malformed.buffer);
  assert.equal(typeof result, "string");
  assert.ok(result.length > 0);
});

test("encoding: empty input decodes to empty string", () => {
  assert.equal(decodeText(new ArrayBuffer(0)), "");
});
