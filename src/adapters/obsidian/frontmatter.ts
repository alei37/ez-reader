/**
 * Minimal YAML frontmatter (de)serializer.
 *
 * We hand-roll a subset instead of pulling in js-yaml / yaml packages
 * because:
 *  - The shape we emit is fixed and narrow (BookInfo + a handful of
 *    ReadingTime entries in body markdown); a full YAML parser is overkill.
 *  - Zero deps means zero patch surface, faster build, smaller bundle.
 *  - The output is user-facing (info.md lives in their vault) so we
 *    control the formatting: stable key order, 2-space indent, no
 *    quoting strings unless strictly required.
 *
 * Limitations (intentional):
 *  - Only supports the subset BookInfo uses: strings, numbers, booleans,
 *    string arrays, null. No nested objects, no flow style, no anchors.
 *  - Round-trip is lossy on comments and key order in the body markdown
 *    (we only emit keys we know about; user-added frontmatter fields are
 *    preserved by `parseFrontmatter` but dropped on the next `writeFrontmatter`).
 *  - String values containing `:` or `#` are auto-quoted to keep them
 *    parseable on the next read.
 */

import type { BookInfo } from "../../core/entities/BookInfo";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FrontmatterValue = string | number | boolean | null | ReadonlyArray<string>;

export interface ParsedFrontmatter {
  /** Field order, preserved for stable round-trips. */
  readonly keys: ReadonlyArray<string>;
  /** Decoded values. Missing keys → use defaults. */
  readonly values: ReadonlyMap<string, FrontmatterValue>;
  /** Body text after the closing `---`. May be empty. */
  readonly body: string;
}

// ---------------------------------------------------------------------------
// Quote / unquote helpers
// ---------------------------------------------------------------------------

/**
 * Quote a string if it contains YAML-significant characters or starts with
 * a reserved char. We default to no quotes for "obviously safe" strings
 * to keep the file human-readable.
 */
const needsQuoting = (s: string): boolean => {
  if (s.length === 0) return true;
  const first = s.charAt(0);
  if (first === "-" || first === "?" || first === ":" || first === "," ||
      first === "[" || first === "]" || first === "{" || first === "}" ||
      first === "&" || first === "*" || first === "!" || first === "|" ||
      first === ">" || first === "'" || first === "\"" || first === "%" ||
      first === "@" || first === "`" || first === "#") {
    return true;
  }
  // Anything that looks like a YAML literal (number / bool / null) needs quoting
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(s)) return true;
  if (/^(?:true|false|yes|no|on|off|null|~)$/i.test(s)) return true;
  // : followed by space, or # anywhere (comment marker)
  if (/(?:^|\s):\s/.test(s)) return true;
  if (s.includes("#")) return true;
  // P0 fix: 内部换行 / tab 也会让 round-trip 丢数据 — quoteString 已经
  // 处理了 \n/\t/\r 的转义,但 needsQuoting 必须先返回 true 才会调它.
  // 否则 description 含换行直接落到 YAML 跨行 scalar,换行丢失。
  if (s.includes("\n") || s.includes("\t") || s.includes("\r")) return true;
  // Leading/trailing whitespace
  if (s !== s.trim()) return true;
  return false;
};

const quoteString = (s: string): string => {
  // Use double-quoted style with backslash escapes for control chars.
  // Inner double-quotes are escaped; backslashes too.
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
};

const unquoteString = (s: string): string => {
  const trimmed = s.trim();
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed
      .slice(1, -1)
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    // Single-quoted YAML: only '' escapes to '. We don't emit this style
    // but tolerate it on read.
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
};

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

const formatValue = (value: FrontmatterValue, indent: string): string => {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "string") return needsQuoting(value) ? quoteString(value) : value;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => `${indent}- ${typeof item === "string" && needsQuoting(item) ? quoteString(item) : String(item)}`)
      .join("\n");
  }
  return "null";
};

/**
 * Serialize a `BookInfo` (subset) + body into a full info.md string.
 *
 * @param info  Full BookInfo. Caller is responsible for providing
 *              up-to-date values — this function doesn't read settings.
 * @param body  Markdown body that goes after the frontmatter. May be
 *              empty. Defaults to a short auto-generated stub.
 */
