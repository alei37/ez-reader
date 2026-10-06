import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  parseFrontmatter,
  serializeBookInfo,
  bookInfoFromFrontmatter,
  formatReadingTime
} from "../../src/adapters/obsidian/frontmatter";
import { defaultBookInfo } from "../../src/core/entities/BookInfo";
import type { BookInfo } from "../../src/core/entities/BookInfo";

/**
 * Build a complete BookInfo with defaults the tests can override.
 *
 * Using `defaultBookInfo` keeps field ordering stable when comparing
 * round-tripped frontmatter; tests that exercise serializer edge cases
 * (missing optional fields, special-character strings) override.
 */
const makeBookInfo = (overrides: Partial<BookInfo> = {}): BookInfo => {
  const base = defaultBookInfo({
    bookId: "book-test",
    format: "epub",
    filePath: "books/test.epub",
    fileSizeBytes: 1024,
    fileModifiedAt: 1_700_000_000_000,
    addedToLibraryAt: 1_700_000_000_000,
    title: "测试书籍"
  });
  return { ...base, ...overrides };
};

// ===========================================================================
// parseFrontmatter
// ===========================================================================

test("parseFrontmatter: normal --- ... --- with body", () => {
  const raw = `---
title: Hello
schemaVersion: 1
---
# body content`;
  const result = parseFrontmatter(raw);
  assert.ok(result, "should parse");
  assert.equal(result.values.get("title"), "Hello");
  assert.equal(result.values.get("schemaVersion"), 1);
  assert.equal(result.body, "# body content");
  assert.deepEqual(result.keys, ["title", "schemaVersion"]);
});

test("parseFrontmatter: missing opening --- returns null", () => {
  const raw = `title: Hello
---
body`;
  assert.equal(parseFrontmatter(raw), null);
});

test("parseFrontmatter: missing closing --- returns null", () => {
  const raw = `---
title: Hello
still going`;
  assert.equal(parseFrontmatter(raw), null);
});

test("parseFrontmatter: empty frontmatter + body", () => {
  // 需要 opening `---` 后有空行,closing `---` 前有空行 — parser 用
  // `afterOpen.indexOf("\n---")` 定位 closing,所以 opening 跟 closing
  // 之间至少要有 1 个空行(或者 frontmatter 里有非空字段)。
  const raw = `---

---
just body`;
  const result = parseFrontmatter(raw);
  assert.ok(result, "should parse");
  assert.equal(result.body, "just body");
  assert.equal(result.keys.length, 0);
});

test("parseFrontmatter: multi-line array (authors)", () => {
  const raw = `---
title: Foo
authors:
  - Alice
  - Bob
  - Carol
---
`;
  const result = parseFrontmatter(raw);
  assert.ok(result);
  assert.deepEqual(result.values.get("authors"), ["Alice", "Bob", "Carol"]);
});

test("parseFrontmatter: inline array [a, b, c]", () => {
  const raw = `---
tags: [x, y, z]
---
`;
  const result = parseFrontmatter(raw);
  assert.ok(result);
  assert.deepEqual(result.values.get("tags"), ["x", "y", "z"]);
});

test("parseFrontmatter: string with special characters is quoted", () => {
  // 值包含 # 跟冒号 — 必须被 quote 才能 round-trip
  const raw = `---
title: "Title: with #hash"
note: "line1\\nline2"
---
`;
  const result = parseFrontmatter(raw);
  assert.ok(result);
  assert.equal(result.values.get("title"), "Title: with #hash");
  // \n 在 quoted string 里被解释成真换行
  assert.equal(result.values.get("note"), "line1\nline2");
});

test("parseFrontmatter: comment lines (#) are skipped", () => {
  const raw = `---
# this is a comment
title: Hello
# another comment
schemaVersion: 1
---
`;
  const result = parseFrontmatter(raw);
  assert.ok(result);
  assert.deepEqual(result.keys, ["title", "schemaVersion"]);
  assert.equal(result.values.get("title"), "Hello");
});

