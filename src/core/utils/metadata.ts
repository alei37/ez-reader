import type { BookMetadata } from "../entities/Book";
import type { Locale } from "../types/Locale";

/**
 * Normalise one persisted `BookMetadata` record without discarding any of it.
 *
 * P0 数据丢失修复: `ObsidianAnnotationStore.load()` runs this on every
 * startup, and the version it replaces rebuilt each entry as
 * `{title, authors, languages: [], cachedAt}` — silently destroying
 * `publisher`, `published`, `identifier` and `description` on every restart.
 * Because `load()` also rebuilds `languages` as empty, `LibraryService.stats()`
 * reported a permanent zero for every language, so the shelf's language
 * filter could never match anything.
 *
 * Two rules now:
 *   1. Every known field is normalised by its own type, never dropped.
 *   2. Fields this version does not know about are passed through untouched,
 *      so adding a field to `BookMetadata` later cannot silently shred users'
 *      data through this path.
 *
 * `title` is the only hard requirement — an entry without one is dropped by
 * the caller, because the shelf renders nothing useful for it.
 */

const LOCALE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/** Keep a string field when it is a non-empty string; otherwise omit it. */
const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

/** Keep a string array when it is an array, dropping non-string/empty items. */
const stringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
};

/**
 * Languages are `Locale` (a branded BCP-47 tag), and the shelf matches them
 * exactly. Accept anything tag-shaped so a slightly non-canonical tag from an
 * OPF still shows up in the filter, and fall back to `[]` rather than
 * inventing a value.
 */
const locales = (value: unknown): Locale[] => {
  const raw = stringArray(value).map((tag) => tag.trim());
  const good = raw.filter((tag) => LOCALE_RE.test(tag));
  return good as Locale[];
};

/**
 * `cachedAt` decides when the shelf re-parses the book file. A corrupt or
 * missing value must not pin the entry as permanently stale — nor freeze it
 * as permanently fresh. Treat anything unusable as "parse now".
 */
const cachedAt = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : Date.now();

export const sanitizeBookMetadata = (input: Record<string, unknown>): BookMetadata => {
  const known = new Set([
    "title",
    "authors",
    "publisher",
    "published",
    "languages",
    "identifier",
    "description",
    "cachedAt"
  ]);

  // Preserve whatever this build does not understand, so a data.json written
  // by a newer version (or carrying third-party fields) round-trips intact.
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (known.has(key) || value === undefined) continue;
    extras[key] = value;
  }

  return {
    title: String(input.title).trim(),
    authors: stringArray(input.authors),
    languages: locales(input.languages),
    cachedAt: cachedAt(input.cachedAt),
    ...(optionalString(input.publisher) !== undefined
      ? { publisher: optionalString(input.publisher) }
      : {}),
    ...(optionalString(input.published) !== undefined
      ? { published: optionalString(input.published) }
      : {}),
    ...(optionalString(input.identifier) !== undefined
      ? { identifier: optionalString(input.identifier) }
      : {}),
    ...(optionalString(input.description) !== undefined
      ? { description: optionalString(input.description) }
      : {}),
    ...extras
  } as BookMetadata;
};