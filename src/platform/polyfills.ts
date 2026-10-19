// Polyfills for legacy WebViews (notably older Android System WebView on
// devices that no longer receive Play Store updates).
//
// Each polyfill below targets an API used directly by our dependencies:
//   - Object.groupBy / Map.groupBy (Chrome 117+, September 2023)
//     Used by foliate-js 1.0.1 inside epub.js metadata parsing.
//   - ReadableStream.prototype[Symbol.asyncIterator] (Chrome 121+, Dec 2023)
//     Used by foliate for reading zip entries and asset blobs from EPUBs.
//   - Promise.withResolvers (Chrome 119+, September 2023)
//     Used by foliate for deferred promise handshake in its paginator.
//   - structuredClone (Chrome 98+, February 2022)
//     Used by foliate for deep-cloning parsed metadata.
//     Falls back to JSON round-trip — good enough for plain JS objects,
//     loses Map/Set/Date fidelity which foliate does not rely on.
//   - crypto.subtle.digest (Chrome 37+, October 2014)
//     Used by foliate-js 1.0.1 inside epub.js for EPUB CFI hashing
//     (SHA-1 over section bytes). Usually present in secure contexts
//     (Electron desktop, file:// in Obsidian is treated as secure). On
//     some Android WebViews it returns undefined; we provide a pure-JS
//     SHA-1 fallback so EPUB CFI still resolves.
//
// Our build target is ES2022 (which predates the groupBy / withResolvers /
// asyncIterator trio), so esbuild does not synthesize these methods. They
// exist in desktop Obsidian's Chromium shell, but not in older Android
// WebViews.
//
// This module must be imported before any code that depends on it. main.ts
// imports it as its first statement; foliate-js is reached only through a
// dynamic import() inside FoliateBookReader.open, so the polyfills are
// guaranteed to be installed by then.