test("parseFrontmatter: number / boolean / null scalars", () => {
  const raw = `---
totalReadingMs: 3600000
favorite: true
archived: false
lastOpenedAt: null
---
`;
  const result = parseFrontmatter(raw);
  assert.ok(result);
  assert.equal(result.values.get("totalReadingMs"), 3600000);
  assert.equal(result.values.get("favorite"), true);
  assert.equal(result.values.get("archived"), false);
  assert.equal(result.values.get("lastOpenedAt"), null);
});

test("parseFrontmatter: lastOpenedAt: null stays null", () => {
  const raw = `---
lastOpenedAt: null
---
`;
  const result = parseFrontmatter(raw);
  assert.ok(result);
  assert.equal(result.values.get("lastOpenedAt"), null);
});

test("parseFrontmatter: handles CRLF line endings", () => {
  const raw = "---\r\ntitle: Hello\r\n---\r\nbody";
  const result = parseFrontmatter(raw);
  assert.ok(result, "should parse despite CRLF");
  assert.equal(result.values.get("title"), "Hello");
  assert.equal(result.body, "body");
});

// ===========================================================================
// serializeBookInfo
// ===========================================================================

test("serializeBookInfo: full BookInfo → standard YAML frontmatter", () => {
  const info = makeBookInfo({
    title: "完整的书",
    authors: ["Alice", "Bob"],
    publisher: "Publisher Inc",
    published: "2023-01-01",
    language: "zh-CN",
    pageCount: 300,
    description: "description text",
    totalReadingMs: 3_600_000,
    excerptCount: 5,
    bookmarkCount: 2,
    thoughtCount: 3,
    favorite: true
  });
  const out = serializeBookInfo(info, "");
  assert.match(out, /^---\n/, "starts with ---");
  // CJK 字符不需要 quoting — 不在 YAML 特殊字符集合里
  assert.match(out, /title: 完整的书/, "title not quoted (CJK chars are safe)");
  assert.match(out, /authors:\n  - Alice\n  - Bob/, "multi-line authors");
  assert.match(out, /publisher: Publisher Inc/);
  // 日期 2023-01-01 不触发 quote 规则 (不像数字/bool/nodo 特列)
  assert.match(out, /published: 2023-01-01/, "date not quoted (no special chars)");
  assert.match(out, /language: zh-CN/);
  assert.match(out, /pageCount: 300/);
  assert.match(out, /favorite: true/);
  // 两次 ---: opening + closing
  const closeCount = (out.match(/^---$/mg) || []).length;
  assert.ok(closeCount >= 2, "frontmatter delimiters exist");
});

test("serializeBookInfo: missing optional fields are not written", () => {
  const info = makeBookInfo(); // no publisher / published / isbn / pageCount / description
  const out = serializeBookInfo(info, "");
  assert.doesNotMatch(out, /publisher:/, "publisher omitted");
  assert.doesNotMatch(out, /^published:/m, "published omitted");
  assert.doesNotMatch(out, /isbn:/, "isbn omitted");
  assert.doesNotMatch(out, /pageCount:/, "pageCount omitted");
  assert.doesNotMatch(out, /description:/, "description omitted");
  assert.doesNotMatch(out, /language:/, "language omitted");
});

test("serializeBookInfo: empty authors array writes []", () => {
  const info = makeBookInfo({ authors: [] });
  const out = serializeBookInfo(info, "");
  assert.match(out, /authors:\n {2}\[\]/, "authors: \\n  []");
});

