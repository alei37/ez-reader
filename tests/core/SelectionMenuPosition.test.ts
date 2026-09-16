import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  computeSelectionMenuPosition,
  type ViewportSize
} from "../../src/ui/reader/selectionMenuPosition";

/**
 * Selection menu positioning algorithm — locks down behavior so future
 * changes don't silently regress UX.
 *
 * Pure function + DOMRect-shaped objects (duck-typed). No DOM, runs in Node.
 */

const rect = (x: number, y: number, w: number, h: number): DOMRect => ({
  left: x,
  top: y,
  right: x + w,
  bottom: y + h,
  width: w,
  height: h,
  x,
  y,
  toJSON: () => ({ x, y, w, h })
});

const VIEWPORT: ViewportSize = { width: 1400, height: 900 };
const MENU = rect(0, 0, 280, 40);

test("single-line selection in viewport middle → below + horizontally centered", () => {
  const sel = rect(560, 400, 280, 24);
  const pos = computeSelectionMenuPosition(sel, MENU, VIEWPORT);
  assert.equal(pos.placement, "below");
  // Menu horizontally centered: selection center 700 - menu half 140 = 560
  assert.equal(pos.left, 560);
  // Menu below selection bottom by gap=6: 400 + 24 + 6 = 430
  assert.equal(pos.top, 430);
});

test("multi-line selection (height > 28) → forced above, doesn't cover last line", () => {
  const sel = rect(560, 300, 280, 200);
  const pos = computeSelectionMenuPosition(sel, MENU, VIEWPORT);
  assert.equal(pos.placement, "above");
  // Menu top: 300 - 6 - 40 = 254
  assert.equal(pos.top, 254);
  // Centered
  assert.equal(pos.left, 560);
});

test("single-line selection near viewport bottom (no room below) → above", () => {
  const sel = rect(560, 860, 280, 24); // 16px from bottom, menu 40+gap 6=46 > 16
  const pos = computeSelectionMenuPosition(sel, MENU, VIEWPORT);
  assert.equal(pos.placement, "above");
  // 860 - 6 - 40 = 814
  assert.equal(pos.top, 814);
});

test("single-line selection near viewport top (no room above) → below", () => {
  const sel = rect(560, 4, 280, 24); // 4px from top, above would be -42
  const pos = computeSelectionMenuPosition(sel, MENU, VIEWPORT);
  assert.equal(pos.placement, "below");
  assert.ok(pos.top >= 0, `top should not be negative: ${pos.top}`);
});

test("selection extends past right edge → menu stays within viewport", () => {
  const sel = rect(1100, 400, 280, 24);
  const pos = computeSelectionMenuPosition(sel, MENU, VIEWPORT);
  // Centered value: 1100 + 140 - 140 = 1100
  // Right edge: 1100 + 280 = 1380, 20px from right margin, OK
  assert.equal(pos.left, 1100);
  assert.ok(pos.left + MENU.width <= VIEWPORT.width, "menu must fit in viewport");
});

test("selection extends past right edge badly → menu hugs right margin", () => {
  const sel = rect(1300, 400, 200, 24); // right edge 1500, 100px past viewport
  const pos = computeSelectionMenuPosition(sel, MENU, VIEWPORT);
  // Expected: menu right edge touches viewport.margin
  // viewport 1400 - 8 - 280 = 1112
  assert.equal(pos.left, 1112);
});

test("selection extends past left edge badly → menu hugs left margin", () => {
  const sel = rect(-100, 400, 200, 24); // left -100, centered value would be -140
  const pos = computeSelectionMenuPosition(sel, MENU, VIEWPORT);
  assert.equal(pos.left, 8);
});

test("menu wider than viewport → still pinned to left margin (no negative)", () => {
  const giantMenu = rect(0, 0, 1500, 40); // 1500 > viewport 1400
  const sel = rect(700, 400, 200, 24);
  const pos = computeSelectionMenuPosition(sel, giantMenu, VIEWPORT);
  assert.equal(pos.left, 8);
});

test("default options: margin=8 / gap=6 / singleLineMaxHeight=28", () => {
  const sel = rect(560, 400, 280, 24);
  const def = computeSelectionMenuPosition(sel, MENU, VIEWPORT);
  const explicit = computeSelectionMenuPosition(sel, MENU, VIEWPORT, {
    margin: 8,
    gap: 6,
    singleLineMaxHeight: 28
  });
  assert.deepEqual(def, explicit);
});

test("singleLineMaxHeight tunable: raising threshold expands single-line category", () => {
  const sel = rect(560, 400, 280, 60); // 60px high
  // Default 28 → multi-line → above
  assert.equal(computeSelectionMenuPosition(sel, MENU, VIEWPORT).placement, "above");
  // Set to 100 → single-line → default branch
  // Room below (430 + 46 = 476 < 900), so below
  assert.equal(
    computeSelectionMenuPosition(sel, MENU, VIEWPORT, { singleLineMaxHeight: 100 }).placement,
    "below"
  );
});

test("centered column scenario: 700px column in 1400px viewport, selection on right side", () => {
  // Column from 350 to 1050, selection at 800-900 (column right half)
  const sel = rect(800, 400, 100, 24);
  const pos = computeSelectionMenuPosition(sel, MENU, VIEWPORT);
  // Selection center 850 - 140 = 710
  assert.equal(pos.left, 710);
  // Previous left-anchor implementation gave left=800 (column left edge).
  // Now 710 is closer to selection center, less visual jump for the user.
});