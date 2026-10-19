/**
 * Pure-JS SHA-1 implementation, extracted from polyfills.ts so it can be
 * unit-tested without mutating globalThis. Used as a fallback for
 * `crypto.subtle.digest("SHA-1", bytes)` on legacy Android WebViews where
 * the SubtleCrypto API is missing.
 *
 * Reference: FIPS 180-4 (SHA-1 spec). This implementation is NOT
 * constant-time; that's acceptable here because the inputs are EPUB
 * section bytes from the user's own vault — never secrets or attacker
 * data.
 */

/**
 * 手写 UTF-8 编码器 —— 不用 `TextEncoder` 的唯一原因是这个文件本身就是
 * 老 WebView 的兜底。
 *
 * `TextEncoder` 是 Chrome 38+ 的 API, 而需要 polyfill 的那批 Android
 * System WebView 恰好在它之前(甚至连 `crypto.subtle` 都没有)。在那种环境里
 * `new TextEncoder()` 直接 ReferenceError, 兜底代码自己先炸了 —— 那就毫无意义。
 * 所以这里按 Unicode 标准手写一遍: 代理对合并成 4 字节, BMP 里 >0x7FFFF 的
 * 孤立代理用 U+FFFD 替换(TextEncoder 也是这么做的, 不静默产生非法序列)。
 */
export const utf8Bytes = (text: string): Uint8Array => {
  // 绝大多数输入是 ASCII/BMP 且不长; 先按 3 字节/字符估一个上界, 避免
  // 每个字符都 push 造成多次扩容(选词/书名最多几百字符, 这点开销无所谓,
  // 但 SHA-1 要对 EPUB 正文做摘要时输入是字节不是字符串, 走不到这条路径)。
  const out = new Uint8Array(text.length * 3 + 4);
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    // 代理对 → 合并成一个码点(U+10000..U+10FFFF)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = (code - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
        i += 1;
      } else {
        code = 0xfffd; // 孤立高位代理
      }
    } else if (code >= 0xd800 && code <= 0xdfff) {
      code = 0xfffd; // 孤立低位代理
    }

    if (code < 0x80) {
      out[n++] = code;
    } else if (code < 0x800) {
      out[n++] = 0xc0 | (code >> 6);
      out[n++] = 0x80 | (code & 0x3f);
    } else if (code < 0x10000) {
      out[n++] = 0xe0 | (code >> 12);
      out[n++] = 0x80 | ((code >> 6) & 0x3f);
      out[n++] = 0x80 | (code & 0x3f);
    } else {
      out[n++] = 0xf0 | (code >> 18);
      out[n++] = 0x80 | ((code >> 12) & 0x3f);
      out[n++] = 0x80 | ((code >> 6) & 0x3f);
      out[n++] = 0x80 | (code & 0x3f);
    }
  }
  return out.slice(0, n);
};

/**
 * Convert a `BufferSource` (ArrayBuffer | ArrayBufferView) to a Uint8Array view.
 *
 * `string` 写进签名里是刻意的: 函数体有一条"把非 BufferSource 的原始值当文本
 * 再 UTF-8 编码"的兜底分支, 而类型比实现窄的话那条分支就成了永远到不了的
 * 死代码 —— 偏偏它是最需要被测的那一支(见下面的注释)。
 */
export const bytesFromBufferSource = (input: BufferSource | string): Uint8Array => {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    const view = input as unknown as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  // 走到这里说明调用方传了个原始值(字符串/数字)。SubtleCrypto 规范里没这条路,
  // 但我们容忍这种情况 —— **而且必须是 UTF-8, 不能是 Latin-1**。
  //
  // 为什么强调这点(而不是"因为它坏了"): 这一支之前是逐字符 `charCodeAt(i) & 0xff`,
  // 也就是 Latin-1 语义。它**不是**当前已知 bug 的成因 —— 唯一的字符串调用方
  // `bookIdTag(bookId)` 走的是 `sha1Bytes(new TextEncoder().encode(bookId))`,
  // 进的是上面 `ArrayBuffer.isView` 那条分支, 一直都是对的 UTF-8。
  //
  // 改这里的理由是: 这是一条**静默产出错误结果**的兜底路径。Latin-1 会让
  // U+4E01(丁) 和 U+4F01(企) 塌缩成同一个字节 —— 两条不同输入算出同一个 hash,
  // 而调用方拿到的返回值类型完全正常, 不抛不警告。真有人往这里传字符串的那天,
  // 表现会是"文件名冲突 / 缓存串了", 而不是任何一眼能看出根因的错误。
  // 静默返回错误结果比 throw 危险得多,所以这里宁可多写一个编码器。
  return utf8Bytes(String(input));
};

/** Compute the SHA-1 digest of `bytes` and return the 20-byte big-endian hash. */
export const sha1Bytes = (bytes: Uint8Array): ArrayBuffer => {
  const len = bytes.length;
  const bitLen = len * 8;
  // Pad: append 0x80, then zeros, then 8-byte big-endian length.
  // (((len + 9) + 63) & ~63) rounds up to the next 64-byte block.
  const padLen = (((len + 9) + 63) & ~63) - len;
  const buf = new Uint8Array(len + padLen);
  buf.set(bytes);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  const high = Math.floor(bitLen / 0x100000000);
  const low = bitLen >>> 0;
  view.setUint32(buf.length - 8, high, false);
  view.setUint32(buf.length - 4, low, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const rotl = (x: number, n: number): number => (x << n) | (x >>> (32 - n));
  const w = new Uint32Array(80);
  for (let i = 0; i < buf.length; i += 64) {
    for (let j = 0; j < 16; j++) {
      w[j] = view.getUint32(i + j * 4, false);
    }
    for (let j = 16; j < 80; j++) {
      w[j] = rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j++) {
      let f: number, k: number;
      if (j < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (j < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const temp = (rotl(a, 5) + f + e + k + w[j]) | 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = temp;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const out = new ArrayBuffer(20);
  const outView = new DataView(out);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  return out;
};

/** Hex-encode an ArrayBuffer (used for readable SHA-1 test vectors). */
export const hexFromBuffer = (buffer: ArrayBuffer): string => {
  const view = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, "0");
  }
  return out;
};