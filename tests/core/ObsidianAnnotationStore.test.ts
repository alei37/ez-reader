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

// P2: 镜像 ObsidianAnnotationStore.sanitizeVisitedTocIdsMap. 验证它能
// 容忍旧/损坏 data.json (字段缺失 / 元素非 string / 整 entry 损坏).
const sanitizeVisitedTocIdsMap = (input: unknown): Record<string, ReadonlyArray<string>> => {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, ReadonlyArray<string>> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!Array.isArray(v)) continue;
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const id of v) {
      if (typeof id !== "string" || !id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (ids.length > 0) out[k] = ids;
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

// =========================================================
// P2: sanitizeVisitedTocIdsMap — 兼容旧 data.json / 容忍损坏数据
// =========================================================

test("sanitizeVisitedTocIdsMap: 旧 data.json 没字段 → 空对象", () => {
  // load() 永远走这个分支; 测试 raw 输入 null / undefined / 缺失字段都能 fallback.
  assert.deepEqual(sanitizeVisitedTocIdsMap(undefined), {});
  assert.deepEqual(sanitizeVisitedTocIdsMap(null), {});
  assert.deepEqual(sanitizeVisitedTocIdsMap("not-an-object"), {});
  assert.deepEqual(sanitizeVisitedTocIdsMap([]), {});
});

test("sanitizeVisitedTocIdsMap: 保留合法 string id 数组, 过滤非 string 元素", () => {
  const mixed = {
    "book1.epub": ["toc-0", "toc-3", "toc-7"],
    "book2.epub": ["toc-1", 42, null, "toc-2", undefined, ""],
    // 重复 id 也不应保留
    "book3.epub": ["toc-1", "toc-1", "toc-2"]
  };
  const out = sanitizeVisitedTocIdsMap(mixed);
  assert.deepEqual(out["book1.epub"], ["toc-0", "toc-3", "toc-7"]);
  assert.deepEqual(out["book2.epub"], ["toc-1", "toc-2"]);
  assert.deepEqual(out["book3.epub"], ["toc-1", "toc-2"]);
});

test("sanitizeVisitedTocIdsMap: 整 entry 损坏 (value 不是 array) → 丢", () => {
  const mixed = {
    "book-ok.epub": ["toc-1"],
    "book-bad1.epub": null,
    "book-bad2.epub": { not: "an array" },
    "book-bad3.epub": "string-value"
  };
  const out = sanitizeVisitedTocIdsMap(mixed);
  assert.ok("book-ok.epub" in out, "合法 entry 保留");
  assert.ok(!("book-bad1.epub" in out), "null value 丢");
  assert.ok(!("book-bad2.epub" in out), "object value 丢");
  assert.ok(!("book-bad3.epub" in out), "string value 丢");
});

test("sanitizeVisitedTocIdsMap: 全空数组的 entry 丢 (避免噪音)", () => {
  // [null, undefined, ""] 过滤后是 [], 应该整个 entry 不写.
  const out = sanitizeVisitedTocIdsMap({ "book-empty.epub": [null, undefined, ""] });
  assert.equal(Object.keys(out).length, 0);
});