type GroupByCallback<T> = (item: T, index: number) => unknown;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface -- TS module augmentation: declares signatures on global constructors (Object / Map / Promise / ReadableStream). Members live inline; the empty-body check is a false positive for ambient augmentation.
  interface ObjectConstructor {
    groupBy<T>(items: Iterable<T>, callback: GroupByCallback<T>): Record<string, T[]>;
  }
  // eslint-disable-next-line @typescript-eslint/no-empty-interface -- see ObjectConstructor above; Map receives the same module augmentation pattern.
  interface MapConstructor {
    groupBy<K, T>(items: Iterable<T>, callback: GroupByCallback<T>): Map<K, T[]>;
  }
  // eslint-disable-next-line @typescript-eslint/no-empty-interface -- see ObjectConstructor above; Promise receives the same module augmentation pattern.
  interface PromiseConstructor {
    withResolvers<T>(): {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-empty-interface -- see ObjectConstructor above; ReadableStream prototype receives the same module augmentation pattern.
  interface ReadableStream<R> {
    [Symbol.asyncIterator](): AsyncIterableIterator<R>;
  }
}

if (typeof Object.groupBy !== "function") {
  Object.groupBy = function groupBy<T>(
    items: Iterable<T>,
    callback: GroupByCallback<T>
  ): Record<string, T[]> {
    const result = Object.create(null) as Record<string, T[]>;
    let index = 0;
    for (const item of items) {
      const key = String(callback(item, index));
      const bucket = result[key];
      if (bucket) bucket.push(item);
      else result[key] = [item];
      index += 1;
    }
    return result;
  };
}

if (typeof Map.groupBy !== "function") {
  Map.groupBy = function groupBy<K, T>(
    items: Iterable<T>,
    callback: GroupByCallback<T>
  ): Map<K, T[]> {
    const result = new Map<K, T[]>();
    let index = 0;
    for (const item of items) {
      const key = callback(item, index) as K;
      const bucket = result.get(key);
      if (bucket) bucket.push(item);
      else result.set(key, [item]);
      index += 1;
    }
    return result;
  };
}

if (typeof Promise.withResolvers !== "function") {
  Promise.withResolvers = function withResolvers<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  } {
    let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
    let reject: (reason?: unknown) => void = () => undefined;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

if (
  typeof ReadableStream !== "undefined" &&
  typeof ReadableStream.prototype[Symbol.asyncIterator] !== "function"
) {
  ReadableStream.prototype[Symbol.asyncIterator] = function asyncIterator<R>(this: ReadableStream<R>): AsyncIterableIterator<R> {
    const reader = this.getReader();
    const iterator: AsyncIterableIterator<R> = {
      async next(): Promise<IteratorResult<R>> {
        try {
          const { done, value } = await reader.read();
          return done ? { value: undefined, done: true } : { value, done: false };
        } catch (error) {
          reader.releaseLock();
          throw error;
        }
      },
      async return(): Promise<IteratorResult<R>> {
        try {
          if (typeof reader.cancel === "function") {
            await reader.cancel();
          }
        } finally {
          reader.releaseLock();
        }
        return { value: undefined, done: true };
      },
      [Symbol.asyncIterator]() {
        return iterator;
      }
    };
    return iterator;
  };
}

// polyfills 只在浏览器式宿主 (Obsidian 的 Electron / Android WebView) 里安装。
// Node 下的单测会 import 本模块来验证算法本身, 那时没有 `window`, 直接
// 访问会在模块求值期抛 ReferenceError —— 整个测试文件都跑不起来。
// 所以先取一个"宿主 window", 取不到就跳过安装; 纯算法仍然照常导出。
const hostWindow = (): (Window & typeof globalThis) | null =>
  typeof window === "undefined" ? null : window;

// structuredClone (Chrome 98+, Feb 2022) — foliate-js may pass metadata
// objects through it on some Android WebViews. JSON round-trip handles the
// cases foliate cares about (plain objects, arrays, primitives). Map/Set/
// Date/RegExp/typed-arrays are NOT preserved, but foliate doesn't put any
// of those through structuredClone in its public surface.
//
// Note: install onto the host's structuredClone. The previous eval fallback
// for free-binding environments is removed — Obsidian's auto-review flags
// eval, and Obsidian's Electron / Android WebView runtimes never capture
// structuredClone as a separate free binding (no bundler indirection in this
// code path). The globalThis install covers every runtime lookup foliate-js
// exercises.
const host = hostWindow();
if (host && typeof host.structuredClone !== "function") {
  const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  Object.defineProperty(host, "structuredClone", {
    value: jsonClone,
    writable: true,
    configurable: true
  });
}

// crypto.subtle fallback — foliate-js 1.0.1's epub.js hashes section bytes
// for CFI computation. Some Android WebViews ship with crypto.subtle =
// undefined; we provide pure-JS digests so CFI resolution doesn't throw and
// trip the rest of the EPUB init.
//
// The SHA-1 algorithm lives in `./Sha1.ts` so it can be unit-tested with
// FIPS test vectors without mutating globalThis.
import { bytesFromBufferSource, sha1Bytes } from "./Sha1";

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4)
// ---------------------------------------------------------------------------

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** SHA-256 digest of `bytes`, 32-byte big-endian result. */
const sha256Bytes = (bytes: Uint8Array): ArrayBuffer => {
  const len = bytes.length;
  const bitLen = len * 8;
  // 尾部塞 1 个 0x80 + 零填充 + 8 字节 64-bit 大端长度, 补齐到 64 字节的倍数
  const padded = (((len + 9) + 63) & ~63);
  const buf = new Uint8Array(padded);
  buf.set(bytes);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(padded - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padded - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let i = 0; i < padded; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + (SHA256_K[j] as number) + (w[j] as number)) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }

  const out = new ArrayBuffer(32);
  const outView = new DataView(out);
  outView.setUint32(0, h0, false); outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false); outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false); outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false); outView.setUint32(28, h7, false);
  return out;
};

// ---------------------------------------------------------------------------
// RSASSA-PKCS1-v1_5 (RFC 8017 §8.2) —— Google service-account JWT 签名
// ---------------------------------------------------------------------------

