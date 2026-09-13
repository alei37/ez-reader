import type { BookFormat } from "../entities/Book";
import type { Locale } from "./Locale";
import type { ReadingStatus } from "../entities/ReadingState";

/**
 * A filter applied on top of the personal library. All fields are optional;
 * absent fields mean "do not filter on this dimension".
 *
 * Filter shape is deliberately additive: setting `languages: ["English"]`
 * means "show books whose primary language is English", and adding
 * `statuses: ["reading"]` further narrows to "books currently being read".
 */
export interface ShelfFilter {
  /** Restrict to specific statuses. Empty array means no restriction. */
  readonly statuses?: ReadonlyArray<ReadingStatus>;
  /** Restrict to specific language tags. Empty array means no restriction. */
  readonly languages?: ReadonlyArray<Locale>;
  /** Restrict to specific formats. Empty array means no restriction. */
  readonly formats?: ReadonlyArray<BookFormat>;
  /** Restrict by progress bucket. Empty array means no restriction. */
  readonly progressBuckets?: ReadonlyArray<ProgressBucket>;
  /** Restrict to books opened within the given recency bucket. */
  readonly recency?: RecencyBucket;
  /** Free-text query matched against title, author, and identifier. */
  readonly query?: string;
}

export type ProgressBucket = "untouched" | "early" | "middle" | "late" | "finished";

export type RecencyBucket = "today" | "thisWeek" | "thisMonth" | "older" | "never";

export const PROGRESS_BUCKETS: ReadonlyArray<ProgressBucket> = [
  "untouched",
  "early",
  "middle",
  "late",
  "finished"
];

export const RECENCY_BUCKETS: ReadonlyArray<RecencyBucket> = [
  "today",
  "thisWeek",
  "thisMonth",
  "older",
  "never"
];

export type SortCriterion =
  | "titleAsc"
  | "titleDesc"
  | "authorAsc"
  | "addedDesc"
  | "openedDesc"
  | "progressDesc";

export const DEFAULT_SORT: SortCriterion = "addedDesc";

export const emptyFilter = (): ShelfFilter => ({});