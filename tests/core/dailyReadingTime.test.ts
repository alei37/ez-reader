import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  aggregateDailyReadingTime,
  totalReadingMsInDays,
  readingStreakDays
} from "../../src/core/utils/dailyReadingTime";
import type { ReadingSession } from "../../src/core/entities/ReadingSession";

/**
 * Helper: synthesize a ReadingSession that starts at a given Date and runs
 * for `durationMs` (using startedAt as anchor so we don't have to compute
 * endedAt in every test).
 */
const session = (startedAt: Date, durationMs: number, opts: Partial<ReadingSession> = {}): ReadingSession => ({
  startedAt: startedAt.getTime(),
  endedAt: startedAt.getTime() + durationMs,
  durationMs,
  progressStart: 0,
  progressEnd: 0,
  ...opts
});

/**
 * Returns local-time midnight for "N days before now". We use this as the
 * base for `aggregateDailyReadingTime`'s `now` argument so tests are stable
 * regardless of what time-of-day the test runner fires.
 */
const localMidnight = (now: number): number => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// ===========================================================================
// aggregateDailyReadingTime
// ===========================================================================

test("aggregateDailyReadingTime: empty sessions, 7 days → 7 zero-buckets", () => {
  const now = new Date("2026-09-20T15:00:00").getTime();
  const result = aggregateDailyReadingTime([], 7, now);
  assert.equal(result.length, 7);
  for (const bucket of result) {
    assert.equal(bucket.totalMs, 0);
    assert.equal(bucket.sessionCount, 0);
  }
});

test("aggregateDailyReadingTime: single session today → bucket sums to durationMs", () => {
  const now = new Date("2026-09-20T15:00:00").getTime();
  const todayMidnight = localMidnight(now);
  const sessions: ReadingSession[] = [
    session(new Date(todayMidnight + 3 * 60 * 60_000), 30 * 60_000) // 30min this morning
  ];
  const result = aggregateDailyReadingTime(sessions, 7, now);
  // newest-first → index 0 is today
  assert.equal(result[0]?.totalMs, 30 * 60_000);
  assert.equal(result[0]?.sessionCount, 1);
  // rest are zero
  for (let i = 1; i < 7; i += 1) {
    assert.equal(result[i]?.totalMs, 0, `day ${i} should be empty`);
  }
});

test("aggregateDailyReadingTime: session spanning midnight goes to start day", () => {
  // Started 23:30 yesterday, ran 1 hour → ended 00:30 today
  // Per docs: bucketed under the day it STARTED (yesterday)
  const now = new Date("2026-09-20T01:00:00").getTime(); // 01:00 today
  const yesterdayLateNight = new Date(now);
  yesterdayLateNight.setDate(yesterdayLateNight.getDate() - 1);
  yesterdayLateNight.setHours(23, 30, 0, 0);

  const sessions: ReadingSession[] = [
    session(yesterdayLateNight, 60 * 60_000) // 60min started 23:30 yesterday
  ];
  const result = aggregateDailyReadingTime(sessions, 3, now);
  // newest-first: today, yesterday, day-before
  assert.equal(result[0]?.totalMs, 0, "today is 0 (session ended today but counted as yesterday)");
  assert.equal(result[1]?.totalMs, 60 * 60_000, "yesterday has the 60min");
  assert.equal(result[2]?.totalMs, 0, "day-before-yesterday is 0");
});

test("aggregateDailyReadingTime: 30 days → 30 entries", () => {
  const now = new Date("2026-09-20T15:00:00").getTime();
  const result = aggregateDailyReadingTime([], 30, now);
  assert.equal(result.length, 30);
});

test("aggregateDailyReadingTime: days=0 → empty array", () => {
  const result = aggregateDailyReadingTime([], 0);
  assert.equal(result.length, 0);
});

test("aggregateDailyReadingTime: negative days → empty array", () => {
  const result = aggregateDailyReadingTime([], -5);
  assert.equal(result.length, 0);
});