/**
 * 为什么只做这一个签名算法, 而不是"补齐 WebCrypto":
 *
 * polyfill 的目标不是当浏览器, 而是让**我们真正用到的调用**在老 WebView 上
 * 能跑通。翻遍 src/ 之后, 非原生的 crypto.subtle 只有两处消费者:
 *   - 有道智云: `digest("SHA-256", …)`      (签名校验)
 *   - Google  : `importKey("pkcs8", …)` + `sign(RSASSA-PKCS1-v1_5, …)`
 * 所以覆盖 SHA-1 / SHA-256 digest + RSA PKCS#1 v1.5 签验就等于覆盖 100% 的
 * 真实调用面。补 AES / ECDSA / HKDF 只会增加代码体积和出错概率, 而没有任何
 * 一条代码路径会用到它们。
 *
 * 设计要点: **不支持的算法一律 throw, 绝不返回"看起来能用"的结果**。
 * 签名场景下静默返回一个错的结果, 比直接抛异常危险得多 —— 用户会拿到一个
 * 401, 根本猜不到是自己的 WebView 太老; 而 throw 至少能立刻定位到"这台设备
 * 不支持这个算法", 并且 provider 侧的 catch 会把它显示出来。
 */
const normalizeHashName = (name: unknown): string =>
  String(name).toUpperCase().replace(/[^A-Z0-9]/g, "");

/** DER: 读一个 TLV 头, 返回 [tag, contentStart, contentEnd, nextOffset]。 */
const readDerTlv = (bytes: Uint8Array, offset: number): [number, number, number, number] => {
  const tag = bytes[offset] as number;
  let i = offset + 1;
  let length = bytes[i] as number;
  i += 1;
  if (length > 0x80) {
    const count = length - 0x80;
    length = 0;
    for (let k = 0; k < count; k++) {
      length = (length << 8) | (bytes[i + k] as number);
    }
    i += count;
  }
  return [tag, i, i + length, i + length];
};

interface RsaComponents {
  readonly n: Uint8Array;
  readonly e: Uint8Array;
  readonly d?: Uint8Array;
  readonly p?: Uint8Array;
  readonly q?: Uint8Array;
  readonly dp?: Uint8Array;
  readonly dq?: Uint8Array;
  readonly qinv?: Uint8Array;
}

/** 把 PKCS#8 / SPKI 里的 INTEGER 读成"无前导 0 的大端字节串"(BigInt 用)。 */
const derIntegerToBigInt = (bytes: Uint8Array): bigint => {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex.length === 0 ? 0n : BigInt(`0x${hex}`);
};

const bigIntToBytes = (value: bigint, length: number): Uint8Array => {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
};

const bytesToBigInt = (bytes: Uint8Array): bigint => {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex.length === 0 ? 0n : BigInt(`0x${hex}`);
};

/**
 * 解析 PKCS#8 私钥 / SPKI 公钥。只支持 rsaEncryption (OID 1.2.840.113549.1.1.1)。
 *
 * 之所以值得手写: 老 WebView 上没有 WebCrypto, 而 RSA 的模幂运算需要大整数。
 * 自己实现一套 bignum(乘除/取模)几百行代码, 换来的是一个**只在极少数老设备上
 * 才走到的签名路径**; 而 `BigInt` 内置(Chrome 67+)覆盖了这批设备里绝大多数
 * 还活着的那部分。所以这里用 BigInt, 缺 BigInt 就明确 throw, 而不是塞一个
 * 没测试覆盖的大数库。
 */
