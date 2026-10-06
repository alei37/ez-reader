import type { DailyReadingTime, ReadingSession } from "../../core/entities/ReadingSession";

/**
 * Aggregate a stream of reading sessions into per-day buckets.
 *
 * Day boundary is **local time** (uses `Date#toLocaleDateString` with the
 * `en-CA` locale which yields `YYYY-MM-DD`). Sessions are bucketed by
 * their `startedAt` — a session that spans midnight counts toward the
 * day it started, matching how users mentally track "I read for 2 hours
 * last night".
 *
 * Days are returned newest-first; gaps (days with no sessions) are filled
 * with zero-buckets so the result is always exactly `days` entries.
 */
export const aggregateDailyReadingTime = (
  sessions: ReadonlyArray<ReadingSession>,
  days: number,
  now: number = Date.now()
): ReadonlyArray<DailyReadingTime> => {
  if (days <= 0) return [];

  // Bucket sessions by local date string.
  const buckets = new Map<string, { totalMs: number; count: number }>();
  for (const session of sessions) {
    const date = localDateString(session.startedAt);
    const current = buckets.get(date) ?? { totalMs: 0, count: 0 };
    current.totalMs += Math.max(0, session.durationMs);
    current.count += 1;
    buckets.set(date, current);
  }

  // Walk backwards `days` days from "today" (local).
  const result: DailyReadingTime[] = [];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;
  for (let i = days - 1; i >= 0; i -= 1) {
    const dayMs = todayMs - i * oneDayMs;
    const date = localDateString(dayMs);
    const bucket = buckets.get(date);
    result.push({
      date,
      totalMs: bucket?.totalMs ?? 0,
      sessionCount: bucket?.count ?? 0
    });
  }
  return result;
};

/** Sum total reading time in the last N days. */
export const totalReadingMsInDays = (
  daily: ReadonlyArray<DailyReadingTime>
): number => daily.reduce((acc, day) => acc + day.totalMs, 0);

/**
 * Compute the current "reading streak" — consecutive days, ending today
 * or yesterday, that have at least one reading session.
 *
 * Definition matches Duolingo's "you read today" model: if today is
 * empty, the streak is the count of consecutive days ending yesterday;
 * if today has activity, today counts. This way users don't lose their
 * streak at midnight before they've read today.
 */
export const readingStreakDays = (
  daily: ReadonlyArray<DailyReadingTime>,
  now: number = Date.now()
): number => {
  // `daily` is expected newest-first (per `aggregateDailyReadingTime`).
  // Skip today if empty, then count consecutive non-empty days going back.
  let streak = 0;
  let skippedToday = false;
  for (const day of daily) {
    if (day.totalMs <= 0 && day.sessionCount <= 0) {
      if (!skippedToday) {
        // Allow skipping the first empty day (which is "today") before
        // the streak breaks — but only if there's at least one active
        // day in the rest of the window.
        const hasAny = daily.some((d, idx) => idx > 0 && (d.totalMs > 0 || d.sessionCount > 0));
        if (hasAny) {
          skippedToday = true;
          continue;
        }
      }
      break;
    }
    streak += 1;
  }
  void now;
  return streak;
};

/**
 * Format a `YYYY-MM-DD` date in local time. Uses `en-CA` locale because
 * its calendar output is fixed to `YYYY-MM-DD` regardless of platform.
 */
const localDateString = (ms: number): string => {
  const date = new Date(ms);
  // en-CA always returns YYYY-MM-DD — fallback to manual formatting if
  // the platform locale differs in the future.
  try {
    return date.toLocaleDateString("en-CA");
  } catch {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
};
