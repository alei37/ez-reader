/**
 * Originally from RyotaUshio/obsidian-pdf-plus (MIT License)
 * Copyright (c) 2023 Ryota Ushio
 * https://github.com/RyotaUshio/obsidian-pdf-plus
 * Modified for ez-reader.
 *
 * Text utilities for joining / collapsing selected text while
 * preserving the visual layout. `toSingleLine` collapses internal newlines
 * and double-spaces so multi-line PDF selections round-trip into one
 * searchable string, with CJK-friendly whitespace handling.
 */

export const toSingleLine = (str: string): string =>
  str
    .replace(/[\r\n]+/g, " ")
    .replace(/\u3000/g, " ")  // 全角空格 → 半角
    .replace(/[ \t]+/g, " ")
    .trim();

/**
 * Split a 4-tuple selection range into per-line fragments so we can
 * render a highlight that follows the line breaks of the original page.
 * Each fragment is `{ beginIndex, beginOffset, endIndex, endOffset }`
 * within a single text content item, or `{ beginIndex, endIndex }`
 * spanning whole items on a single line.
 */
export interface SelectionFragment {
  readonly beginIndex: number;
  readonly beginOffset: number;
  readonly endIndex: number;
  readonly endOffset: number;
}

export const splitSelectionByItems = (
  beginIndex: number,
  beginOffset: number,
  endIndex: number,
  endOffset: number
): SelectionFragment[] => {
  if (beginIndex === endIndex) {
    return [{ beginIndex, beginOffset, endIndex, endOffset }];
  }
  const fragments: SelectionFragment[] = [];
  // First fragment: from beginOffset to end of beginIndex item
  fragments.push({
    beginIndex,
    beginOffset,
    endIndex: beginIndex,
    endOffset: Number.MAX_SAFE_INTEGER // sentinel; clamped at the call site
  });
  // Middle items: fully covered
  for (let i = beginIndex + 1; i < endIndex; i++) {
    fragments.push({
      beginIndex: i,
      beginOffset: 0,
      endIndex: i,
      endOffset: Number.MAX_SAFE_INTEGER
    });
  }
  // Last fragment: from start of endIndex item to endOffset
  fragments.push({
    beginIndex: endIndex,
    beginOffset: 0,
    endIndex,
    endOffset
  });
  return fragments;
};
