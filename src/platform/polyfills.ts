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
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface ObjectConstructor {
    groupBy<T>(items: Iterable<T>, callback: GroupByCallback<T>): Record<string, T[]>;
  }
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface MapConstructor {
    groupBy<K, T>(items: Iterable<T>, callback: GroupByCallback<T>): Map<K, T[]>;
  }
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface PromiseConstructor {
    withResolvers<T>(): {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
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

// structuredClone (Chrome 98+, Feb 2022) — foliate-js may pass metadata
// objects through it on some Android WebViews. JSON round-trip handles the
// cases foliate cares about (plain objects, arrays, primitives). Map/Set/
// Date/RegExp/typed-arrays are NOT preserved, but foliate doesn't put any
// of those through structuredClone in its public surface.
//
// Note: install onto both globalThis.structuredClone and the structuredClone
// identifier some bundlers capture at module init time. The conditional
// preserves the native implementation if it exists.
if (typeof (globalThis as { structuredClone?: unknown }).structuredClone !== "function") {
  const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  Object.defineProperty(globalThis, "structuredClone", {
    value: jsonClone,
    writable: true,
    configurable: true
  });
  // Some shimmed environments expose structuredClone as a free binding.
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _probe = (0, eval)("typeof structuredClone");
    if (_probe === "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _assign = (0, eval)("structuredClone = (v) => JSON.parse(JSON.stringify(v))");
      void _assign;
    }
  } catch {
    // indirect eval blocked — that's fine, globalThis assignment above suffices
  }
}

// crypto.subtle.digest SHA-1 fallback — foliate-js 1.0.1's epub.js hashes
// section bytes for CFI computation. Some Android WebViews ship with
// crypto.subtle = undefined; we provide a minimal pure-JS SHA-1 so CFI
// resolution doesn't throw and trip the rest of the EPUB init.
//
// The algorithm lives in `./Sha1.ts` so it can be unit-tested with
// FIPS test vectors without mutating globalThis.
import { bytesFromBufferSource, sha1Bytes } from "./Sha1";

const installSha1DigestFallback = (): void => {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj && typeof cryptoObj.subtle?.digest === "function") return;

  const subtle = {
    async digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer> {
      const name = String(algorithm).toLowerCase();
      if (name !== "sha-1" && name !== "sha1") {
        throw new Error(`crypto.subtle.digest fallback only supports SHA-1 (requested: ${algorithm})`);
      }
      return sha1Bytes(bytesFromBufferSource(data));
    }
  } as unknown as SubtleCrypto;

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
      Object.defineProperty(globalThis, "crypto", {
        value: { subtle, getRandomValues: (a: Uint8Array) => a },
        configurable: true,
        writable: true
      });
    } catch (error) {
      console.warn("[ez-reader] could not install crypto stub", error);
    }
  }
};
installSha1DigestFallback();

// Diagnostic helper — emitted once at startup so we can see which modern
// APIs the current WebView is missing. Helps triage Android white screens.
interface PolyfillReport {
  readonly missing: ReadonlyArray<string>;
  readonly userAgent: string;
}
export const collectPolyfillReport = (): PolyfillReport => {
  const checks: ReadonlyArray<readonly [string, unknown]> = [
    ["Object.groupBy", (globalThis as { Object?: { groupBy?: unknown } }).Object?.groupBy],
    ["Map.groupBy", (globalThis as { Map?: { groupBy?: unknown } }).Map?.groupBy],
    ["Promise.withResolvers", Promise.withResolvers],
    ["ReadableStream[Symbol.asyncIterator]", typeof ReadableStream !== "undefined" && typeof ReadableStream.prototype[Symbol.asyncIterator] === "function"],
    ["structuredClone", typeof (globalThis as { structuredClone?: unknown }).structuredClone === "function"],
    ["crypto.subtle.digest", typeof (globalThis as { crypto?: { subtle?: { digest?: unknown } } }).crypto?.subtle?.digest === "function"],
    ["ResizeObserver", typeof ResizeObserver !== "undefined"],
    ["Intl.Segmenter", typeof Intl !== "undefined" && typeof (Intl as { Segmenter?: unknown }).Segmenter === "function"],
    ["customElements", typeof customElements !== "undefined"]
  ];
  const missing = checks.filter(([, present]) => !present).map(([name]) => name);
  return { missing, userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "n/a" };
};

export {};