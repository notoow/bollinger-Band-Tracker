export const DEFAULT_BOLLINGER_PERIOD = 20;
export const DEFAULT_BOLLINGER_MULTIPLIER = 2;
export const DEFAULT_BREACH_LOOKBACK = 60;

export interface PriceBar {
  date: string;
  close: number;
}

export type BandState =
  | "INSUFFICIENT"
  | "INSIDE"
  | "UPPER_BREACH"
  | "LOWER_BREACH";

export type BreachStatus = "NONE" | "NEW" | "CONTINUING";

export interface BollingerPoint extends PriceBar {
  sma: number | null;
  standardDeviation: number | null;
  upperBand: number | null;
  lowerBand: number | null;
  state: BandState;
  /** 0 is the lower band and 1 is the upper band. Values may be outside that range. */
  bandPosition: number | null;
}

export interface BreachEvent {
  date: string;
  state: Extract<BandState, "UPPER_BREACH" | "LOWER_BREACH">;
  close: number;
  bandValue: number;
  /** Positive above the upper band and negative below the lower band. */
  distancePercent: number;
}

export interface BandAnalysis {
  date: string;
  close: number;
  period: number;
  multiplier: number;
  sma: number;
  standardDeviation: number;
  upperBand: number;
  lowerBand: number;
  state: Exclude<BandState, "INSUFFICIENT">;
  previousState: BandState;
  breachStatus: BreachStatus;
  isNewBreach: boolean;
  isContinuingBreach: boolean;
  /** Zero while inside; positive above the upper band; negative below the lower band. */
  distancePercent: number;
  /** Percentage difference from the upper band, when the band is non-zero. */
  distanceToUpperPercent: number | null;
  /** Percentage difference from the lower band, when the band is non-zero. */
  distanceToLowerPercent: number | null;
  /** 0 is the lower band and 1 is the upper band. Values may be outside that range. */
  bandPosition: number;
  /** First trading date in the current uninterrupted breach, or null while inside. */
  currentRunStart: string | null;
  /** Most recent transition into a breach in the default lookback window. */
  lastBreachEvent: BreachEvent | null;
  validBarCount: number;
}

type BreachState = Extract<BandState, "UPPER_BREACH" | "LOWER_BREACH">;

export function isBreachState(state: BandState): state is BreachState {
  return state === "UPPER_BREACH" || state === "LOWER_BREACH";
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const candidate = new Date(Date.UTC(year, month - 1, day));

    if (
      candidate.getUTCFullYear() !== year ||
      candidate.getUTCMonth() !== month - 1 ||
      candidate.getUTCDate() !== day
    ) {
      return null;
    }

    return trimmed;
  }

  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString().slice(0, 10)
    : null;
}

/**
 * Removes invalid stock bars, canonicalizes dates to UTC calendar days, lets the
 * last valid duplicate win, and returns a new ascending array.
 */
export function normalizePriceBars(bars: readonly PriceBar[]): PriceBar[] {
  const byDate = new Map<string, PriceBar>();

  for (const candidate of bars) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const date = normalizeDate(candidate.date);
    const close = candidate.close;

    // A daily stock close must be finite and positive. Invalid duplicates do not
    // erase an earlier valid observation for the same day.
    if (date === null || typeof close !== "number" || !Number.isFinite(close) || close <= 0) {
      continue;
    }

    byDate.set(date, { date, close });
  }

  return [...byDate.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
}

export function simpleMovingAverage(values: readonly number[]): number | null {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  // The incremental form avoids overflowing an otherwise valid collection of
  // large finite prices merely by summing them first.
  const mean = values.reduce(
    (currentMean, value, index) =>
      currentMean + (value - currentMean) / (index + 1),
    0,
  );

  return Number.isFinite(mean) ? mean : null;
}