const parseRsaKey = (bytes: Uint8Array, wantPrivate: boolean): RsaComponents => {
  if (typeof BigInt !== "function") {
    throw new Error(
      "本设备的 JavaScript 不支持 BigInt, 无法兜底实现 RSA 签名。请在桌面端使用 Google 翻译, 或换用不需要签名的翻译服务(有道 / DeepL)。"
    );
  }
  let [, seqStart, seqEnd] = readDerTlv(bytes, 0);
  if (seqEnd > bytes.length) throw new Error("RSA 密钥解析失败: DER 结构被截断");
  let i = seqStart;

  if (!wantPrivate) {
    // SPKI: SEQUENCE { AlgorithmIdentifier, BIT STRING }
    // 手工推进游标跳过 algId 的整个 TLV —— 比递归解析更不容易错位, 也不需要
    // 校验 OID(算法名不对的话下面的模长会明显不对, 签名/验签会失败)。
    const [, , algNext] = readDerTlv(bytes, i);
    i = algNext;
    // BIT STRING 的第 0 个字节是"未使用的 bit 数"(公钥恒为 0), 跳过它,
    // 之后是 RSAPublicKey ::= SEQUENCE { INTEGER n, INTEGER e }。
    // 必须在**这层 SEQUENCE 的 content 内部**依次读 n 和 e —— 直接跳到
    // contentEnd 去读 e 会越过 n, 拿到一个空模数, 表现为"所有签名都验不过"。
    const [, bitContent] = readDerTlv(bytes, i);
    const [, innerStart] = readDerTlv(bytes, bitContent + 1);
    const [, nStart, nEnd] = readDerTlv(bytes, innerStart);
    const [, eStart, eEnd] = readDerTlv(bytes, nEnd);
    if (eEnd > seqEnd) {
      throw new Error("RSA 公钥解析失败: SPKI 内层结构越界");
    }
    return {
      n: bytes.slice(nStart, nEnd),
      e: bytes.slice(eStart, eEnd)
    };
  }

  // PKCS#8: SEQUENCE { version, AlgorithmIdentifier, OCTET STRING { RSAPrivateKey } }
  // 注意 privateKey 的 OCTET STRING 里**又套了一层** RSAPrivateKey 的 SEQUENCE,
  // 必须先剥掉这层再按 9 个 INTEGER 读 —— 少剥一层的话第一个"整数"其实是
  // SEQUENCE 的 tag/length, 于是所有分量全读成空数组, 后面 modPow 直接抛
  // "模长 1 字节"(调试这个花了一轮)。
  const [, , versionNext] = readDerTlv(bytes, i);
  i = versionNext;
  const [, , algNext] = readDerTlv(bytes, i);
  i = algNext;
  const [, octetStart, octetEnd] = readDerTlv(bytes, i);
  if (octetEnd > seqEnd) throw new Error("RSA 私钥解析失败: PKCS#8 内层结构越界");
  const [, innerStart] = readDerTlv(bytes, octetStart);
  if (innerStart > octetEnd) throw new Error("RSA 私钥解析失败: PKCS#8 里没有 RSAPrivateKey SEQUENCE");
  let j = innerStart;
  const next = (): void => {
    const [, , end] = readDerTlv(bytes, j);
    j = end;
  };
  next(); // version
  const readInt = (): Uint8Array => {
    const [, s, e] = readDerTlv(bytes, j);
    j = e;
    return bytes.slice(s, e);
  };
  const n = readInt();
  const e = readInt();
  const d = readInt();
  const p = readInt();
  const q = readInt();
  const dp = readInt();
  const dq = readInt();
  const qinv = readInt();
  return { n, e, d, p, q, dp, dq, qinv };
};

/** DER: 整数 → 内容字节(去掉前导 0, 补 0x00 防负数歧义)。 */
const derIntegerContent = (value: Uint8Array): Uint8Array => {
  let start = 0;
  while (start < value.length - 1 && (value[start] as number) === 0) start += 1;
  const trimmed = value.slice(start);
  if ((trimmed[0] as number) < 0x80) return trimmed;
  const out = new Uint8Array(trimmed.length + 1);
  out.set(trimmed, 1);
  return out;
};

const derLength = (length: number): Uint8Array => {
  if (length < 0x80) return new Uint8Array([length]);
  const bytes: number[] = [];
  let v = length;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
};

const derWrap = (tag: number, content: Uint8Array): Uint8Array => {
  const out = new Uint8Array(1 + derLength(content.length).length + content.length);
  out[0] = tag;
  out.set(derLength(content.length), 1);
  out.set(content, 1 + derLength(content.length).length);
  return out;
};

const derConcat = (parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** 把 RSAPrivateKey 重新编码成 PKCS#8(供 exportKey("pkcs8") 用)。 */
const encodePkcs8 = (key: RsaComponents): ArrayBuffer => {
  const int = (bytes: Uint8Array): Uint8Array => derWrap(0x02, derIntegerContent(bytes));
  const rsaPrivateKey = derWrap(
    0x30,
    derConcat([
      derWrap(0x02, new Uint8Array([0])), // version
      int(key.n), int(key.e), int(key.d as Uint8Array),
      int(key.p as Uint8Array), int(key.q as Uint8Array),
      int(key.dp as Uint8Array), int(key.dq as Uint8Array), int(key.qinv as Uint8Array)
    ])
  );
  const algId = derWrap(0x30, derConcat([
    derWrap(0x06, new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01])), // rsaEncryption
    derWrap(0x05, new Uint8Array(0)) // NULL
  ]));
  const body = derConcat([
    derWrap(0x02, new Uint8Array([0])), // version 0
    algId,
    derWrap(0x04, rsaPrivateKey)
  ]);
  const out = derWrap(0x30, body);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
};

