import { test } from "node:test";
import { strict as assert } from "node:assert";

/**
 * Mirror of ObsidianAnnotationStore's sanitize helpers. We re-implement
 * them here to keep the unit test independent of the obsidian runtime
 * (the real class imports Plugin from obsidian at module top, which
 * JSDOM cannot satisfy).
 */
const sanitizeStringArray = (input: unknown): string[] => {
  return Array.isArray(input) ? input.filter((x): x is string => typeof x === "string") : [];
};

const sanitizeReadingArray = (input: unknown): unknown[] => {
  if (!Array.isArray(input)) return [];
  return input.filter((x) => {
    if (!x || typeof x !== "object") return false;
    const r = x as { bookId?: unknown; status?: unknown };
    return typeof r.bookId === "string" && (
      r.status === "unread" || r.status === "reading" ||
      r.status === "finished" || r.status === "abandoned"
    );
  });
};

const sanitizeExcerptArray = (input: unknown): unknown[] => {
  if (!Array.isArray(input)) return [];
  return input.filter((x) => {
    if (!x || typeof x !== "object") return false;
    const e = x as { id?: unknown; bookId?: unknown; text?: unknown; locator?: unknown };
    return typeof e.id === "string" && typeof e.bookId === "string" &&
      typeof e.text === "string" && e.locator !== null && typeof e.locator === "object";
  });
};

const sanitizeRecord = (input: unknown): Record<string, string> => {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
};

test("sanitizeStringArray: drops non-strings, accepts empty", () => {
  assert.deepEqual(sanitizeStringArray(["a", 1, "b", null, undefined, "c"]), ["a", "b", "c"]);
  assert.deepEqual(sanitizeStringArray([]), []);
  assert.deepEqual(sanitizeStringArray(null), []);
  assert.deepEqual(sanitizeStringArray("not-an-array"), []);
});

test("sanitizeReadingArray: requires bookId + valid status", () => {
  const mixed = [
    { bookId: "a", status: "reading", position: { kind: "reflow", fraction: 0.5 } },
    { bookId: "b", status: "bogus" },  // drop
    { status: "reading" },                // drop (no bookId)
    "string-entry",                       // drop
    null,                                 // drop
    { bookId: "c", status: "finished" }  // accept
  ];
  const result = sanitizeReadingArray(mixed);
  assert.equal(result.length, 2);
  assert.deepEqual((result[0] as { bookId: string }).bookId, "a");
  assert.deepEqual((result[1] as { bookId: string }).bookId, "c");
});

test("sanitizeExcerptArray: requires id + bookId + text + locator", () => {
  const mixed = [
    { id: "x1", bookId: "a", text: "hello", locator: { position: { kind: "pdf", page: 1 } } },
    { id: "x2", bookId: "a", text: "no-locator" },          // drop
    { bookId: "a", text: "no-id", locator: {} },            // drop
    { id: "x3", bookId: "a", text: "ok", locator: null },    // drop
    { id: "x4", bookId: "a", text: "ok", locator: { position: {} } } // accept
  ];
  const result = sanitizeExcerptArray(mixed);
  assert.equal(result.length, 2);
  assert.deepEqual((result[0] as { id: string }).id, "x1");
  assert.deepEqual((result[1] as { id: string }).id, "x4");
});

test("sanitizeRecord: drops non-string values", () => {
  const mixed = { a: "ok", b: 42, c: null, d: "also-ok", e: { nested: "no" } };
  assert.deepEqual(sanitizeRecord(mixed), { a: "ok", d: "also-ok" });
  assert.deepEqual(sanitizeRecord(null), {});
  assert.deepEqual(sanitizeRecord("not-an-object"), {});
});
