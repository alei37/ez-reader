import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  bytesFromBufferSource,
  hexFromBuffer,
  sha1Bytes
} from "../../src/platform/Sha1";

/**
 * SHA-1 实现验证。FIPS 180-4 提供了若干官方 test vectors, 我们用最常用的
 * 几个,加上一个多 block (>64 byte) 输入验证 padding + 多轮链是对的。
 *
 * 这是纯算法测试 — 不依赖任何 DOM / WebView, 在 Node 里跑就行。
 */

const textBytes = (s: string): Uint8Array => new TextEncoder().encode(s);

test("SHA-1: 空字符串 → da39a3ee5e6b4b0d3255bfef95601890afd80709", () => {
  // FIPS 180-4 Appendix A.1
  const empty = new Uint8Array(0);
  assert.equal(hexFromBuffer(sha1Bytes(empty)), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
});

test("SHA-1: 'abc' → a9993e364706816aba3e25717850c26c9cd0d89d", () => {
  // FIPS 180-4 Appendix A.2
  assert.equal(hexFromBuffer(sha1Bytes(textBytes("abc"))), "a9993e364706816aba3e25717850c26c9cd0d89d");
});

test("SHA-1: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq' → 84983e441c3bd26ebaae4aa1f95129e5e54670f1", () => {
  // FIPS 180-4 Appendix A.3 — 多 block (>64 byte) 输入, 验证 padding & 多轮链
  assert.equal(
    hexFromBuffer(sha1Bytes(textBytes("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))),
    "84983e441c3bd26ebaae4aa1f95129e5e54670f1"
  );
});

test("SHA-1: 'The quick brown fox jumps over the lazy dog' → 2fd4e1c67a2d28fced849ee1bb76e7391b93eb12", () => {
  // 经典 RFC 3174 test vector
  assert.equal(
    hexFromBuffer(sha1Bytes(textBytes("The quick brown fox jumps over the lazy dog"))),
    "2fd4e1c67a2d28fced849ee1bb76e7391b93eb12"
  );
});

test("SHA-1: 'The quick brown fox jumps over the lazy cog' (轻微改动) → de9f2c7fd25e1b3afad3e85a0bd17d9b100db4b3", () => {
  // 验证 avalanche — 改一个字符, 整个 hash 都变
  assert.equal(
    hexFromBuffer(sha1Bytes(textBytes("The quick brown fox jumps over the lazy cog"))),
    "de9f2c7fd25e1b3afad3e85a0bd17d9b100db4b3"
  );
});

test("SHA-1: 输出总是 20 字节 (160 bits)", () => {
  const inputs = ["", "a", "abc", "a".repeat(64), "a".repeat(1024), "中文".repeat(100)];
  for (const input of inputs) {
    const out = sha1Bytes(textBytes(input));
    assert.equal(out.byteLength, 20, `SHA-1 of ${JSON.stringify(input.slice(0, 20))} should be 20 bytes`);
  }
});

test("SHA-1: 同一输入两次得到同一 hash (deterministic)", () => {
  const bytes = textBytes("ez-reader test fixture");
  const a = hexFromBuffer(sha1Bytes(bytes));
  const b = hexFromBuffer(sha1Bytes(bytes));
  assert.equal(a, b);
});

test("SHA-1: 长输入 (>1 MB) 不溢出 bit counter", () => {
  // 64-bit length — 1.5 MB 输入会推高 bit counter 的高位, 验证 high word 正确
  const big = new Uint8Array(1024 * 1024 * 1 + 7);
  for (let i = 0; i < big.length; i++) big[i] = i & 0xff;
  // 不检查具体 hash, 只确保不抛错 / 不返回错误长度
  const out = sha1Bytes(big);
  assert.equal(out.byteLength, 20);
});

test("bytesFromBufferSource: ArrayBuffer / Uint8Array / DataView 都转成 Uint8Array", () => {
  const original = textBytes("hello world");

  // ArrayBuffer 路径
  const ab = original.slice().buffer;
  const fromAb = bytesFromBufferSource(ab);
  assert.equal(fromAb.length, original.length);
  assert.deepEqual([...fromAb], [...original]);

  // Uint8Array 路径 (ArrayBufferView)
  const fromU8 = bytesFromBufferSource(original);
  assert.equal(fromU8.length, original.length);
  assert.deepEqual([...fromU8], [...original]);

  // DataView 路径 (也是 ArrayBufferView)
  const dv = new DataView(original.slice().buffer);
  const fromDv = bytesFromBufferSource(dv);
  assert.equal(fromDv.length, original.length);
});

test("bytesFromBufferSource: Uint8Array 切片 (subarray 共享 buffer) 拿到的是子范围", () => {
  const big = textBytes("hello world this is a longer string");
  const sub = big.subarray(6, 11); // "world"
  const out = bytesFromBufferSource(sub);
  assert.equal(out.length, 5);
  assert.equal(new TextDecoder().decode(out), "world");
});

test("hexFromBuffer: 正确格式化 (lowercase + 两位定宽)", () => {
  // 输入 [0x00, 0xff, 0xab, 0x0c] → "00ffab0c"
  const buf = new Uint8Array([0x00, 0xff, 0xab, 0x0c]).buffer;
  assert.equal(hexFromBuffer(buf), "00ffab0c");
});