test("aggregateDailyReadingTime: result is newest-first", () => {
  // Inject sessions on 3 different days and verify the result dates
  // are in descending order.
  const now = new Date("2026-09-20T15:00:00").getTime();
  const todayMidnight = localMidnight(now);
  const sessions: ReadingSession[] = [
    session(new Date(todayMidnight + 10 * 60_000), 10 * 60_000), // today
    session(new Date(todayMidnight - 1 * 24 * 60 * 60_000 + 10 * 60_000), 5 * 60_000), // 1 day ago
    session(new Date(todayMidnight - 5 * 24 * 60 * 60_000 + 10 * 60_000), 7 * 60_000) // 5 days ago
  ];
  const result = aggregateDailyReadingTime(sessions, 30, now);
  // Result is newest-first: index 0 is today's date
  assert.equal(result[0]?.date, new Date(todayMidnight).toLocaleDateString("en-CA"));
  assert.equal(result[1]?.date, new Date(todayMidnight - 1 * 24 * 60 * 60_000).toLocaleDateString("en-CA"));
  assert.equal(result[5]?.date, new Date(todayMidnight - 5 * 24 * 60 * 60_000).toLocaleDateString("en-CA"));

  // Verify dates are strictly descending (or equal — can't be equal since 1-day apart)
  for (let i = 1; i < result.length; i += 1) {
    const prev = new Date(result[i - 1]!.date).getTime();
    const cur = new Date(result[i]!.date).getTime();
    assert.ok(prev > cur, `index ${i - 1} (${result[i - 1]?.date}) should be newer than index ${i} (${result[i]?.date})`);
  }
});

test("aggregateDailyReadingTime: multiple sessions on same day sum together", () => {
  const now = new Date("2026-09-20T15:00:00").getTime();
  const todayMidnight = localMidnight(now);
  const sessions: ReadingSession[] = [
    session(new Date(todayMidnight + 8 * 60 * 60_000), 30 * 60_000),
    session(new Date(todayMidnight + 11 * 60 * 60_000), 45 * 60_000),
    session(new Date(todayMidnight + 14 * 60 * 60_000), 15 * 60_000)
  ];
  const result = aggregateDailyReadingTime(sessions, 1, now);
  assert.equal(result[0]?.totalMs, (30 + 45 + 15) * 60_000, "30+45+15 = 90 minutes");
  assert.equal(result[0]?.sessionCount, 3);
});

test("aggregateDailyReadingTime: negative durationMs treated as 0", () => {
  // ReadingSession.durationMs shouldn't be, but defensive: if negative, treat as 0.
  const now = new Date("2026-09-20T15:00:00").getTime();
  const todayMidnight = localMidnight(now);
  const sessions: ReadingSession[] = [
    session(new Date(todayMidnight + 10 * 60_000), -1000), // bad data
    session(new Date(todayMidnight + 11 * 60_000), 5 * 60_000) // good data
  ];
  const result = aggregateDailyReadingTime(sessions, 1, now);
  // Sum is 5min only — negative was clamped to 0
  assert.equal(result[0]?.totalMs, 5 * 60_000);
  assert.equal(result[0]?.sessionCount, 2, "sessionCount counts both sessions even if one is bad");
});

// ===========================================================================
// totalReadingMsInDays
// ===========================================================================

test("totalReadingMsInDays: empty → 0", () => {
  assert.equal(totalReadingMsInDays([]), 0);
});

test("totalReadingMsInDays: 3 buckets 25/30/0 → 55", () => {
  const daily = [
    { date: "2026-09-20", totalMs: 25 * 60_000, sessionCount: 1 },
    { date: "2026-09-19", totalMs: 30 * 60_000, sessionCount: 2 },
    { date: "2026-09-18", totalMs: 0, sessionCount: 0 }
  ];
  assert.equal(totalReadingMsInDays(daily), 55 * 60_000);
});

