import type { BookId } from "./Book";

/**
 * A single, contiguous reading session — the wall-clock interval between
 * "user became actively reading" and "user paused / left the reader".
 *
 * Append-only log stored at `<vault>/ezreader/sessions/<title>-<id>.jsonl`,
 * one JSON object per line. We never rewrite history; aggregations are
 * derived by streaming the file.
 *
 * Fields:
 * - `startedAt` / `endedAt` — wall-clock ms (Date.now())
 * - `durationMs` — `endedAt - startedAt`, denormalised for fast aggregation
 *   without re-parsing every line
 * - `progressStart` / `progressEnd` — book fraction at session start / end,
 *   so we can show "you read 35% → 42% in this session" in stats views
 * - `chapter` — best-effort chapter title captured at session end (foliate
 *   reports it via the `relocate` event). May be undefined for older
 *   sessions or formats that don't expose chapter info.
 */
export interface ReadingSession {
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly progressStart: number;
  readonly progressEnd: number;
  readonly chapter?: string;
}

/**
 * One day-bucket of aggregated reading time. Returned by
 * `ReadingService.getDailyReadingTime(bookId, days)`.
 *
 * Days are local-time, computed from `startedAt`. Sessions that span
 * midnight are bucketed under the day they STARTED (most recent activity
 * dominates the user's mental model of "I read yesterday").
 */
export interface DailyReadingTime {
  /** Local-time date in `YYYY-MM-DD` format. */
  readonly date: string;
  /** Sum of `durationMs` for sessions that started on this day. */
  readonly totalMs: number;
  /** Number of distinct sessions that contributed to this day. */
  readonly sessionCount: number;
}

/** Empty / placeholder session used when the log is empty. */
export const emptySession = (startedAt: number): ReadingSession => ({
  startedAt,
  endedAt: startedAt,
  durationMs: 0,
  progressStart: 0,
  progressEnd: 0
});

/**
 * Internal type alias: a session log keyed by book id. Used by adapters
 * that want to enumerate sessions without knowing the file layout.
 */
export type SessionsByBookId = ReadonlyMap<BookId, ReadonlyArray<ReadingSession>>;