/** Population standard deviation (divides by N, not N - 1). */
export function populationStandardDeviation(
  values: readonly number[],
  knownMean?: number,
): number | null {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const mean = knownMean ?? simpleMovingAverage(values);
  if (mean === null || !Number.isFinite(mean)) {
    return null;
  }

  const variance =
    values.reduce((sum, value) => {
      const difference = value - mean;
      return sum + difference * difference;
    }, 0) / values.length;

  // Guard against an extremely small negative caused by floating point error.
  const standardDeviation = Math.sqrt(Math.max(0, variance));
  return Number.isFinite(standardDeviation) ? standardDeviation : null;
}

/** Equality with either boundary is deliberately classified as inside. */
export function classifyBandState(
  close: number,
  upperBand: number | null,
  lowerBand: number | null,
): BandState {
  if (
    !Number.isFinite(close) ||
    upperBand === null ||
    lowerBand === null ||
    !Number.isFinite(upperBand) ||
    !Number.isFinite(lowerBand)
  ) {
    return "INSUFFICIENT";
  }

  if (close > upperBand) {
    return "UPPER_BREACH";
  }

  if (close < lowerBand) {
    return "LOWER_BREACH";
  }

  return "INSIDE";
}

export function calculateBandPosition(
  close: number,
  upperBand: number,
  lowerBand: number,
): number | null {
  if (
    !Number.isFinite(close) ||
    !Number.isFinite(upperBand) ||
    !Number.isFinite(lowerBand)
  ) {
    return null;
  }

  const width = upperBand - lowerBand;
  if (width === 0) {
    // A flat series sits on both exact boundaries and is therefore inside.
    return close === upperBand ? 0.5 : null;
  }

  return (close - lowerBand) / width;
}

/**
 * Returns the signed percentage beyond the breached boundary. Inside values are
 * zero, which makes this safe to display as "breach distance".
 */
export function calculateBreachDistancePercent(
  close: number,
  upperBand: number,
  lowerBand: number,
  state: BandState = classifyBandState(close, upperBand, lowerBand),
): number {
  if (state === "UPPER_BREACH" && upperBand !== 0) {
    return ((close - upperBand) / Math.abs(upperBand)) * 100;
  }

  if (state === "LOWER_BREACH" && lowerBand !== 0) {
    return ((close - lowerBand) / Math.abs(lowerBand)) * 100;
  }

  return 0;
}

function assertSettings(period: number, multiplier: number): void {
  if (!Number.isInteger(period) || period < 1) {
    throw new RangeError("period must be a positive integer");
  }

  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new RangeError("multiplier must be a finite positive number");
  }
}

/** Builds one point per normalized bar, marking the warm-up period insufficient. */
export function calculateBollingerSeries(
  bars: readonly PriceBar[],
  period = DEFAULT_BOLLINGER_PERIOD,
  multiplier = DEFAULT_BOLLINGER_MULTIPLIER,
): BollingerPoint[] {
  assertSettings(period, multiplier);

  const normalized = normalizePriceBars(bars);
  const result: BollingerPoint[] = [];

  for (let index = 0; index < normalized.length; index += 1) {
    const bar = normalized[index];

    if (index + 1 < period) {
      result.push({
        ...bar,
        sma: null,
        standardDeviation: null,
        upperBand: null,
        lowerBand: null,
        state: "INSUFFICIENT",
        bandPosition: null,
      });
      continue;
    }

    const closes = normalized
      .slice(index - period + 1, index + 1)
      .map(({ close }) => close);
    const sma = simpleMovingAverage(closes);
    const standardDeviation = populationStandardDeviation(closes, sma ?? undefined);

    // Normalization guarantees finite closes, so these can only be null if a
    // future implementation changes the input contract.
    if (sma === null || standardDeviation === null) {
      result.push({
        ...bar,
        sma: null,
        standardDeviation: null,
        upperBand: null,
        lowerBand: null,
        state: "INSUFFICIENT",
        bandPosition: null,
      });
      continue;
    }

    const upperBand = sma + multiplier * standardDeviation;
    const lowerBand = sma - multiplier * standardDeviation;
    const state = classifyBandState(bar.close, upperBand, lowerBand);

    result.push({
      ...bar,
      sma,
      standardDeviation,
      upperBand,
      lowerBand,
      state,
      bandPosition: calculateBandPosition(bar.close, upperBand, lowerBand),
    });
  }

  return result;
}