test("totalReadingMsInDays: matches aggregateDailyReadingTime sum", () => {
  const now = new Date("2026-09-20T15:00:00").getTime();
  const todayMidnight = localMidnight(now);
  const sessions: ReadingSession[] = [
    session(new Date(todayMidnight + 8 * 60_000), 10 * 60_000),
    session(new Date(todayMidnight - 1 * 24 * 60 * 60_000 + 8 * 60_000), 20 * 60_000),
    session(new Date(todayMidnight - 2 * 24 * 60 * 60_000 + 8 * 60_000), 30 * 60_000)
  ];
  const daily = aggregateDailyReadingTime(sessions, 7, now);
  const expected = 60 * 60_000;
  assert.equal(totalReadingMsInDays(daily), expected);
});

// ===========================================================================
// readingStreakDays
// ===========================================================================

test("readingStreakDays: empty → 0", () => {
  assert.equal(readingStreakDays([]), 0);
});

test("readingStreakDays: today + yesterday + day-before all have data → 3", () => {
  const daily = [
    { date: "2026-09-20", totalMs: 1000, sessionCount: 1 },
    { date: "2026-09-19", totalMs: 2000, sessionCount: 1 },
    { date: "2026-09-18", totalMs: 3000, sessionCount: 1 }
  ];
  assert.equal(readingStreakDays(daily), 3);
});

test("readingStreakDays: today empty, yesterday + day-before have → 2 (skip-today allowed)", () => {
  // Today is empty (user hasn't read yet) but past days are active.
  // Per spec: "streak is the count of consecutive days ending yesterday".
  const daily = [
    { date: "2026-09-20", totalMs: 0, sessionCount: 0 }, // today empty
    { date: "2026-09-19", totalMs: 1000, sessionCount: 1 },
    { date: "2026-09-18", totalMs: 2000, sessionCount: 1 }
  ];
  assert.equal(readingStreakDays(daily), 2);
});

test("readingStreakDays: yesterday empty, day-before has → 0 (streak broken)", () => {
  // Spec: skipping today is allowed (haven't read today yet), but if
  // yesterday is also empty the streak has ended.
  const daily = [
    { date: "2026-09-20", totalMs: 0, sessionCount: 0 }, // today empty
    { date: "2026-09-19", totalMs: 0, sessionCount: 0 }, // yesterday empty — streak broken
    { date: "2026-09-18", totalMs: 1000, sessionCount: 1 },
    { date: "2026-09-17", totalMs: 2000, sessionCount: 1 }
  ];
  assert.equal(readingStreakDays(daily), 0);
});

test("readingStreakDays: gap in middle → streak resets", () => {
  // 3 active days, then 1 empty, then 2 more active.
  // Streak from the most recent cluster = 2.
  const daily = [
    { date: "2026-09-20", totalMs: 1000, sessionCount: 1 },
    { date: "2026-09-19", totalMs: 1000, sessionCount: 1 },
    { date: "2026-09-18", totalMs: 0, sessionCount: 0 }, // gap
    { date: "2026-09-17", totalMs: 1000, sessionCount: 1 },
    { date: "2026-09-16", totalMs: 1000, sessionCount: 1 }
  ];
  assert.equal(readingStreakDays(daily), 2, "streak is from the most recent consecutive cluster");
});

test("readingStreakDays: all days empty → 0", () => {
  const daily = [
    { date: "2026-09-20", totalMs: 0, sessionCount: 0 },
    { date: "2026-09-19", totalMs: 0, sessionCount: 0 },
    { date: "2026-09-18", totalMs: 0, sessionCount: 0 }
  ];
  assert.equal(readingStreakDays(daily), 0);
});

test("readingStreakDays: sessionCount alone counts (zero-ms but sessionCount > 0)", () => {
  // Edge: session exists with durationMs=0 but sessionCount=1.
  // The aggregator uses `(totalMs > 0 || sessionCount > 0)` semantically.
  // For readingStreakDays the code checks `totalMs <= 0 && sessionCount <= 0`.
  const daily = [
    { date: "2026-09-20", totalMs: 0, sessionCount: 1 }, // zero-ms but 1 entry
    { date: "2026-09-19", totalMs: 0, sessionCount: 1 }
  ];
  // Hmm, implementation: `if (totalMs <= 0 && sessionCount <= 0)` → break.
  // sessionCount=1 is not <= 0, so it counts as a streak day.
  assert.equal(readingStreakDays(daily), 2);
});