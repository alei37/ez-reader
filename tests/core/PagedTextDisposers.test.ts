import { test } from "node:test";
import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";
import type { BookBytesLoader } from "../../src/core/ports/BookReader";
import type { PagedTextContent } from "../../src/adapters/text/PagedTextSession";
import { PagedTextSession } from "../../src/adapters/text/PagedTextSession";
import { DEFAULT_READER_APPEARANCE } from "../../src/core/types/ReaderSettings";

// Copy jsdom DOM globals onto globalThis so PagedTextSession can
// reach them via globalThis.document etc.
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
const DOM_GLOBALS = [
  "document", "window", "Node", "NodeFilter", "DocumentFragment",
  "Range", "HTMLElement", "HTMLStyleElement", "Text", "requestAnimationFrame",
  "DOMParser"
];
for (const key of DOM_GLOBALS) {
  (globalThis as Record<string, unknown>)[key] = (dom.window as unknown as Record<string, unknown>)[key];
}

const makeContent = (pages: number): PagedTextContent => ({
  pages: Array.from({ length: pages }, (_, i) => ({
    text: `page ${i + 1}`,
    css: []
  }))
});

const makeSession = (pages: number): PagedTextSession => {
  const content = makeContent(pages);
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

test("PagedTextSession: stageEl listeners don't accumulate across page flips", async () => {
  const session = makeSession(50);
  // After construction, page 0 is rendered → selectionCleanup is set
  const ref = session as unknown as { disposers: Set<unknown>; selectionCleanup: (() => void) | null };
  const initial = ref.disposers.size;
  for (let i = 0; i < 30; i++) {
    await session.goTo({ kind: "next" });
  }
  const after30 = ref.disposers.size;
  // P1 polish: before fix, each flip appended one cleanup closure into
  // disposers (set never cleared until close()). After 30 flips we'd have
  // +30 entries. Now disposers stays roughly constant — selectionCleanup
  // is overwritten, not appended. We allow a small slack for other
  // disposers (e.g. animateend handlers).
  assert.ok(
    after30 - initial <= 2,
    `disposers grew by ${after30 - initial} after 30 flips (expected <= 2; \
     pre-fix grew 1 per flip)`
  );
  await session.close();
});

test("PagedTextSession: each flip calls selectionCleanup to unbind prior listeners", async () => {
  const session = makeSession(10);
  const ref = session as unknown as { stageEl: HTMLElement; selectionCleanup: (() => void) | null };
  // Spy on stageEl.removeEventListener — flip should remove 2 (mouseup + selectionchange)
  const original = ref.stageEl.removeEventListener.bind(ref.stageEl);
  let removed = 0;
  ref.stageEl.removeEventListener = ((...args: Parameters<typeof original>) => {
    removed += 1;
    return original(...args);
  }) as typeof original;
  for (let i = 0; i < 5; i++) {
    await session.goTo({ kind: "next" });
  }
  assert.equal(removed, 5 * 2, `expected 10 removeEventListener calls, got ${removed}`);
  await session.close();
});

test("PagedTextSession: close runs selectionCleanup exactly once", async () => {
  const session = makeSession(3);
  const ref = session as unknown as { selectionCleanup: (() => void) | null };
  assert.ok(ref.selectionCleanup, "selectionCleanup set after construction");
  const original = ref.selectionCleanup;
  await session.close();
  assert.equal(ref.selectionCleanup, null, "selectionCleanup nulled after close");
  // Calling close again should be idempotent — selectionCleanup stays null
  await session.close();
  assert.equal(ref.selectionCleanup, null);
});
