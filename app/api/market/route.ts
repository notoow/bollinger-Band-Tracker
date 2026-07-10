import { analyzeBars, type BandAnalysis, type PriceBar } from "@/lib/bollinger";

export const dynamic = "force-dynamic";

const PERIOD = 20;
const MULTIPLIER = 2;
const CACHE_TTL_MS = 15 * 60 * 1000;

const WATCHLIST = [
  { symbol: "VOO", name: "Vanguard S&P 500 ETF", kind: "ETF" as const, base: 610 },
  { symbol: "SPY", name: "SPDR S&P 500 ETF", kind: "ETF" as const, base: 665 },
  { symbol: "GOOGL", name: "알파벳 Class A", kind: "STOCK" as const, base: 215 },
  { symbol: "GOOG", name: "알파벳 Class C", kind: "STOCK" as const, base: 216 },
  { symbol: "AAPL", name: "애플", kind: "STOCK" as const, base: 255 },
  { symbol: "AMZN", name: "아마존", kind: "STOCK" as const, base: 235 },
  { symbol: "META", name: "메타 플랫폼스", kind: "STOCK" as const, base: 690 },
  { symbol: "TSLA", name: "테슬라", kind: "STOCK" as const, base: 360 },
  { symbol: "NVDA", name: "엔비디아", kind: "STOCK" as const, base: 190 },
  { symbol: "MSFT", name: "마이크로소프트", kind: "STOCK" as const, base: 535 },
] as const;

type Signal =
  | "UPPER_BREAK"
  | "LOWER_BREAK"
  | "NEAR_UPPER"
  | "NEAR_LOWER"
  | "INSIDE";

type MarketItem = ReturnType<typeof toMarketItem>;

type MarketPayload = {
  source: "tiingo" | "demo";
  sourceLabel: string;
  isDemo: boolean;
  fetchedAt: string;
  asOf: string;
  period: number;
  multiplier: number;
  items: MarketItem[];
  errors: Array<{ symbol: string; message: string }>;
  notice: string;
};

type CachedPayload = {
  expiresAt: number;
  payload: MarketPayload;
};

let memoryCache: CachedPayload | null = null;

function displaySignal(analysis: BandAnalysis): { signal: Signal; distancePercent: number } {
  if (analysis.state === "UPPER_BREACH") {
    return { signal: "UPPER_BREAK", distancePercent: analysis.distancePercent };
  }

  if (analysis.state === "LOWER_BREACH") {
    return { signal: "LOWER_BREAK", distancePercent: analysis.distancePercent };
  }

  const upperGap = Math.max(0, -(analysis.distanceToUpperPercent ?? Number.POSITIVE_INFINITY));
  const lowerGap = Math.max(0, analysis.distanceToLowerPercent ?? Number.POSITIVE_INFINITY);

  if (upperGap <= 1) return { signal: "NEAR_UPPER", distancePercent: upperGap };
  if (lowerGap <= 1) return { signal: "NEAR_LOWER", distancePercent: lowerGap };
  return { signal: "INSIDE", distancePercent: Math.min(upperGap, lowerGap) };
}

function toMarketItem(
  stock: (typeof WATCHLIST)[number],
  bars: PriceBar[],
  analysis: BandAnalysis,
) {
  const previousClose = bars.at(-2)?.close ?? analysis.close;
  const { signal, distancePercent } = displaySignal(analysis);

  return {
    symbol: stock.symbol,
    name: stock.name,
    kind: stock.kind,
    date: analysis.date,
    close: analysis.close,
    previousClose,
    changePercent: previousClose === 0 ? 0 : ((analysis.close - previousClose) / previousClose) * 100,
    sma: analysis.sma,
    upperBand: analysis.upperBand,
    lowerBand: analysis.lowerBand,
    standardDeviation: analysis.standardDeviation,
    bandPositionPercent: analysis.bandPosition * 100,
    signal,
    isNewBreach: analysis.isNewBreach,
    isContinuingBreach: analysis.isContinuingBreach,
    distancePercent,
    currentRunStart: analysis.currentRunStart,
    lastBreachEvent: analysis.lastBreachEvent
      ? {
          date: analysis.lastBreachEvent.date,
          direction: analysis.lastBreachEvent.state === "UPPER_BREACH" ? ("UPPER" as const) : ("LOWER" as const),
        }
      : null,
  };
}

function startDate() {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() - 14);
  return date.toISOString().slice(0, 10);
}