export function getBreachStatus(
  state: BandState,
  previousState: BandState,
): BreachStatus {
  if (!isBreachState(state)) {
    return "NONE";
  }

  return state === previousState ? "CONTINUING" : "NEW";
}

export function findCurrentRunStart(
  series: readonly BollingerPoint[],
): string | null {
  const latest = series.at(-1);
  if (!latest || !isBreachState(latest.state)) {
    return null;
  }

  let startIndex = series.length - 1;
  while (startIndex > 0 && series[startIndex - 1].state === latest.state) {
    startIndex -= 1;
  }

  return series[startIndex].date;
}

/** Finds the most recent transition into either breach within N trading points. */
export function findLastBreachEvent(
  series: readonly BollingerPoint[],
  lookback = DEFAULT_BREACH_LOOKBACK,
): BreachEvent | null {
  if (!Number.isInteger(lookback) || lookback < 1) {
    throw new RangeError("lookback must be a positive integer");
  }

  const firstIndex = Math.max(0, series.length - lookback);

  for (let index = series.length - 1; index >= firstIndex; index -= 1) {
    const point = series[index];
    if (!isBreachState(point.state) || series[index - 1]?.state === point.state) {
      continue;
    }

    const bandValue =
      point.state === "UPPER_BREACH" ? point.upperBand : point.lowerBand;
    if (bandValue === null) {
      continue;
    }

    return {
      date: point.date,
      state: point.state,
      close: point.close,
      bandValue,
      distancePercent: calculateBreachDistancePercent(
        point.close,
        point.upperBand ?? bandValue,
        point.lowerBand ?? bandValue,
        point.state,
      ),
    };
  }

  return null;
}

/**
 * Summarizes the latest valid daily bar. Returns null until a complete rolling
 * window exists after invalid rows and duplicate dates have been removed.
 */
export function analyzeBars(
  bars: readonly PriceBar[],
  period = DEFAULT_BOLLINGER_PERIOD,
  multiplier = DEFAULT_BOLLINGER_MULTIPLIER,
): BandAnalysis | null {
  const series = calculateBollingerSeries(bars, period, multiplier);
  const latest = series.at(-1);

  if (
    !latest ||
    latest.state === "INSUFFICIENT" ||
    latest.sma === null ||
    latest.standardDeviation === null ||
    latest.upperBand === null ||
    latest.lowerBand === null ||
    latest.bandPosition === null
  ) {
    return null;
  }

  const previousState = series.at(-2)?.state ?? "INSUFFICIENT";
  const breachStatus = getBreachStatus(latest.state, previousState);

  return {
    date: latest.date,
    close: latest.close,
    period,
    multiplier,
    sma: latest.sma,
    standardDeviation: latest.standardDeviation,
    upperBand: latest.upperBand,
    lowerBand: latest.lowerBand,
    state: latest.state,
    previousState,
    breachStatus,
    isNewBreach: breachStatus === "NEW",
    isContinuingBreach: breachStatus === "CONTINUING",
    distancePercent: calculateBreachDistancePercent(
      latest.close,
      latest.upperBand,
      latest.lowerBand,
      latest.state,
    ),
    distanceToUpperPercent:
      latest.upperBand === 0
        ? null
        : ((latest.close - latest.upperBand) / Math.abs(latest.upperBand)) * 100,
    distanceToLowerPercent:
      latest.lowerBand === 0
        ? null
        : ((latest.close - latest.lowerBand) / Math.abs(latest.lowerBand)) * 100,
    bandPosition: latest.bandPosition,
    currentRunStart: findCurrentRunStart(series),
    lastBreachEvent: findLastBreachEvent(series),
    validBarCount: series.length,
  };
}
