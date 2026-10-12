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

  // Walk `days` days forward from today, but push in newest-first order
  // (i=0 → today at result[0], i=days-1 → oldest at result[days-1]). The
  // P0 fix here: previous loop iterated i=days-1→0 which produced
  // OLDEST-first order, contradicting the docstring and breaking callers
  // (BookInfoModal reverses for left→right chronological display,
  // ReadingService/readingStreakDays treat daily[0] as "today").
  const result: DailyReadingTime[] = [];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  // P1 fix: walk the calendar, not milliseconds.
  //
  // Subtracting a fixed 24h from local midnight is wrong across a DST
  // boundary. Verified in America/New_York: with today = 2026-03-12 the
  // old loop produced
  //   03-12 03-11 03-10 03-09 **03-07** 03-06 …
  // March 8 never appears, and every later bucket is shifted by a day, so
  // the "last 30 days" total silently dropped a whole day of reading and
  // `readingStreakDays` reported 2 instead of 3. A spring-forward day is
  // 23h long, a fall-back day 25h.
  //
  // `setDate` walks local calendar days, so each step lands on the next
  // real midnight regardless of DST.
  const cursor = new Date(today);
  for (let i = 0; i < days; i += 1) {
    const date = localDateString(cursor.getTime());
    const bucket = buckets.get(date);
    result.push({
      date,
      totalMs: bucket?.totalMs ?? 0,
      sessionCount: bucket?.count ?? 0
    });
    cursor.setDate(cursor.getDate() - 1);
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
  // P0 fix: previous gate was `!skippedToday` — that fires on the FIRST
  // empty day encountered, not just today. If today has data but a later
  // day in the window is empty (e.g. user took a break yesterday), the
  // code would skip that gap instead of breaking the streak, over-counting.
  // We now track the iteration index and only allow skip when i === 0.
  let streak = 0;
  for (let i = 0; i < daily.length; i += 1) {
    const day = daily[i];
    if (day.totalMs <= 0 && day.sessionCount <= 0) {
      if (i === 0) {
        // Allow skipping today only — and only if there's at least one
        // active day in the rest of the window (otherwise streak = 0).
        const hasAny = daily.some((d, idx) => idx > 0 && (d.totalMs > 0 || d.sessionCount > 0));
        if (hasAny) continue;
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
