// Polyfills for legacy WebViews (notably older Android System WebView on
// devices that no longer receive Play Store updates).
//
// Each polyfill below targets an API used directly by our dependencies:
//   - Object.groupBy / Map.groupBy (Chrome 117+, September 2023)
//     Used by foliate-js 1.0.1 inside epub.js metadata parsing.
//   - ReadableStream.prototype[Symbol.asyncIterator] (Chrome 121+, Dec 2023)
//     Used by pdfjs-dist 6.1.200 in its PDF text-layer and binary stream
//     readers (for await (const chunk of readable)).
//   - Promise.withResolvers (Chrome 119+, September 2023)
//     Used heavily by pdfjs-dist 6.1.200 throughout its stream transport
//     and worker message handling.
//
// Our build target is ES2022 (which predates all three), so esbuild does
// not synthesize these methods. They exist in desktop Obsidian's Chromium
// shell, but not in older Android WebViews.
//
// This module must be imported before any code that depends on it. main.ts
// imports it as its first statement; foliate-js is reached only through a
// dynamic import() inside BookReaderView.openReflowableBook, and pdfjs is
// reached only through an import() inside PdfSession.open. Both run after
// Obsidian evaluates this module, so the polyfills are guaranteed to be
// installed by then.
//
// The native semantics differ slightly from these polyfills in two areas:
//   1. Object.groupBy's native keys go through ToPropertyKey (Symbol keys).
//   2. The result of Object.groupBy is non-extensible and null-prototype.
// foliate-js only passes string keys and never inspects the prototype, so
// these differences do not affect the plugin. Map.groupBy and
// ReadableStream's async iterator are spec-exact reimplementations.

type GroupByCallback<T> = (item: T, index: number) => unknown;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface ObjectConstructor {
    groupBy<T>(
      items: Iterable<T>,
      callback: GroupByCallback<T>
    ): Record<string, T[]>;
  }
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface MapConstructor {
    groupBy<K, T>(
      items: Iterable<T>,
      callback: GroupByCallback<T>
    ): Map<K, T[]>;
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
  // The spec-compliant async iterator: obtain a reader, yield each chunk,
  // release the lock on completion. pdfjs-dist reads chunks via the default
  // reader mode, which our polyfill mirrors exactly.
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
      },
    };
    return iterator;
  };
}

export {};
