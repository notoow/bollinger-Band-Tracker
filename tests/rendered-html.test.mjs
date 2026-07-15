import assert from "node:assert/strict";
import test from "node:test";

async function worker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: builtWorker } = await import(workerUrl.href);
  return builtWorker;
}

function runtimeEnv() {
  return {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
  };
}

function executionContext() {
  return {
    waitUntil() {},
    passThroughOnException() {},
  };
}

test("server-renders the BANDWATCH dashboard", async () => {
  const builtWorker = await worker();
  const response = await builtWorker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    runtimeEnv(),
    executionContext(),
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>BANDWATCH — 볼린저밴드 이탈 추적<\/title>/i);
  assert.match(html, /BANDWATCH/);
  assert.match(html, /밴드 이탈만/);
  assert.match(html, /20일 이동평균/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("market endpoint returns eleven safe demo analyses without a token", async () => {
  const builtWorker = await worker();
  const response = await builtWorker.fetch(
    new Request("http://localhost/api/market", { headers: { accept: "application/json" } }),
    runtimeEnv(),
    executionContext(),
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.source, "demo");
  assert.equal(payload.items.length, 11);
  assert.deepEqual(
    payload.items.map((item) => item.symbol).sort(),
    ["AAPL", "AMZN", "GOOG", "GOOGL", "META", "MSFT", "NVDA", "SPY", "TSLA", "VIX", "VOO"],
  );
  assert.ok(payload.items.every((item) => Number.isFinite(item.upperBand)));
  assert.ok(payload.items.some((item) => item.signal === "UPPER_BREAK"));
  assert.ok(payload.items.some((item) => item.signal === "LOWER_BREAK"));
});
