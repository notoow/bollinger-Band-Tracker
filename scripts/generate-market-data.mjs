import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const PERIOD = 20;
const MULTIPLIER = 2;
const outputFile = resolve("static/public/data/market.json");

const watchlist = [
  ["VOO", "Vanguard S&P 500 ETF", "ETF", 610],
  ["SPY", "SPDR S&P 500 ETF", "ETF", 665],
  ["GOOGL", "알파벳 Class A", "STOCK", 215],
  ["GOOG", "알파벳 Class C", "STOCK", 216],
  ["AAPL", "애플", "STOCK", 255],
  ["AMZN", "아마존", "STOCK", 235],
  ["META", "메타 플랫폼스", "STOCK", 690],
  ["TSLA", "테슬라", "STOCK", 360],
  ["NVDA", "엔비디아", "STOCK", 190],
  ["MSFT", "마이크로소프트", "STOCK", 535],
].map(([symbol, name, kind, base]) => ({ symbol, name, kind, base }));

function normalizedBars(input) {
  const dates = new Map();
  for (const entry of input) {
    const date = typeof entry?.date === "string" ? entry.date.slice(0, 10) : null;
    const close = entry?.close;
    if (date && Number.isFinite(close) && close > 0) dates.set(date, { date, close });
  }
  return [...dates.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function pointFor(bars, index) {
  if (index + 1 < PERIOD) return { ...bars[index], state: "INSUFFICIENT" };
  const closes = bars.slice(index - PERIOD + 1, index + 1).map((bar) => bar.close);
  const sma = mean(closes);
  const standardDeviation = Math.sqrt(mean(closes.map((value) => (value - sma) ** 2)));
  const upperBand = sma + MULTIPLIER * standardDeviation;
  const lowerBand = sma - MULTIPLIER * standardDeviation;
  const close = bars[index].close;
  const state = close > upperBand ? "UPPER_BREACH" : close < lowerBand ? "LOWER_BREACH" : "INSIDE";
  const bandPosition = upperBand === lowerBand ? 0.5 : (close - lowerBand) / (upperBand - lowerBand);
  return { ...bars[index], sma, standardDeviation, upperBand, lowerBand, state, bandPosition };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function historicalContext(series, signal) {
  const horizonDays = 5;
  const start = Math.max(PERIOD - 1, series.length - 260);
  const samples = [];

  for (let index = start; index < series.length - horizonDays; index += 1) {
    const point = series[index];
    if (point.state === "INSUFFICIENT") continue;
    const upperGap = ((point.upperBand - point.close) / Math.abs(point.upperBand)) * 100;
    const lowerGap = ((point.close - point.lowerBand) / Math.abs(point.lowerBand)) * 100;
    const matches =
      (signal === "UPPER_BREAK" && point.state === "UPPER_BREACH") ||
      (signal === "LOWER_BREAK" && point.state === "LOWER_BREACH") ||
      (signal === "NEAR_UPPER" && point.state === "INSIDE" && upperGap >= 0 && upperGap <= 1) ||
      (signal === "NEAR_LOWER" && point.state === "INSIDE" && lowerGap >= 0 && lowerGap <= 1);
    if (!matches) continue;

    const nextPoints = series.slice(index + 1, index + horizonDays + 1);
    const outcome =
      signal === "UPPER_BREAK" || signal === "LOWER_BREAK"
        ? nextPoints.some((candidate) => candidate.state === "INSIDE")
        : nextPoints.some((candidate) =>
            signal === "NEAR_UPPER"
              ? candidate.state === "UPPER_BREACH"
              : candidate.state === "LOWER_BREACH",
          );
    const returnPercent = ((series[index + horizonDays].close - point.close) / point.close) * 100;
    samples.push({ outcome, returnPercent });
  }

  if (samples.length < 3) return null;
  return {
    horizonDays,
    sampleSize: samples.length,
    eventRate: (samples.filter((sample) => sample.outcome).length / samples.length) * 100,
    medianReturn: median(samples.map((sample) => sample.returnPercent)),
  };
}

function analyze(input) {
  const bars = normalizedBars(input);
  if (bars.length < PERIOD) return null;
  const series = bars.map((_, index) => pointFor(bars, index));
  const latest = series.at(-1);
  if (!latest || latest.state === "INSUFFICIENT") return null;
  const previous = series.at(-2)?.state ?? "INSUFFICIENT";
  const isBreach = latest.state !== "INSIDE";
  const isNewBreach = isBreach && latest.state !== previous;
  let currentRunStart = null;
  if (isBreach) {
    let index = series.length - 1;
    while (index > 0 && series[index - 1].state === latest.state) index -= 1;
    currentRunStart = series[index].date;
  }
  let lastBreachEvent = null;
  for (let index = series.length - 1; index >= Math.max(0, series.length - 60); index -= 1) {
    const point = series[index];
    if (point.state === "INSIDE" || point.state === series[index - 1]?.state) continue;
    lastBreachEvent = {
      date: point.date,
      direction: point.state === "UPPER_BREACH" ? "UPPER" : "LOWER",
    };
    break;
  }
  const upperGap = ((latest.upperBand - latest.close) / Math.abs(latest.upperBand)) * 100;
  const lowerGap = ((latest.close - latest.lowerBand) / Math.abs(latest.lowerBand)) * 100;
  let signal = "INSIDE";
  let distancePercent = Math.min(Math.max(upperGap, 0), Math.max(lowerGap, 0));
  if (latest.state === "UPPER_BREACH") {
    signal = "UPPER_BREAK";
    distancePercent = ((latest.close - latest.upperBand) / Math.abs(latest.upperBand)) * 100;
  } else if (latest.state === "LOWER_BREACH") {
    signal = "LOWER_BREAK";
    distancePercent = ((latest.close - latest.lowerBand) / Math.abs(latest.lowerBand)) * 100;
  } else if (upperGap <= 1) {
    signal = "NEAR_UPPER";
    distancePercent = upperGap;
  } else if (lowerGap <= 1) {
    signal = "NEAR_LOWER";
    distancePercent = lowerGap;
  }
  return {
    bars,
    history: series
      .filter((point) => point.state !== "INSUFFICIENT")
      .slice(-260)
      .map(({ date, close, sma, upperBand, lowerBand }) => ({ date, close, sma, upperBand, lowerBand })),
    analysis: {
      ...latest,
      signal,
      distancePercent,
      isNewBreach,
      isContinuingBreach: isBreach && !isNewBreach,
      currentRunStart,
      lastBreachEvent,
      statisticalContext: historicalContext(series, signal),
    },
  };
}

function tradingDates(count) {
  const dates = [];
  const cursor = new Date();
  cursor.setUTCHours(12, 0, 0, 0);
  while (dates.length < count) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates.reverse();
}

function demoBars(stock) {
  const dates = tradingDates(180);
  const seed = [...stock.symbol].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const volatility = stock.symbol === "TSLA" || stock.symbol === "NVDA" ? 0.024 : 0.013;
  const drift = ((seed % 7) - 2) * 0.00008 + 0.00033;
  const bars = dates.map((date, index) => {
    const cycle = Math.sin(index * 0.19 + seed) * volatility;
    const micro = Math.sin(index * 0.57 + seed * 0.2) * volatility * 0.24;
    const trend = 1 + drift * (index - dates.length * 0.52);
    return { date, close: Number((stock.base * trend * (1 + cycle + micro)).toFixed(4)) };
  });
  const last = bars.length - 1;
  const shocks = { GOOGL: 1.095, TSLA: 0.86, NVDA: 1.13, META: 1.055, MSFT: 1.07 };
  if (shocks[stock.symbol]) bars[last].close = Number((bars[last - 1].close * shocks[stock.symbol]).toFixed(4));
  return bars;
}

async function tiingoBars(stock, token) {
  const start = new Date();
  start.setUTCMonth(start.getUTCMonth() - 14);
  const url = new URL(`https://api.tiingo.com/tiingo/daily/${stock.symbol}/prices`);
  url.searchParams.set("startDate", start.toISOString().slice(0, 10));
  url.searchParams.set("resampleFreq", "daily");
  const response = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Token ${token}` },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("Unexpected response");
  return rows.map((row) => ({ date: row.date, close: row.adjClose ?? row.close }));
}

async function buildItem(stock, token) {
  let bars = demoBars(stock);
  let error = null;
  if (token) {
    try {
      bars = await tiingoBars(stock, token);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "Unknown provider error";
    }
  }
  const result = analyze(bars);
  if (!result) throw new Error(`${stock.symbol}: insufficient data`);
  const { analysis } = result;
  const previousClose = result.bars.at(-2)?.close ?? analysis.close;
  return {
    item: {
      symbol: stock.symbol,
      name: stock.name,
      kind: stock.kind,
      date: analysis.date,
      close: analysis.close,
      previousClose,
      changePercent: ((analysis.close - previousClose) / previousClose) * 100,
      sma: analysis.sma,
      upperBand: analysis.upperBand,
      lowerBand: analysis.lowerBand,
      standardDeviation: analysis.standardDeviation,
      bandPositionPercent: analysis.bandPosition * 100,
      signal: analysis.signal,
      isNewBreach: analysis.isNewBreach,
      isContinuingBreach: analysis.isContinuingBreach,
      distancePercent: analysis.distancePercent,
      currentRunStart: analysis.currentRunStart,
      lastBreachEvent: analysis.lastBreachEvent,
      history: result.history,
      statisticalContext: analysis.statisticalContext,
    },
    error,
  };
}

const token = process.env.TIINGO_API_TOKEN?.trim();
const results = await Promise.all(watchlist.map((stock) => buildItem(stock, token)));
const items = results.map((result) => result.item);
const errors = results.flatMap((result, index) => result.error ? [{ symbol: watchlist[index].symbol, message: result.error }] : []);
const isDemo = !token || errors.length > 0;
const payload = {
  source: token ? "tiingo" : "demo",
  sourceLabel: token ? "TIINGO EOD" : "SAMPLE MODE",
  isDemo,
  fetchedAt: new Date().toISOString(),
  asOf: items.map((item) => item.date).sort().at(-1),
  period: PERIOD,
  multiplier: MULTIPLIER,
  items,
  errors,
  notice: token
    ? errors.length ? "일부 종목을 불러오지 못해 예시 데이터로 보완했습니다." : ""
    : "실제 시세 API가 연결되기 전이라 예시 데이터로 화면을 보여드리고 있습니다.",
};

await mkdir(resolve("static/public/data"), { recursive: true });
await writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${items.length} market records (${payload.source}).`);
