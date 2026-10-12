import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateDailyReadingTime,
  readingStreakDays
} from "../../src/adapters/obsidian/dailyReadingTime";
import type { ReadingSession } from "../../src/core/entities/ReadingSession";

/**
 * Day-window arithmetic must follow the local calendar, not milliseconds.
 * A fixed 24h step from local midnight breaks across DST transitions
 * (23h / 25h days), which silently dropped a whole day from the 30-day
 * window and under-reported the streak.
 *
 * These tests pin TZ so they actually exercise the transition rather than
 * passing vacuously on a no-DST machine.
 */

const inTz = (tz: string, fn: () => void): void => {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
};

const sessionOn = (isoLocal: string, durationMs = 60_000): ReadingSession => {
  const [date, time] = isoLocal.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const startedAt = new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
  return {
    startedAt,
    endedAt: startedAt + durationMs,
    durationMs,
    progressStart: 0,
    progressEnd: 0.1
  };
};

test("DST: 30-day window has no gaps and no duplicates across spring-forward", () => {
  inTz("America/New_York", () => {
    const now = new Date(2026, 2, 12, 12, 0, 0).getTime(); // after the 03-08 change
    const daily = aggregateDailyReadingTime([], 30, now);
    const dates = daily.map((d) => d.date);
    assert.equal(dates.length, 30);
    assert.equal(new Set(dates).size, 30, `duplicate dates in window: ${dates.join(",")}`);
    assert.ok(dates.includes("2026-03-08"), `2026-03-08 missing from ${dates.join(",")}`);
    // Newest first, contiguous calendar days.
    for (let i = 1; i < dates.length; i += 1) {
      const prev = new Date(`${dates[i - 1]}T12:00:00`);
      const cur = new Date(`${dates[i]}T12:00:00`);
      const diffDays = Math.round((prev.getTime() - cur.getTime()) / 86_400_000);
      assert.equal(diffDays, 1, `${dates[i - 1]} → ${dates[i]} is not consecutive`);
    }
  });
});

test("DST: 30-day window is intact across fall-back", () => {
  inTz("America/New_York", () => {
    const now = new Date(2026, 10, 5, 12, 0, 0).getTime(); // after the 11-01 change
    const dates = aggregateDailyReadingTime([], 30, now).map((d) => d.date);
    assert.equal(new Set(dates).size, 30, `duplicate dates: ${dates.join(",")}`);
    assert.ok(dates.includes("2026-11-01"), "fall-back day must be present");
  });
});

test("DST: sessions on the transition day are counted", () => {
  inTz("America/New_York", () => {
    const now = new Date(2026, 2, 10, 12, 0, 0).getTime();
    const sessions = [
      sessionOn("2026-03-07T10:00", 10 * 60_000),
      sessionOn("2026-03-08T10:00", 20 * 60_000),
      sessionOn("2026-03-09T10:00", 30 * 60_000)
    ];
    const daily = aggregateDailyReadingTime(sessions, 30, now);
    const total = daily.reduce((acc, d) => acc + d.totalMs, 0);
    assert.equal(total, 60 * 60_000, "all three days must be summed");
    assert.equal(readingStreakDays(daily, now), 3, "3-day streak ending Mar 9");
  });
});

test("no-DST timezone is unaffected", () => {
  inTz("Asia/Shanghai", () => {
    const now = new Date(2026, 2, 12, 12, 0, 0).getTime();
    const dates = aggregateDailyReadingTime([], 30, now).map((d) => d.date);
    assert.equal(new Set(dates).size, 30);
    assert.equal(dates[0], "2026-03-12");
  });
});