export const serializeBookInfo = (info: BookInfo, body?: string): string => {
  const lines: string[] = ["---"];
  // Field order matches the BookInfo interface for stable diffs.
  lines.push(`schemaVersion: ${info.schemaVersion}`);
  lines.push(`title: ${formatValue(info.title, "")}`);
  lines.push("authors:");
  if (info.authors.length === 0) {
    lines.push("  []");
  } else {
    for (const author of info.authors) {
      // P0 fix: 必须有 "- " 前缀,否则 YAML 解析成 multi-line scalar
      // 而非 array,round-trip 时 authors 直接丢光. formatValue 用空
      // indent,避免重复缩进 (跟 `formatValue([...], indent)` array 分支
      // 的 `${indent}- ...` 模板保持一致).
      lines.push(`  - ${formatValue(author, "")}`);
    }
  }
  if (info.publisher !== undefined) lines.push(`publisher: ${formatValue(info.publisher, "")}`);
  if (info.published !== undefined) lines.push(`published: ${formatValue(info.published, "")}`);
  if (info.language !== undefined) lines.push(`language: ${formatValue(info.language, "")}`);
  if (info.isbn !== undefined) lines.push(`isbn: ${formatValue(info.isbn, "")}`);
  if (info.pageCount !== undefined) lines.push(`pageCount: ${info.pageCount}`);
  if (info.description !== undefined) lines.push(`description: ${formatValue(info.description, "")}`);
  lines.push(`bookId: ${formatValue(info.bookId, "")}`);
  lines.push(`format: ${formatValue(info.format, "")}`);
  lines.push(`filePath: ${formatValue(info.filePath, "")}`);
  lines.push(`fileSizeBytes: ${info.fileSizeBytes}`);
  lines.push(`fileModifiedAt: ${info.fileModifiedAt}`);
  lines.push(`addedToLibraryAt: ${info.addedToLibraryAt}`);
  lines.push(`lastOpenedAt: ${info.lastOpenedAt === null ? "null" : String(info.lastOpenedAt)}`);
  lines.push(`status: ${formatValue(info.status, "")}`);
  lines.push(`progressFraction: ${info.progressFraction}`);
  lines.push(`totalReadingMs: ${info.totalReadingMs}`);
  lines.push(`excerptCount: ${info.excerptCount}`);
  lines.push(`bookmarkCount: ${info.bookmarkCount}`);
  lines.push(`thoughtCount: ${info.thoughtCount}`);
  lines.push(`favorite: ${info.favorite ? "true" : "false"}`);
  lines.push(`pinnedAt: ${info.pinnedAt === null ? "null" : String(info.pinnedAt)}`);
  lines.push(`coverPath: ${info.coverPath === null ? "null" : formatValue(info.coverPath, "")}`);
  lines.push(`updatedAt: ${info.updatedAt}`);
  lines.push("---");
  const finalBody = body ?? defaultBody(info);
  if (finalBody.length > 0) {
    lines.push("");
    lines.push(finalBody);
  }
  return lines.join("\n") + "\n";
};

const defaultBody = (info: BookInfo): string => {
  const lines: string[] = [];
  lines.push(`# ${info.title}`);
  lines.push("");
  lines.push("> 由 EzReader 自动维护。前置元数据由插件写入;")
  lines.push("> 详细阅读时长 session 明细见同目录的 `sessions.jsonl`,");
  lines.push("> 摘录 / 想法见同目录的 `notes.md`。");
  if (info.totalReadingMs > 0) {
    lines.push("");
    lines.push(`## 当前累计阅读时长: ${formatReadingTime(info.totalReadingMs)}`);
  }
  return lines.join("\n");
};

/**
 * Format milliseconds as a human-readable string. Mirrors the toolbar's
 * format ("2 小时 30 分钟") so the info.md body looks consistent.
 */
