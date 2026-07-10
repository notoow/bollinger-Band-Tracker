import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeBars,
  calculateBandPosition,
  calculateBollingerSeries,
  classifyBandState,
  findLastBreachEvent,
  normalizePriceBars,
  populationStandardDeviation,
  simpleMovingAverage,
} from "../lib/bollinger.ts";

function bars(closes, start = Date.UTC(2026, 0, 1)) {
  return closes.map((close, index) => ({
    date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    close,
  }));
}

test("normalizes dates, sorts, deduplicates with last valid value, and drops invalid bars", () => {
  const normalized = normalizePriceBars([
    { date: "2026-01-03", close: 103 },
    { date: "bad-date", close: 999 },
    { date: "2026-01-01", close: 101 },
    { date: "2026-01-02T23:30:00Z", close: 102 },
    { date: "2026-01-01", close: 111 },
    { date: "2026-01-03", close: Number.NaN },
    { date: "2026-02-30", close: 130 },
    { date: "2026-01-04", close: 0 },
    { date: "2026-01-05", close: Number.POSITIVE_INFINITY },
  ]);

  assert.deepEqual(normalized, [
    { date: "2026-01-01", close: 111 },
    { date: "2026-01-02", close: 102 },
    { date: "2026-01-03", close: 103 },
  ]);
});

test("calculates SMA and population, rather than sample, standard deviation", () => {
  assert.equal(simpleMovingAverage([1, 2, 3, 4]), 2.5);
  assert.equal(populationStandardDeviation([1, 2, 3, 4]), Math.sqrt(1.25));
  assert.equal(simpleMovingAverage([]), null);
  assert.equal(populationStandardDeviation([1, Number.NaN]), null);
});

test("uses a rolling window and marks warm-up points insufficient", () => {
  const series = calculateBollingerSeries(bars([1, 2, 3, 4, 5]), 3, 2);

  assert.deepEqual(
    series.map(({ sma, state }) => ({ sma, state })),
    [
      { sma: null, state: "INSUFFICIENT" },
      { sma: null, state: "INSUFFICIENT" },
      { sma: 2, state: "INSIDE" },
      { sma: 3, state: "INSIDE" },
      { sma: 4, state: "INSIDE" },
    ],
  );
  assert.equal(series[2].standardDeviation, Math.sqrt(2 / 3));
});

test("treats exact upper and lower boundaries as inside", () => {
  assert.equal(classifyBandState(12, 12, 8), "INSIDE");
  assert.equal(classifyBandState(8, 12, 8), "INSIDE");
  assert.equal(classifyBandState(12.000001, 12, 8), "UPPER_BREACH");
  assert.equal(classifyBandState(7.999999, 12, 8), "LOWER_BREACH");
  assert.equal(classifyBandState(Number.NaN, 12, 8), "INSUFFICIENT");
});

test("reports normalized band position and handles a flat band", () => {
  assert.equal(calculateBandPosition(8, 12, 8), 0);
  assert.equal(calculateBandPosition(10, 12, 8), 0.5);
  assert.equal(calculateBandPosition(14, 12, 8), 1.5);
  assert.equal(calculateBandPosition(10, 10, 10), 0.5);
  assert.equal(calculateBandPosition(11, 10, 10), null);
});

test("returns null when fewer than one complete window survives normalization", () => {
  assert.equal(analyzeBars(bars(Array(19).fill(100))), null);
  assert.equal(
    analyzeBars([
      ...bars(Array(19).fill(100)),
      { date: "2026-02-01", close: Number.NaN },
    ]),
    null,
  );
});

test("distinguishes a new upper breach from a continuing run and records its start", () => {
  const firstBreach = analyzeBars(bars([10, 10, 10, 10, 20]), 4, 1);
  assert.ok(firstBreach);
  assert.equal(firstBreach.state, "UPPER_BREACH");
  assert.equal(firstBreach.breachStatus, "NEW");
  assert.equal(firstBreach.isNewBreach, true);
  assert.equal(firstBreach.isContinuingBreach, false);
  assert.equal(firstBreach.currentRunStart, "2026-01-05");
  assert.ok(firstBreach.distancePercent > 0);
  assert.ok(firstBreach.bandPosition > 1);
  assert.equal(firstBreach.lastBreachEvent?.date, "2026-01-05");
  assert.equal(firstBreach.lastBreachEvent?.state, "UPPER_BREACH");

  const continuing = analyzeBars(bars([10, 10, 10, 10, 20, 30]), 4, 1);
  assert.ok(continuing);
  assert.equal(continuing.state, "UPPER_BREACH");
  assert.equal(continuing.breachStatus, "CONTINUING");
  assert.equal(continuing.isNewBreach, false);
  assert.equal(continuing.isContinuingBreach, true);
  assert.equal(continuing.currentRunStart, "2026-01-05");
  assert.equal(continuing.lastBreachEvent?.date, "2026-01-05");
});

test("reports a signed lower breach distance and resets run state once inside", () => {
  const lower = analyzeBars(bars([20, 20, 20, 20, 10]), 4, 1);
  assert.ok(lower);
  assert.equal(lower.state, "LOWER_BREACH");
  assert.equal(lower.isNewBreach, true);
  assert.ok(lower.distancePercent < 0);
  assert.ok(lower.bandPosition < 0);

  const inside = analyzeBars(bars([20, 20, 20, 20, 10, 20]), 4, 1);
  assert.ok(inside);
  assert.equal(inside.state, "INSIDE");
  assert.equal(inside.breachStatus, "NONE");
  assert.equal(inside.distancePercent, 0);
  assert.equal(inside.currentRunStart, null);
  assert.equal(inside.lastBreachEvent?.date, "2026-01-05");
});

test("last breach lookup only returns transition events inside its trading-day window", () => {
  const series = calculateBollingerSeries(
    bars([10, 10, 10, 10, 20, 30, 40, 50]),
    4,
    1,
  );

  assert.equal(findLastBreachEvent(series, 4)?.date, "2026-01-05");
  assert.equal(findLastBreachEvent(series, 3), null);
  assert.throws(() => findLastBreachEvent(series, 0), RangeError);
});

test("rejects nonsensical indicator settings", () => {
  assert.throws(() => calculateBollingerSeries(bars([1, 2]), 0, 2), RangeError);
  assert.throws(() => calculateBollingerSeries(bars([1, 2]), 2.5, 2), RangeError);
  assert.throws(() => calculateBollingerSeries(bars([1, 2]), 2, 0), RangeError);
  assert.throws(() => calculateBollingerSeries(bars([1, 2]), 2, -1), RangeError);
});
