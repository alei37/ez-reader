import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  parsePDFSubpath,
  paramsToSubpath,
  selectionToSubpath
} from "../../src/core/pdf/subpath";
import { toSingleLine } from "../../src/core/pdf/text-utils";

test("parsePDFSubpath: page only", () => {
  const parsed = parsePDFSubpath("#page=42");
  assert.deepEqual(parsed, { type: "page", page: 42 });
});

test("parsePDFSubpath: selection 4-tuple", () => {
  const parsed = parsePDFSubpath("#page=1&selection=4,0,5,20&color=yellow");
  assert.deepEqual(parsed, {
    type: "selection",
    page: 1,
    beginIndex: 4,
    beginOffset: 0,
    endIndex: 5,
    endOffset: 20,
    color: "yellow"
  });
});

test("parsePDFSubpath: annotation", () => {
  const parsed = parsePDFSubpath("#page=3&annotation=abc-123");
  assert.deepEqual(parsed, { type: "annotation", page: 3, annotation: "abc-123" });
});

test("parsePDFSubpath: invalid input", () => {
  assert.equal(parsePDFSubpath(""), null);
  assert.equal(parsePDFSubpath("#selection=4,0,5,20"), null);
  assert.equal(parsePDFSubpath("#page=abc"), null);
});

test("paramsToSubpath round-trip", () => {
  const sub = paramsToSubpath({ page: 5, selection: "4,0,5,20" });
  assert.equal(sub, "#page=5&selection=4%2C0%2C5%2C20");
  // decode %2C → ","
  const decoded = decodeURIComponent(sub.slice(1)).split("&").map((p) => p.split("="));
  assert.deepEqual(decoded[0], ["page", "5"]);
  assert.deepEqual(decoded[1], ["selection", "4,0,5,20"]);
});

test("selectionToSubpath includes color only when provided", () => {
  assert.equal(
    selectionToSubpath(1, 4, 0, 5, 20),
    "#page=1&selection=4%2C0%2C5%2C20"
  );
  assert.equal(
    selectionToSubpath(1, 4, 0, 5, 20, "yellow"),
    "#page=1&selection=4%2C0%2C5%2C20&color=yellow"
  );
});

test("toSingleLine collapses whitespace and full-width spaces", () => {
  assert.equal(toSingleLine("foo\nbar"), "foo bar");
  assert.equal(toSingleLine("foo\u3000bar"), "foo bar");
  assert.equal(toSingleLine("foo   bar\t\tbaz"), "foo bar baz");
  assert.equal(toSingleLine("  hello  "), "hello");
});
