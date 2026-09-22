import { test } from "node:test";
import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";
import type { BookBytesLoader } from "../../src/core/ports/BookReader";
import type { PagedTextContent } from "../../src/adapters/text/PagedTextSession";
import { PagedTextSession } from "../../src/adapters/text/PagedTextSession";
import { DEFAULT_READER_APPEARANCE } from "../../src/core/types/ReaderSettings";

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
const DOM_GLOBALS = [
  "document", "window", "Node", "NodeFilter", "DocumentFragment",
  "Range", "HTMLElement", "HTMLStyleElement", "Text", "requestAnimationFrame",
  "DOMParser"
];
for (const key of DOM_GLOBALS) {
  (globalThis as Record<string, unknown>)[key] = (dom.window as unknown as Record<string, unknown>)[key];
}

const makeContent = (pageCount: number): PagedTextContent => ({
  pages: Array.from({ length: pageCount }, (_, i) => ({
    text: `page ${i + 1}`,
    css: []
  }))
});

const makeSession = (pageCount: number): PagedTextSession => {
  const content = makeContent(pageCount);
  const host = document.createElement("div");
  document.body.append(host);
  const loader: BookBytesLoader = (async () => new ArrayBuffer(0)) as BookBytesLoader;
  return new PagedTextSession({
    content,
    host,
    appearance: DEFAULT_READER_APPEARANCE,
    loader
  });
};

test("PagedTextSession: on() returned off() removes from disposers (no leak)", async () => {
  // P1 polish: previously off() closure stayed in `disposers` Set even
  // after the listener was removed. Calling on() N times → N stale
  // disposers → close() no-ops through N entries. Now off() deletes
  // itself from the set.
  const session = makeSession(3);
  const ref = session as unknown as { disposers: Set<unknown> };
  const initial = ref.disposers.size;
  const offs: Array<() => void> = [];
  // Subscribe to several generic events.
  offs.push(session.on("close", () => {}));
  offs.push(session.on("link-click", () => {}));
  offs.push(session.on("relocate", () => {}));
  const afterOn = ref.disposers.size;
  assert.ok(afterOn >= initial + 2, `expected +2 generic events tracked, got ${afterOn - initial}`);
  // Now unsubscribe.
  for (const off of offs) off();
  // All generic off()s should have removed themselves from disposers.
  assert.equal(
    ref.disposers.size,
    initial,
    `disposers should be back to initial after off(); got ${ref.disposers.size} vs initial ${initial}`
  );
  await session.close();
});

test("PagedTextSession: off() is idempotent (calling twice doesn't double-delete)", async () => {
  const session = makeSession(2);
  const ref = session as unknown as { disposers: Set<unknown> };
  const off = session.on("close", () => {});
  const beforeSize = ref.disposers.size;
  off();
  off(); // second call should be no-op, not throw
  assert.equal(
    ref.disposers.size,
    beforeSize - 1,
    "second off() should be a no-op"
  );
  await session.close();
});

test("PagedTextSession: close() dispatches 'close' event to subscribers", async () => {
  // P1 polish: element.remove() doesn't fire a "close" event, and the
  // disposeOn loop didn't dispatch one either. Listeners registered via
  // on("close", ...) used to never run. Now close() fires the event
  // before removing listeners, so subscribers can react.
  const session = makeSession(2);
  let fired = false;
  session.on("close", () => {
    fired = true;
  });
  await session.close();
  assert.equal(fired, true, "on('close') listener should fire before close() completes");
});

test("PagedTextSession: multiple subscribers all see close event", async () => {
  const session = makeSession(2);
  let a = 0, b = 0, c = 0;
  session.on("close", () => { a += 1; });
  session.on("close", () => { b += 1; });
  session.on("close", () => { c += 1; });
  await session.close();
  assert.equal(a + b + c, 3, "all three close listeners should fire");
});
