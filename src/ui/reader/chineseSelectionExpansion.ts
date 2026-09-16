/**
 * Chinese selection expansion — pure logic. Takes the raw selected text
 * and surrounding context, returns either the original text (no
 * expansion needed) or an expanded slice of `context`.
 *
 * Why this exists: browsers without CJK word segmentation (most desktop
 * browsers, Chrome on Android) treat Chinese as a string of single
 * characters. When the user drags over a phrase, they end up with one
 * character selected, which makes "想法" / "摘录" useless. We expand
 * to the nearest stop character so the resulting selection is a
 * semantically meaningful unit.
 */

export interface ExpansionOptions {
  /** Min length below which we consider expansion. Default 12. */
  readonly minLength?: number;
  /** Window size for searching stop chars, in characters. Default 120. */
  readonly window?: number;
}

const STOP_CHARS = ["。", "！", "？", "!", "?", ";", "；", ",", "，", "\n"];

/**
 * Decide whether the selection should be expanded.
 * Pure — caller passes in the surrounding context text.
 */
export const shouldExpand = (raw: string): boolean => {
  const minLength = 12; // mirrors minLength default
  if (raw.length >= minLength) return false;
  // CJK 字符比例 > 0 才认为需要扩展. 否则用户故意选了拉丁单词.
  return Array.from(raw).some((ch) => /[\u3400-\u9fff\uf900-\ufaff]/.test(ch));
};

/**
 * Walk `context` to find the position of `raw` and expand it left/right
 * to the nearest stop character. If raw isn't found, or there's no
 * stop char in either direction, return the original raw.
 *
 * Stop chars are sentence / clause boundaries. We drop the LEFT stop
 * (the boundary we came from) but KEEP the RIGHT stop (the boundary
 * we're heading towards) so the user can see where the selection ends.
 *
 * @param raw Selected text (the substring to find inside `context`)
 * @param context Surrounding text (typically the parent text node)
 * @param options Tunables
 */
export const expandToBoundary = (
  raw: string,
  context: string,
  options: ExpansionOptions = {}
): string => {
  if (!shouldExpand(raw)) return raw;
  const window = options.window ?? 120;
  const idx = context.indexOf(raw);
  if (idx < 0) return raw;
  const windowStart = Math.max(0, idx - window);
  const before = context.slice(windowStart, idx);
  const after = context.slice(idx + raw.length, Math.min(context.length, idx + raw.length + window));

  const leftStop = lastStop(before); // rightmost in `before`
  const rightStop = firstStop(after); // leftmost in `after`

  if (leftStop < 0 && rightStop < 0) return raw;

  // Expand left from one char past the stop (so we drop the boundary).
  const leftExpanded = leftStop >= 0
    ? before.slice(leftStop + 1)
    : "";
  // Expand right to include the stop char (so the boundary is visible).
  const rightExpanded = rightStop >= 0
    ? after.slice(0, rightStop + 1)
    : "";

  return (leftExpanded + raw + rightExpanded).trim();
};

const lastStop = (s: string): number => {
  let best = -1;
  for (const stop of STOP_CHARS) {
    const i = s.lastIndexOf(stop);
    if (i > best) best = i;
  }
  return best;
};

const firstStop = (s: string): number => {
  let best = -1;
  let found = -1;
  for (const stop of STOP_CHARS) {
    const i = s.indexOf(stop);
    if (i >= 0 && (found < 0 || i < found)) {
      found = i;
      best = i;
    }
  }
  return best;
};

/**
 * Helper for callers that want a length cap (the original inline version
 * capped at 100 chars to avoid eating the entire paragraph). Returns
 * `raw` unchanged if the expanded length exceeds the cap.
 */
export const expandWithCap = (
  raw: string,
  context: string,
  cap: number,
  options: ExpansionOptions = {}
): string => {
  const expanded = expandToBoundary(raw, context, options);
  const trimmed = expanded.trim();
  if (trimmed.length > cap || trimmed.length <= raw.length) return raw;
  return trimmed;
};