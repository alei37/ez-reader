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