/** DER: 公钥 → SPKI。 */
const encodeSpki = (key: RsaComponents): ArrayBuffer => {
  const int = (bytes: Uint8Array): Uint8Array => derWrap(0x02, derIntegerContent(bytes));
  const rsaPublicKey = derWrap(0x30, derConcat([int(key.n), int(key.e)]));
  const algId = derWrap(0x30, derConcat([
    derWrap(0x06, new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01])),
    derWrap(0x05, new Uint8Array(0))
  ]));
  const body = derConcat([algId, derWrap(0x03, derConcat([new Uint8Array([0]), rsaPublicKey]))]);
  const out = derWrap(0x30, body);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
};

/** DigestInfo DER 前缀(RFC 8017 §9.2 note 1)。 */
const DIGEST_INFO_PREFIX: Readonly<Record<string, Uint8Array>> = {
  SHA1: new Uint8Array([0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14]),
  SHA256: new Uint8Array([0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20])
};

/** EMSA-PKCS1-v1_5 编码: 0x00 || 0x01 || 0xFF… || 0x00 || DigestInfo。 */
const emsaPkcs1v15 = (message: Uint8Array, hashName: string, modulusLength: number): Uint8Array => {
  const prefix = DIGEST_INFO_PREFIX[hashName];
  if (!prefix) throw new Error(`不支持的签名哈希算法: ${hashName}。当前只实现 SHA-1 / SHA-256。`);
  const hash = hashName === "SHA1" ? sha1Bytes(message) : sha256Bytes(message);
  const tLen = prefix.length + hash.byteLength;
  if (modulusLength < tLen + 11) {
    throw new Error(`RSA 密钥太短: 模长 ${modulusLength} 字节装不下签名(至少需要 ${tLen + 11})。`);
  }
  const em = new Uint8Array(modulusLength);
  em[0] = 0x00;
  em[1] = 0x01;
  for (let i = 2; i < modulusLength - tLen - 1; i++) em[i] = 0xff;
  em[modulusLength - tLen - 1] = 0x00;
  em.set(prefix, modulusLength - tLen);
  em.set(new Uint8Array(hash), modulusLength - hash.byteLength);
  return em;
};

/** 模幂(base^exp mod m), square-and-multiply。 */
const modPow = (base: bigint, exp: bigint, modulus: bigint): bigint => {
  if (modulus <= 0n) throw new Error("模数非法");
  let result = 1n;
  let b = base % modulus;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    e >>= 1n;
    b = (b * b) % modulus;
  }
  return result;
};

/** 极简恒定时间比较(验签路径上不因为提前返回泄露前缀)。 */
const timingSafeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
};

/** fallback 内部的 CryptoKey —— 形状对齐 WebCrypto, 但没有 native 句柄。 */
interface FallbackKey {
  readonly type: "private" | "public";
  readonly extractable: boolean;
  readonly algorithm: { readonly name: string; readonly hash: { readonly name: string } };
  readonly usages: ReadonlyArray<string>;
  readonly components: RsaComponents;
}

const isFallbackKey = (key: unknown): key is FallbackKey =>
  !!key && typeof key === "object" && "components" in (key as Record<string, unknown>);

/**
 * 造一个可单测的 subtle 对象。生产环境由 `installSubtleFallback()` 装到宿主,
 * 测试直接 import 这个工厂 —— 纯算法验证不需要、也不应该碰 globalThis。
 */
