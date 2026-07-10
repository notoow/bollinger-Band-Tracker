import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const marketPath = resolve("static/public/data/market.json");
const statusPath = resolve("static/public/data/alerts.json");
const deliveryEnabled = process.env.ALERTS_DELIVERY_ENABLED === "true";

const config = {
  telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  discord: Boolean(process.env.DISCORD_WEBHOOK_URL),
  email: Boolean(
    process.env.RESEND_API_KEY &&
      process.env.ALERT_EMAIL_FROM &&
      process.env.ALERT_EMAIL_TO,
  ),
};

async function writeStatus(extra = {}) {
  await mkdir(resolve("static/public/data"), { recursive: true });
  await writeFile(
    statusPath,
    `${JSON.stringify({ ...config, checkedAt: new Date().toISOString(), ...extra }, null, 2)}\n`,
  );
}

const payload = JSON.parse(await readFile(marketPath, "utf8"));
const signals = payload.items.filter((item) => item.isNewBreach);

if (!deliveryEnabled || !signals.length) {
  await writeStatus({ sent: false, signalCount: signals.length });
  console.log(deliveryEnabled ? "No new breach alerts to send." : "Alert delivery skipped for this build.");
  process.exit(0);
}

const signalLines = signals.map((item) => {
  const direction = item.signal === "UPPER_BREAK" ? "상단 이탈" : "하단 이탈";
  const distance = Math.abs(item.distancePercent).toFixed(2);
  return `${item.symbol} ${direction} · $${item.close.toFixed(2)} · 밴드 대비 ${distance}%`;
});
const subject = `[BANDWATCH] 신규 이탈 ${signals.length}건`;
const text = `${subject}\n\n${signalLines.join("\n")}\n\nhttps://notoow.github.io/bollinger-Band-Tracker/`;
const html = `<h2>${subject}</h2><ul>${signalLines.map((line) => `<li>${line}</li>`).join("")}</ul><p><a href="https://notoow.github.io/bollinger-Band-Tracker/">BANDWATCH 열기</a></p>`;
const idempotencyKey = `bandwatch-${payload.asOf}-${signals.map((item) => item.symbol).sort().join("-")}`;

const deliveries = [];

if (config.telegram) {
  deliveries.push(
    fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    }).then(async (response) => ({ channel: "telegram", ok: response.ok, status: response.status })),
  );
}

if (config.discord) {
  deliveries.push(
    fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    }).then(async (response) => ({ channel: "discord", ok: response.ok, status: response.status })),
  );
}

if (config.email) {
  deliveries.push(
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "User-Agent": "bandwatch-github-actions/1.0",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from: process.env.ALERT_EMAIL_FROM,
        to: process.env.ALERT_EMAIL_TO.split(",").map((address) => address.trim()).filter(Boolean),
        subject,
        text,
        html,
      }),
    }).then(async (response) => ({ channel: "email", ok: response.ok, status: response.status })),
  );
}

const settled = await Promise.allSettled(deliveries);
const results = settled.map((result, index) =>
  result.status === "fulfilled"
    ? result.value
    : { channel: ["telegram", "discord", "email"][index] ?? "unknown", ok: false, status: 0 },
);
await writeStatus({ sent: results.some((result) => result.ok), signalCount: signals.length, results });

for (const result of results) {
  console.log(`${result.channel}: ${result.ok ? "sent" : `failed (${result.status})`}`);
}
