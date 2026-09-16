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

/** Convert a `BufferSource` (ArrayBuffer | ArrayBufferView) to a Uint8Array view. */
export const bytesFromBufferSource = (input: BufferSource): Uint8Array => {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    const view = input as unknown as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  // Anything else: coerce to string, then UTF-8 (Latin-1) encode. This
  // branch only fires if a caller hands us a primitive like a number or
  // string directly, which the SubtleCrypto spec doesn't really allow but
  // we tolerate gracefully.
  const text = String(input);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
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