export const formatReadingTime = (totalMs: number): string => {
  const totalSeconds = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours} 小时 ${minutes} 分钟`;
  if (hours > 0) return `${hours} 小时`;
  if (minutes > 0) return `${minutes} 分钟`;
  return "0 分钟";
};

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Parse a frontmatter block + body. Returns `null` for malformed
 * frontmatter (missing `---` delimiters) so callers can fall back to
 * defaults without try/catch.
 */
export const parseFrontmatter = (raw: string): ParsedFrontmatter | null => {
  // Normalize line endings.
  const text = raw.replace(/\r\n?/g, "\n");
  if (!text.startsWith("---")) return null;
  // Find the closing `---` on its own line.
  const rest = text.slice(3);
  // Skip an optional newline immediately after the opening `---`.
  const afterOpen = rest.startsWith("\n") ? rest.slice(1) : rest;
  const closeIdx = afterOpen.indexOf("\n---");
  if (closeIdx === -1) return null;
  const frontmatterText = afterOpen.slice(0, closeIdx);
  // Skip the newline after the closing `---` if present, then the body is
  // whatever follows (may be empty).
  let bodyStart = closeIdx + 4; // skip \n---
  if (afterOpen.charAt(bodyStart) === "\n") bodyStart += 1;
  const body = afterOpen.slice(bodyStart);

  const keys: string[] = [];
  const values = new Map<string, FrontmatterValue>();
  const lines = frontmatterText.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Skip blank lines (rare in YAML frontmatter but tolerate).
    if (line.trim().length === 0) { i += 1; continue; }
    // Skip comments.
    if (line.trim().startsWith("#")) { i += 1; continue; }
    // Top-level key: `key: value` or `key:` on its own line followed by
    // array items (indented with spaces).
    const colonMatch = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:(.*)$/.exec(line);
    if (!colonMatch) { i += 1; continue; }
    const key = colonMatch[1];
    const rawValue = colonMatch[2];
    if (rawValue.trim().length === 0) {
      // Multi-line array (or just empty value).
      const arr: string[] = [];
      i += 1;
      while (i < lines.length) {
        const next = lines[i];
        const itemMatch = /^\s+-\s+(.*)$/.exec(next);
        if (!itemMatch) break;
        const item = unquoteString(itemMatch[1].trim());
        // Inline empty array `[]` (rare but tolerable).
        if (item !== "[]" && item !== "") arr.push(item);
        i += 1;
      }
      keys.push(key);
      values.set(key, arr);
      continue;
    }
    keys.push(key);
    values.set(key, parseScalar(rawValue));
    i += 1;
  }
  return { keys, values, body };
};

const parseScalar = (raw: string): FrontmatterValue => {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "~" || trimmed === "null") return null;
  if (trimmed === "true" || trimmed === "True" || trimmed === "TRUE") return true;
  if (trimmed === "false" || trimmed === "False" || trimmed === "FALSE") return false;
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  // Inline array `[a, b, c]` (rare in our output but tolerate).
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return inner.split(",").map((s) => unquoteString(s.trim()));
  }
  return unquoteString(trimmed);
};

// ---------------------------------------------------------------------------
// BookInfo helpers (build / patch from frontmatter)
// ---------------------------------------------------------------------------

/**
 * Convert a `ParsedFrontmatter` into a `BookInfo`, falling back to
 * `defaults` for any missing or wrong-typed fields. This is the inverse
 * of `serializeBookInfo` — together they let us round-trip info.md.
 *
 * Unknown keys in the frontmatter are ignored (we don't store them).
 */
export const bookInfoFromFrontmatter = (
  fm: ParsedFrontmatter,
  defaults: BookInfo
): BookInfo => {
  const v = (key: string): FrontmatterValue | undefined => fm.values.get(key);
  const stringOrUndef = (key: string): string | undefined => {
    const x = v(key);
    return typeof x === "string" ? x : undefined;
  };
  const numberOrUndef = (key: string): number | undefined => {
    const x = v(key);
    return typeof x === "number" && Number.isFinite(x) ? x : undefined;
  };
  const numberOrDefault = (key: string, fallback: number): number => numberOrUndef(key) ?? fallback;
  const stringArrayOrDefault = (key: string, fallback: ReadonlyArray<string>): ReadonlyArray<string> => {
    const x = v(key);
    return Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : fallback;
  };
  const booleanOrDefault = (key: string, fallback: boolean): boolean => {
    const x = v(key);
    return typeof x === "boolean" ? x : fallback;
  };
  const numberOrNull = (key: string): number | null => {
    const x = v(key);
    if (x === null || x === undefined) return null;
    return typeof x === "number" && Number.isFinite(x) ? x : null;
  };
  const statusValue = v("status");
  const validStatus = ["unread", "reading", "finished", "abandoned"] as const;
  const status = typeof statusValue === "string" && (validStatus as ReadonlyArray<string>).includes(statusValue)
    ? statusValue as BookInfo["status"]
    : defaults.status;

  return {
    schemaVersion: 1,
    title: stringOrUndef("title") ?? defaults.title,
    authors: stringArrayOrDefault("authors", defaults.authors),
    publisher: stringOrUndef("publisher"),
    published: stringOrUndef("published"),
    language: stringOrUndef("language") as BookInfo["language"],
    isbn: stringOrUndef("isbn"),
    pageCount: numberOrUndef("pageCount"),
    description: stringOrUndef("description"),
    bookId: stringOrUndef("bookId") ?? defaults.bookId,
    format: (stringOrUndef("format") as BookInfo["format"]) ?? defaults.format,
    filePath: stringOrUndef("filePath") ?? defaults.filePath,
    fileSizeBytes: numberOrDefault("fileSizeBytes", defaults.fileSizeBytes),
    fileModifiedAt: numberOrDefault("fileModifiedAt", defaults.fileModifiedAt),
    addedToLibraryAt: numberOrDefault("addedToLibraryAt", defaults.addedToLibraryAt),
    lastOpenedAt: numberOrNull("lastOpenedAt"),
    status,
    progressFraction: numberOrDefault("progressFraction", defaults.progressFraction),
    totalReadingMs: numberOrDefault("totalReadingMs", defaults.totalReadingMs),
    excerptCount: numberOrDefault("excerptCount", defaults.excerptCount),
    bookmarkCount: numberOrDefault("bookmarkCount", defaults.bookmarkCount),
    thoughtCount: numberOrDefault("thoughtCount", defaults.thoughtCount),
    favorite: booleanOrDefault("favorite", defaults.favorite),
    pinnedAt: numberOrNull("pinnedAt"),
    coverPath: stringOrUndef("coverPath") ?? null,
    updatedAt: numberOrDefault("updatedAt", defaults.updatedAt)
  };
};