async function fetchTiingoBars(symbol: string, token: string): Promise<PriceBar[]> {
  const url = new URL(`https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol)}/prices`);
  url.searchParams.set("startDate", startDate());
  url.searchParams.set("resampleFreq", "daily");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Token ${token}`,
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("API 인증 정보를 확인해 주세요.");
    }
    if (response.status === 429) {
      throw new Error("API 호출 한도에 도달했습니다. 잠시 후 다시 확인해 주세요.");
    }
    throw new Error(`시세 제공처 응답 오류 (${response.status})`);
  }

  const raw = (await response.json()) as unknown;
  if (!Array.isArray(raw)) throw new Error("예상하지 못한 시세 응답입니다.");

  const bars: PriceBar[] = raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as { date?: unknown; close?: unknown; adjClose?: unknown };
    const adjusted = typeof row.adjClose === "number" ? row.adjClose : row.close;
    if (typeof row.date !== "string" || typeof adjusted !== "number") return [];
    return [{ date: row.date.slice(0, 10), close: adjusted }];
  });

  if (bars.length < PERIOD) throw new Error("볼린저밴드 계산에 필요한 종가가 부족합니다.");
  return bars.sort((left, right) => left.date.localeCompare(right.date));
}

function tradingDates(count: number) {
  const result: string[] = [];
  const cursor = new Date();
  cursor.setUTCHours(12, 0, 0, 0);

  while (result.length < count) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return result.reverse();
}

function symbolSeed(symbol: string) {
  return [...symbol].reduce((sum, character) => sum + character.charCodeAt(0), 0);
}

function demoBars(stock: (typeof WATCHLIST)[number]): PriceBar[] {
  const dates = tradingDates(180);
  const seed = symbolSeed(stock.symbol);
  const volatility = stock.symbol === "TSLA" || stock.symbol === "NVDA" ? 0.024 : 0.013;
  const drift = ((seed % 7) - 2) * 0.00008 + 0.00033;
  const bars = dates.map((date, index) => {
    const cycle = Math.sin(index * 0.19 + seed) * volatility;
    const micro = Math.sin(index * 0.57 + seed * 0.2) * volatility * 0.24;
    const trend = 1 + drift * (index - dates.length * 0.52);
    return { date, close: Number((stock.base * trend * (1 + cycle + micro)).toFixed(4)) };
  });

  const finalIndex = bars.length - 1;
  const previous = bars[finalIndex - 1].close;
  const shocks: Record<string, number> = {
    GOOGL: 1.095,
    TSLA: 0.86,
    NVDA: 1.13,
    META: 1.055,
    MSFT: 1.07,
  };
  if (shocks[stock.symbol]) bars[finalIndex].close = Number((previous * shocks[stock.symbol]).toFixed(4));

  return bars;
}

function latestDate(items: MarketItem[]) {
  return items.reduce((latest, item) => (item.date > latest ? item.date : latest), "");
}

async function livePayload(token: string): Promise<MarketPayload> {
  const settled = await Promise.allSettled(
    WATCHLIST.map(async (stock) => {
      const bars = await fetchTiingoBars(stock.symbol, token);
      const analysis = analyzeBars(bars, PERIOD, MULTIPLIER);
      if (!analysis) throw new Error("볼린저밴드 계산에 필요한 종가가 부족합니다.");
      return toMarketItem(stock, bars, analysis);
    }),
  );

  const items: MarketItem[] = [];
  const errors: Array<{ symbol: string; message: string }> = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      items.push(result.value);
    } else {
      errors.push({
        symbol: WATCHLIST[index].symbol,
        message: result.reason instanceof Error ? result.reason.message : "시세를 불러오지 못했습니다.",
      });
    }
  });

  if (!items.length) {
    throw new Error(errors[0]?.message ?? "시세 데이터를 불러오지 못했습니다.");
  }

  return {
    source: "tiingo",
    sourceLabel: "TIINGO EOD",
    isDemo: false,
    fetchedAt: new Date().toISOString(),
    asOf: latestDate(items),
    period: PERIOD,
    multiplier: MULTIPLIER,
    items,
    errors,
    notice: errors.length ? `${errors.length}개 종목의 최근 데이터를 불러오지 못했습니다.` : "",
  };
}

function demoPayload(): MarketPayload {
  const items = WATCHLIST.flatMap((stock) => {
    const bars = demoBars(stock);
    const analysis = analyzeBars(bars, PERIOD, MULTIPLIER);
    return analysis ? [toMarketItem(stock, bars, analysis)] : [];
  });

  return {
    source: "demo",
    sourceLabel: "SAMPLE MODE",
    isDemo: true,
    fetchedAt: new Date().toISOString(),
    asOf: latestDate(items),
    period: PERIOD,
    multiplier: MULTIPLIER,
    items,
    errors: [],
    notice: "실제 시세 API가 연결되기 전이라 예시 데이터로 화면을 보여드리고 있습니다.",
  };
}

function json(payload: MarketPayload) {
  return Response.json(payload, {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=900, stale-while-revalidate=1800",
    },
  });
}

export async function GET() {
  const now = Date.now();
  if (memoryCache && memoryCache.expiresAt > now) return json(memoryCache.payload);

  const token = process.env.TIINGO_API_TOKEN?.trim();
  if (!token) {
    const payload = demoPayload();
    memoryCache = { payload, expiresAt: now + CACHE_TTL_MS };
    return json(payload);
  }

  try {
    const payload = await livePayload(token);
    memoryCache = { payload, expiresAt: now + CACHE_TTL_MS };
    return json(payload);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "시세 데이터를 불러오지 못했습니다.",
      },
      { status: 502 },
    );
  }
}