const createFallbackSubtle = (): SubtleCrypto => {
  const subtle = {
    async digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer> {
      const name = normalizeHashName(algorithm);
      const bytes = bytesFromBufferSource(data);
      if (name === "SHA1") return sha1Bytes(bytes);
      if (name === "SHA256") return sha256Bytes(bytes);
      // 关键设计: 不认识的算法必须 throw。见文件顶部"为什么只做这几个"。
      throw new Error(
        `crypto.subtle 兜底只实现了 SHA-1 / SHA-256 的 digest(请求的是: ${algorithm})。` +
        `这是老 WebView 兼容层, 请换用不需要该算法的功能, 或在桌面端使用。`
      );
    },

    async importKey(
      format: string,
      keyData: BufferSource,
      algorithm: { name: string; hash?: { name: string } | string },
      extractable: boolean,
      keyUsages: ReadonlyArray<string>
    ): Promise<CryptoKey> {
      const name = String(algorithm?.name ?? "");
      if (name !== "RSASSA-PKCS1-v1_5") {
        throw new Error(`crypto.subtle.importKey 兜底只实现了 RSASSA-PKCS1-v1_5(请求的是: ${name})。`);
      }
      const hashRaw = algorithm?.hash;
      const hashName = normalizeHashName(typeof hashRaw === "string" ? hashRaw : hashRaw?.name);
      if (!DIGEST_INFO_PREFIX[hashName]) {
        throw new Error(`RSASSA-PKCS1-v1_5 兜底只支持 SHA-1 / SHA-256 哈希(请求的是: ${String(hashName)})。`);
      }
      const bytes = bytesFromBufferSource(keyData);
      const fmt = String(format).toLowerCase();
      const wantPrivate = fmt === "pkcs8";
      if (!wantPrivate && fmt !== "spki" && fmt !== "jwk") {
        throw new Error(`不支持的密钥格式: ${format}(兜底实现支持 pkcs8 / spki / jwk)。`);
      }
      const components = parseRsaKey(bytes, wantPrivate);
      for (const usage of keyUsages) {
        if (wantPrivate && usage !== "sign") {
          throw new Error(`私钥兜底实现只支持 sign, 不支持 ${usage}。`);
        }
        if (!wantPrivate && usage !== "verify") {
          throw new Error(`公钥兜底实现只支持 verify, 不支持 ${usage}。`);
        }
      }
      return {
        type: wantPrivate ? "private" : "public",
        extractable,
        algorithm: { name, hash: { name: hashName } },
        usages: [...keyUsages],
        components
      } as unknown as CryptoKey;
    },

    async sign(algorithm: { name: string; hash?: { name: string } | string }, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer> {
      const name = String(algorithm?.name ?? "");
      if (name !== "RSASSA-PKCS1-v1_5") {
        throw new Error(`crypto.subtle.sign 兜底只实现了 RSASSA-PKCS1-v1_5(请求的是: ${name})。`);
      }
      if (!isFallbackKey(key) || key.type !== "private") {
        throw new Error("crypto.subtle.sign 需要私钥 key。");
      }
      const hashRaw = algorithm?.hash;
      const hashName = normalizeHashName(typeof hashRaw === "string" ? hashRaw : (hashRaw?.name ?? key.algorithm.hash.name));
      const components = key.components;
      if (!components.d || !components.n || !components.e) {
        throw new Error("私钥缺少签名所需的 n / d 分量。");
      }
      const n = derIntegerToBigInt(components.n);
      const modulusLength = (n.toString(16).length + 1) >> 1;
      const em = emsaPkcs1v15(bytesFromBufferSource(data), hashName, modulusLength);
      const m = bytesToBigInt(em);
      const signature = modPow(m, derIntegerToBigInt(components.d), n);
      const out = bigIntToBytes(signature, modulusLength);
      return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
    },

    async verify(algorithm: { name: string; hash?: { name: string } | string }, key: CryptoKey, signature: BufferSource, data: BufferSource): Promise<boolean> {
      const name = String(algorithm?.name ?? "");
      if (name !== "RSASSA-PKCS1-v1_5") {
        throw new Error(`crypto.subtle.verify 兜底只实现了 RSASSA-PKCS1-v1_5(请求的是: ${name})。`);
      }
      if (!isFallbackKey(key)) {
        throw new Error("crypto.subtle.verify 需要公钥 key。");
      }
      const hashRaw = algorithm?.hash;
      const hashName = normalizeHashName(typeof hashRaw === "string" ? hashRaw : (hashRaw?.name ?? key.algorithm.hash.name));
      const components = key.components;
      const n = derIntegerToBigInt(components.n);
      const e = derIntegerToBigInt(components.e);
      const modulusLength = (n.toString(16).length + 1) >> 1;
      const s = bytesToBigInt(bytesFromBufferSource(signature));
      if (s >= n) return false;
      const em = bigIntToBytes(modPow(s, e, n), modulusLength);
      let expected: Uint8Array;
      try {
        expected = emsaPkcs1v15(bytesFromBufferSource(data), hashName, modulusLength);
      } catch (error) {
        throw error;
      }
      return timingSafeEqual(em, expected);
    },

    async exportKey(format: string, key: CryptoKey): Promise<ArrayBuffer> {
      if (!isFallbackKey(key)) {
        throw new Error("crypto.subtle.exportKey 只支持兜底实现自己造的 key。");
      }
      if (!key.extractable) {
        throw new Error("该 key 导入时 extractable = false, 不能导出。");
      }
      const fmt = String(format).toLowerCase();
      if (key.type === "private") {
        if (fmt !== "pkcs8") {
          throw new Error(`私钥兜底实现只支持导出 pkcs8(请求的是: ${format})。`);
        }
        return encodePkcs8(key.components);
      }
      if (fmt !== "spki") {
        throw new Error(`公钥兜底实现只支持导出 spki(请求的是: ${format})。`);
      }
      return encodeSpki(key.components);
    }
  };
  return subtle as unknown as SubtleCrypto;
};
export { createFallbackSubtle };

const installSubtleFallback = (): void => {
  const scope = hostWindow();
  if (!scope) return; // Node (单测) 里没有宿主, 不装 —— 算法本身已单独导出
  const cryptoObj = (scope as { crypto?: Crypto }).crypto;
  if (cryptoObj && typeof cryptoObj.subtle?.digest === "function") return;

  const subtle = createFallbackSubtle();

  if (cryptoObj) {
    // crypto exists but subtle is missing — patch subtle onto it.
    try {
      Object.defineProperty(cryptoObj, "subtle", {
        value: subtle,
        configurable: true,
        writable: true
      });
    } catch (error) {
      console.warn("[ez-reader] could not install crypto.subtle fallback", error);
    }
  } else {
    // No crypto at all — install a minimal stub.
    try {
      Object.defineProperty(scope, "crypto", {
        value: { subtle, getRandomValues: (a: Uint8Array) => a },
        configurable: true,
        writable: true
      });
    } catch (error) {
      console.warn("[ez-reader] could not install crypto stub", error);
    }
  }
};
installSubtleFallback();

// Diagnostic helper — emitted once at startup so we can see which modern
// APIs the current WebView is missing. Helps triage Android white screens.
// We deliberately don't include navigator.userAgent here: Obsidian's
// auto-review flags navigator-based OS detection, and Platform.isAndroid
// / Platform.isDesktop etc. are the supported way to detect environment
// from a plugin context. The polyfill module runs before Obsidian is
// fully booted, so it can't import Platform — instead we just report
// the missing APIs and let the host plugin decide what to do with them.
interface PolyfillReport {
  readonly missing: ReadonlyArray<string>;
}
export const collectPolyfillReport = (): PolyfillReport => {
  const scope = hostWindow() as (Window & typeof globalThis) | undefined;
  const checks: ReadonlyArray<readonly [string, unknown]> = [
    ["Object.groupBy", (scope?.Object as { groupBy?: unknown } | undefined)?.groupBy],
    ["Map.groupBy", (scope?.Map as { groupBy?: unknown } | undefined)?.groupBy],
    ["Promise.withResolvers", Promise.withResolvers],
    ["ReadableStream[Symbol.asyncIterator]", typeof ReadableStream !== "undefined" && typeof ReadableStream.prototype[Symbol.asyncIterator] === "function"],
    ["structuredClone", typeof scope?.structuredClone === "function"],
    ["crypto.subtle.digest", typeof scope?.crypto?.subtle?.digest === "function"],
    ["crypto.subtle.sign", typeof scope?.crypto?.subtle?.sign === "function"],
    ["ResizeObserver", typeof ResizeObserver !== "undefined"],
    ["Intl.Segmenter", typeof Intl !== "undefined" && typeof (Intl as { Segmenter?: unknown }).Segmenter === "function"],
    ["customElements", typeof customElements !== "undefined"]
  ];
  const missing = checks.filter(([, present]) => !present).map(([name]) => name);
  return { missing };
};

export {};