test("serializeBookInfo: default body contains title", () => {
  const info = makeBookInfo({ title: "My Book" });
  const out = serializeBookInfo(info);
  assert.match(out, /# My Book/, "default body has title heading");
  assert.match(out, /由 EzReader 自动维护/, "default body has ez-reader notice");
});

test("serializeBookInfo: custom body overrides default", () => {
  const info = makeBookInfo({ title: "Anything" });
  const out = serializeBookInfo(info, "CUSTOM BODY CONTENT");
  assert.match(out, /CUSTOM BODY CONTENT/, "custom body used");
  assert.doesNotMatch(out, /由 EzReader 自动维护/, "default body NOT used");
});

test("serializeBookInfo: special characters are quoted", () => {
  const info = makeBookInfo({
    title: 'Title: with #hash and "quotes"',
    description: "line1\nline2\twith tab"
  });
  const out = serializeBookInfo(info, "");
  // # 强制 quoting; 内部 " 被转义成 \"
  assert.ok(
    out.includes('title: "Title: with #hash and \\"quotes'),
    `title should be escaped+quoted; got: ${out.split("\n").find((l) => l.startsWith("title:"))}`
  );
  // 真换行变成 \n
  assert.ok(out.includes("\\n"), "newline escaped in quoted string");
  // 真 tab 变成 \t
  assert.ok(out.includes("\\t"), "tab escaped in quoted string");
});

test("serializeBookInfo: null lastOpenedAt / pinnedAt / coverPath write null", () => {
  const info = makeBookInfo({
    lastOpenedAt: null,
    pinnedAt: null,
    coverPath: null
  });
  const out = serializeBookInfo(info, "");
  assert.match(out, /lastOpenedAt: null/);
  assert.match(out, /pinnedAt: null/);
  assert.match(out, /coverPath: null/);
});

test("serializeBookInfo: coverPath string is written", () => {
  const info = makeBookInfo({ coverPath: "app://abc/cover.jpg" });
  const out = serializeBookInfo(info, "");
  assert.match(out, /coverPath: app:\/\/abc\/cover\.jpg/);
});

// ===========================================================================
// bookInfoFromFrontmatter
// ===========================================================================

test("bookInfoFromFrontmatter: full frontmatter → full BookInfo (round-trip)", () => {
  const original = makeBookInfo({
    title: "完整的书",
    authors: ["Alice", "Bob"],
    publisher: "Publisher Inc",
    published: "2023-01-01",
    language: "zh-CN",
    pageCount: 300,
    description: "description text",
    totalReadingMs: 3_600_000,
    excerptCount: 5,
    bookmarkCount: 2,
    thoughtCount: 3,
    favorite: true,
    lastOpenedAt: 1_700_000_000_000,
    pinnedAt: 1_700_000_000_500,
    coverPath: "app://abc/cover.jpg"
  });
  const serialized = serializeBookInfo(original, "");
  const fm = parseFrontmatter(serialized);
  assert.ok(fm);
  const restored = bookInfoFromFrontmatter(fm, original);
  assert.equal(restored.title, original.title);
  assert.deepEqual([...restored.authors], [...original.authors]);
  assert.equal(restored.publisher, original.publisher);
  assert.equal(restored.published, original.published);
  assert.equal(restored.language, original.language);
  assert.equal(restored.pageCount, original.pageCount);
  assert.equal(restored.description, original.description);
  assert.equal(restored.totalReadingMs, original.totalReadingMs);
  assert.equal(restored.excerptCount, original.excerptCount);
  assert.equal(restored.bookmarkCount, original.bookmarkCount);
  assert.equal(restored.thoughtCount, original.thoughtCount);
  assert.equal(restored.favorite, original.favorite);
  assert.equal(restored.lastOpenedAt, original.lastOpenedAt);
  assert.equal(restored.pinnedAt, original.pinnedAt);
  assert.equal(restored.coverPath, original.coverPath);
});

test("bookInfoFromFrontmatter: missing fields fall back to defaults", () => {
  const raw = `---
schemaVersion: 1
title: Minimal
authors:
  []
bookId: foo
format: epub
filePath: foo.epub
fileSizeBytes: 1024
fileModifiedAt: 1
addedToLibraryAt: 2
lastOpenedAt: null
status: unread
progressFraction: 0
totalReadingMs: 0
excerptCount: 0
bookmarkCount: 0
thoughtCount: 0
favorite: false
pinnedAt: null
coverPath: null
updatedAt: 3
---
`;
  const fm = parseFrontmatter(raw);
  assert.ok(fm);
  const defaults = makeBookInfo({ title: "DEFAULT-TITLE" });
  const info = bookInfoFromFrontmatter(fm, defaults);
  // 必需字段保留 — defaults 提供 fallback
  assert.equal(info.title, "Minimal", "title from frontmatter");
  // 没 publisher/published/language/isbn/pageCount/description → undefined
  assert.equal(info.publisher, undefined);
  assert.equal(info.published, undefined);
  assert.equal(info.language, undefined);
  assert.equal(info.isbn, undefined);
  assert.equal(info.pageCount, undefined);
  assert.equal(info.description, undefined);
  // bookId 来自 frontmatter, 不是 defaults
  assert.equal(info.bookId, "foo");
});

test("bookInfoFromFrontmatter: invalid status falls back to default", () => {
  const raw = `---
schemaVersion: 1
title: T
authors: []
bookId: b
format: pdf
filePath: b.pdf
fileSizeBytes: 1
fileModifiedAt: 1
addedToLibraryAt: 1
lastOpenedAt: null
status: NOT_A_VALID_STATUS
progressFraction: 0
totalReadingMs: 0
excerptCount: 0
bookmarkCount: 0
thoughtCount: 0
favorite: false
pinnedAt: null
coverPath: null
updatedAt: 1
---
`;
  const fm = parseFrontmatter(raw);
  assert.ok(fm);
  const defaults = makeBookInfo({ status: "reading" });
  const info = bookInfoFromFrontmatter(fm, defaults);
  assert.equal(info.status, "reading", "invalid status falls back to default");
});

test("bookInfoFromFrontmatter: null fields handled correctly", () => {
  const raw = `---
schemaVersion: 1
title: T
authors: []
bookId: b
format: pdf
filePath: b.pdf
fileSizeBytes: 1
fileModifiedAt: 1
addedToLibraryAt: 1
lastOpenedAt: null
status: unread
progressFraction: 0
totalReadingMs: 0
excerptCount: 0
bookmarkCount: 0
thoughtCount: 0
favorite: false
pinnedAt: null
coverPath: null
updatedAt: 1
---
`;
  const fm = parseFrontmatter(raw);
  assert.ok(fm);
  const info = bookInfoFromFrontmatter(fm, makeBookInfo());
  assert.equal(info.lastOpenedAt, null, "lastOpenedAt stays null");
  assert.equal(info.pinnedAt, null, "pinnedAt stays null");
  assert.equal(info.coverPath, null, "coverPath stays null");
});

test("bookInfoFromFrontmatter: valid statuses pass through", () => {
  for (const status of ["unread", "reading", "finished", "abandoned"] as const) {
    const raw = `---
schemaVersion: 1
title: T
authors: []
bookId: b
format: epub
filePath: b.epub
fileSizeBytes: 1
fileModifiedAt: 1
addedToLibraryAt: 1
lastOpenedAt: null
status: ${status}
progressFraction: 0
totalReadingMs: 0
excerptCount: 0
bookmarkCount: 0
thoughtCount: 0
favorite: false
pinnedAt: null
coverPath: null
updatedAt: 1
---
`;
    const fm = parseFrontmatter(raw);
    assert.ok(fm);
    const info = bookInfoFromFrontmatter(fm, makeBookInfo());
    assert.equal(info.status, status);
  }
});

// ===========================================================================
// formatReadingTime
// ===========================================================================

test("formatReadingTime: 0ms → '0 分钟'", () => {
  assert.equal(formatReadingTime(0), "0 分钟");
});

test("formatReadingTime: 60s (60000ms) → '1 分钟'", () => {
  assert.equal(formatReadingTime(60_000), "1 分钟");
});

test("formatReadingTime: 30 minutes → '30 分钟'", () => {
  assert.equal(formatReadingTime(30 * 60_000), "30 分钟");
});

test("formatReadingTime: 1 hour → '1 小时'", () => {
  assert.equal(formatReadingTime(60 * 60_000), "1 小时");
});

test("formatReadingTime: 1h 30min → '1 小时 30 分钟'", () => {
  assert.equal(formatReadingTime(90 * 60_000), "1 小时 30 分钟");
});

test("formatReadingTime: 25 hours → '25 小时'", () => {
  assert.equal(formatReadingTime(25 * 60 * 60_000), "25 小时");
});

test("formatReadingTime: 2h 30min → '2 小时 30 分钟'", () => {
  assert.equal(formatReadingTime(2 * 60 * 60_000 + 30 * 60_000), "2 小时 30 分钟");
});

test("formatReadingTime: sub-minute rounds down to '0 分钟'", () => {
  // 30s 不到 1 分钟 → 0 分钟
  assert.equal(formatReadingTime(30_000), "0 分钟");
});