"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Signal =
  | "UPPER_BREAK"
  | "LOWER_BREAK"
  | "NEAR_UPPER"
  | "NEAR_LOWER"
  | "INSIDE";

type MarketItem = {
  symbol: string;
  name: string;
  kind: "ETF" | "STOCK" | "INDEX";
  date: string;
  close: number;
  previousClose: number;
  changePercent: number;
  sma: number;
  upperBand: number;
  lowerBand: number;
  standardDeviation: number;
  bandPositionPercent: number;
  signal: Signal;
  isNewBreach: boolean;
  isContinuingBreach: boolean;
  distancePercent: number;
  currentRunStart: string | null;
  lastBreachEvent: {
    date: string;
    direction: "UPPER" | "LOWER";
  } | null;
  statisticalContext?: {
    horizonDays: number;
    sampleSize: number;
    eventRate: number;
    medianReturn: number;
  } | null;
  history: Array<{
    date: string;
    close: number;
    sma: number;
    upperBand: number;
    lowerBand: number;
  }>;
};

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

type FilterKey = "ALL" | "BREAK" | "NEAR" | "INSIDE";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "ALL", label: "전체" },
  { key: "BREAK", label: "이탈" },
  { key: "NEAR", label: "1% 근접" },
  { key: "INSIDE", label: "밴드 안" },
];

const SIGNAL_PRIORITY: Record<Signal, number> = {
  UPPER_BREAK: 0,
  LOWER_BREAK: 1,
  NEAR_UPPER: 2,
  NEAR_LOWER: 3,
  INSIDE: 4,
};

function TickerLogo({ symbol }: { symbol: string }) {
  const [imageAvailable, setImageAvailable] = useState(true);

  return (
    <span className="ticker-avatar" aria-hidden="true">
      {imageAvailable ? (
        <img
          src={`${import.meta.env.BASE_URL}icons/${symbol}.png`}
          alt=""
          onError={() => setImageAvailable(false)}
        />
      ) : (
        symbol.slice(0, 2)
      )}
    </span>
  );
}

function signalLabel(signal: Signal) {
  switch (signal) {
    case "UPPER_BREAK":
      return "상단 이탈";
    case "LOWER_BREAK":
      return "하단 이탈";
    case "NEAR_UPPER":
      return "상단 근접";
    case "NEAR_LOWER":
      return "하단 근접";
    default:
      return "밴드 안";
  }
}

function signalTone(signal: Signal) {
  if (signal === "UPPER_BREAK") return "upper";
  if (signal === "LOWER_BREAK") return "lower";
  if (signal === "NEAR_UPPER" || signal === "NEAR_LOWER") return "near";
  return "inside";
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 100 ? 2 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function quoteValue(value: number, kind: MarketItem["kind"]) {
  if (kind === "INDEX") return value.toFixed(2);
  return money(value);
}

function chartSymbol(symbol: string) {
  return symbol === "VIX" ? "%5EVIX" : symbol;
}

function vixRegime(value: number | null | undefined) {
  if (!Number.isFinite(value)) return { label: "LOADING", className: "vix-loading" };
  if (value >= 30) return { label: "PANIC", className: "vix-panic" };
  if (value >= 25) return { label: "FEAR", className: "vix-fear" };
  if (value >= 20) return { label: "WATCH", className: "vix-watch" };
  if (value >= 15) return { label: "NORMAL", className: "vix-normal" };
  return { label: "CALM", className: "vix-calm" };
}

function vixBandRead(item: MarketItem | null | undefined) {
  if (!item) return "공포지수 연결 중";
  if (item.signal === "UPPER_BREAK") return "공포가 상단 밴드를 돌파";
  if (item.signal === "LOWER_BREAK") return "공포가 하단 밴드 아래";
  if (item.signal === "NEAR_UPPER") return "공포 상단 근접";
  if (item.signal === "NEAR_LOWER") return "공포 하단 근접";
  return "공포지수 정상 밴드 안";
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function markerPosition(item: MarketItem) {
  return Math.min(92, Math.max(8, item.bandPositionPercent));
}

function koreanDate(date: string) {
  const parsed = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Seoul",
  }).format(parsed);
}

function fetchedTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function detailSentence(item: MarketItem) {
  if (item.signal === "UPPER_BREAK") {
    return `종가가 상단 밴드를 ${Math.abs(item.distancePercent).toFixed(2)}% 웃돌고 있습니다.`;
  }
  if (item.signal === "LOWER_BREAK") {
    return `종가가 하단 밴드를 ${Math.abs(item.distancePercent).toFixed(2)}% 밑돌고 있습니다.`;
  }
  if (item.signal === "NEAR_UPPER") {
    return `상단 밴드까지 ${Math.abs(item.distancePercent).toFixed(2)}% 남았습니다.`;
  }
  if (item.signal === "NEAR_LOWER") {
    return `하단 밴드까지 ${Math.abs(item.distancePercent).toFixed(2)}% 남았습니다.`;
  }
  return "현재 종가는 볼린저밴드 정상 범위 안에 있습니다.";
}

function BandHistoryChart({ data }: { data: MarketItem["history"] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [range, setRange] = useState(65);
  const visibleData = useMemo(() => data.slice(-range), [data, range]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || visibleData.length < 2) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(bounds.width));
      const height = 188;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const padding = { top: 13, right: 8, bottom: 22, left: 8 };
      const values = visibleData.flatMap((point) => [point.close, point.upperBand, point.lowerBand]);
      const rawMin = Math.min(...values);
      const rawMax = Math.max(...values);
      const range = Math.max(rawMax - rawMin, rawMax * 0.03, 1);
      const min = rawMin - range * 0.1;
      const max = rawMax + range * 0.1;
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;
      const x = (index: number) => padding.left + (index / (visibleData.length - 1)) * chartWidth;
      const y = (value: number) => padding.top + ((max - value) / (max - min)) * chartHeight;

      context.strokeStyle = "rgba(143, 160, 180, 0.15)";
      context.lineWidth = 1;
      for (let row = 1; row < 4; row += 1) {
        const lineY = padding.top + (chartHeight / 4) * row;
        context.beginPath();
        context.moveTo(padding.left, lineY);
        context.lineTo(width - padding.right, lineY);
        context.stroke();
      }

      context.beginPath();
      visibleData.forEach((point, index) => {
        const pointX = x(index);
        const pointY = y(point.upperBand);
        index === 0 ? context.moveTo(pointX, pointY) : context.lineTo(pointX, pointY);
      });
      for (let index = visibleData.length - 1; index >= 0; index -= 1) {
        context.lineTo(x(index), y(visibleData[index].lowerBand));
      }
      context.closePath();
      context.fillStyle = "rgba(120, 201, 239, 0.09)";
      context.fill();

      const strokeSeries = (key: "upperBand" | "lowerBand" | "sma" | "close", color: string, width: number, dash: number[] = []) => {
        context.beginPath();
        context.setLineDash(dash);
        visibleData.forEach((point, index) => {
          const pointX = x(index);
          const pointY = y(point[key]);
          index === 0 ? context.moveTo(pointX, pointY) : context.lineTo(pointX, pointY);
        });
        context.strokeStyle = color;
        context.lineWidth = width;
        context.stroke();
        context.setLineDash([]);
      };

      strokeSeries("upperBand", "rgba(120, 201, 239, 0.58)", 1);
      strokeSeries("lowerBand", "rgba(120, 201, 239, 0.58)", 1);
      strokeSeries("sma", "rgba(143, 160, 180, 0.62)", 1, [4, 4]);
      strokeSeries("close", "#c8f55a", 2.25);

      const latest = visibleData.at(-1)!;
      context.beginPath();
      context.arc(x(visibleData.length - 1), y(latest.close), 4, 0, Math.PI * 2);
      context.fillStyle = "#c8f55a";
      context.fill();
      context.strokeStyle = "#07111e";
      context.lineWidth = 2;
      context.stroke();

      context.fillStyle = "#637287";
      context.font = "9px var(--font-geist-mono), monospace";
      context.textAlign = "left";
      context.fillText(koreanDate(visibleData[0].date), padding.left, height - 5);
      context.textAlign = "right";
      context.fillText(koreanDate(latest.date), width - padding.right, height - 5);
    };

    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [visibleData]);

  return (
    <>
      <div className="chart-range" aria-label="차트 기간 선택">
        {[{ label: "1W", days: 5 }, { label: "1M", days: 22 }, { label: "3M", days: 65 }, { label: "6M", days: 130 }, { label: "1Y", days: 252 }].map((option) => (
          <button key={option.days} type="button" className={range === option.days ? "active" : ""} onClick={() => setRange(option.days)}>{option.label}</button>
        ))}
      </div>
      <canvas ref={canvasRef} className="history-canvas" aria-label="볼린저 밴드 이력 차트" role="img" />
    </>
  );
}

type GitHubIssue = {
  number: number;
  html_url: string;
  title: string;
  comments: number;
  updated_at: string;
};

type GitHubIssueComment = {
  id: number;
  body: string;
  created_at: string;
  html_url: string;
  user: {
    login: string;
  } | null;
  issueTitle?: string;
};

type GitHubUser = {
  login: string;
};

type GitHubDeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};

type GitHubAccessTokenResponse = {
  access_token?: string;
  error?: string;
};

const communityRepo = "notoow/bollinger-Band-Tracker";
const communityWallIssueTitle = "BANDWATCH Community Wall";
const githubTokenStorageKey = "bandwatch-github-token";
const githubClientId = import.meta.env.VITE_GITHUB_CLIENT_ID as string | undefined;

function commentPreview(body: string) {
  const text = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_~|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "GitHub에 마크다운, 이미지 또는 첨부 댓글이 남겨져 있습니다.";
  return text.length > 220 ? `${text.slice(0, 220)}...` : text;
}

function githubHeaders(token?: string, hasBody = false) {
  return {
    Accept: "application/vnd.github+json",
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubJson<T>(url: string, init: RequestInit = {}, token?: string) {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...githubHeaders(token, Boolean(init.body)),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const message = response.status === 401 ? "GitHub login expired" : "GitHub request failed";
    throw new Error(message);
  }

  return (await response.json()) as T;
}

async function findCommunityIssues() {
  const titleParams = new URLSearchParams({
    q: `repo:${communityRepo} type:issue in:title "${communityWallIssueTitle}"`,
    per_page: "1",
  });
  const labelParams = new URLSearchParams({
    q: `repo:${communityRepo} type:issue label:community`,
    sort: "updated",
    order: "desc",
    per_page: "10",
  });

  const [titleResult, labelResult] = await Promise.all([
    githubJson<{ items?: GitHubIssue[] }>(`https://api.github.com/search/issues?${titleParams.toString()}`),
    githubJson<{ items?: GitHubIssue[] }>(`https://api.github.com/search/issues?${labelParams.toString()}`),
  ]);

  const byNumber = new Map<number, GitHubIssue>();
  for (const issue of [...(titleResult.items ?? []), ...(labelResult.items ?? [])]) {
    byNumber.set(issue.number, issue);
  }
  return Array.from(byNumber.values()).filter((item) => item.comments > 0);
}

function getStoredGithubToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(githubTokenStorageKey);
}

function setStoredGithubToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(githubTokenStorageKey, token);
  else window.localStorage.removeItem(githubTokenStorageKey);
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function requestGithubDeviceToken(onStatus: (message: string) => void) {
  if (!githubClientId) throw new Error("GitHub OAuth Client ID is missing");

  const deviceResponse = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json" },
    body: new URLSearchParams({
      client_id: githubClientId,
      scope: "public_repo",
    }),
  });

  if (!deviceResponse.ok) throw new Error("GitHub login failed");

  const device = (await deviceResponse.json()) as GitHubDeviceCodeResponse;
  const authUrl = device.verification_uri_complete ?? device.verification_uri;
  window.open(authUrl, "_blank", "noopener,noreferrer");
  onStatus(`GitHub 인증 창에서 코드 ${device.user_code}를 확인해 주세요. 승인되면 자동으로 댓글이 올라갑니다.`);

  let pollInterval = Math.max(device.interval || 5, 5) * 1000;
  const expiresAt = Date.now() + device.expires_in * 1000;

  while (Date.now() < expiresAt) {
    await wait(pollInterval);

    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new URLSearchParams({
        client_id: githubClientId,
        device_code: device.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    if (!tokenResponse.ok) throw new Error("GitHub login failed");

    const tokenResult = (await tokenResponse.json()) as GitHubAccessTokenResponse;
    if (tokenResult.access_token) return tokenResult.access_token;
    if (tokenResult.error === "authorization_pending") continue;
    if (tokenResult.error === "slow_down") {
      pollInterval += 5000;
      continue;
    }
    throw new Error(tokenResult.error || "GitHub login failed");
  }

  throw new Error("GitHub login expired");
}

async function fetchGithubUser(token: string) {
  return githubJson<GitHubUser>("https://api.github.com/user", {}, token);
}

async function ensureCommunityWallIssue(token: string) {
  const searchParams = new URLSearchParams({
    q: `repo:${communityRepo} type:issue in:title "${communityWallIssueTitle}"`,
    per_page: "1",
  });
  const found = await githubJson<{ items?: GitHubIssue[] }>(
    `https://api.github.com/search/issues?${searchParams.toString()}`,
    {},
    token,
  );
  const existing = found.items?.[0];
  if (existing) return existing;

  const issueBody = {
    title: communityWallIssueTitle,
    body: "BANDWATCH 웹 담벼락입니다. 사이트에서 작성한 댓글이 이 이슈의 댓글로 저장됩니다.",
    labels: ["community"],
  };

  try {
    return await githubJson<GitHubIssue>(
      `https://api.github.com/repos/${communityRepo}/issues`,
      { method: "POST", body: JSON.stringify(issueBody) },
      token,
    );
  } catch {
    return githubJson<GitHubIssue>(
      `https://api.github.com/repos/${communityRepo}/issues`,
      { method: "POST", body: JSON.stringify({ title: issueBody.title, body: issueBody.body }) },
      token,
    );
  }
}

function CommunityComments() {
  const [comments, setComments] = useState<GitHubIssueComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [commentsError, setCommentsError] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [githubUser, setGithubUser] = useState<string | null>(null);

  const loadComments = useCallback(async () => {
    setLoadingComments(true);
    setCommentsError(false);

    try {
      const issues = await findCommunityIssues();

      if (!issues.length) {
        setComments([]);
        return;
      }

      const commentsByIssue = await Promise.all(
        issues.map(async (item) => {
          const commentsResponse = await fetch(
            `https://api.github.com/repos/${communityRepo}/issues/${item.number}/comments?per_page=50`,
            { headers: { Accept: "application/vnd.github+json" } },
          );

          if (!commentsResponse.ok) throw new Error("GitHub comments fetch failed");

          const issueComments = (await commentsResponse.json()) as GitHubIssueComment[];
          return issueComments.map((comment) => ({ ...comment, issueTitle: item.title }));
        }),
      );

      setComments(
        commentsByIssue
          .flat()
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 50),
      );
    } catch {
      setCommentsError(true);
    } finally {
      setLoadingComments(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadComments(), 0);
    return () => window.clearTimeout(timer);
  }, [loadComments]);

  useEffect(() => {
    const token = getStoredGithubToken();
    if (!token) return;

    void fetchGithubUser(token)
      .then((user) => setGithubUser(user.login))
      .catch(() => {
        setStoredGithubToken(null);
        setGithubUser(null);
      });
  }, []);

  const submitComment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || posting) return;

    if (!githubClientId) {
      setAuthMessage("GitHub OAuth Client ID 설정이 필요합니다. README의 커뮤니티 설정을 먼저 넣어주세요.");
      return;
    }

    setPosting(true);
    setAuthMessage(null);

    try {
      let token = getStoredGithubToken();
      if (!token) {
        token = await requestGithubDeviceToken(setAuthMessage);
        setStoredGithubToken(token);
      }

      const user = await fetchGithubUser(token);
      setGithubUser(user.login);
      const issue = await ensureCommunityWallIssue(token);

      await githubJson<GitHubIssueComment>(
        `https://api.github.com/repos/${communityRepo}/issues/${issue.number}/comments`,
        { method: "POST", body: JSON.stringify({ body }) },
        token,
      );

      setDraft("");
      setAuthMessage("댓글을 담벼락에 붙였습니다.");
      await loadComments();
    } catch (error) {
      if (error instanceof Error && error.message.includes("expired")) {
        setStoredGithubToken(null);
        setGithubUser(null);
        setAuthMessage("GitHub 로그인이 만료됐습니다. 다시 한 번 눌러서 인증해 주세요.");
      } else {
        setAuthMessage("댓글 작성에 실패했습니다. GitHub 인증 또는 Issues 권한을 확인해 주세요.");
      }
    } finally {
      setPosting(false);
    }
  };

  return (
    <section className="community-panel" id="community">
      <div className="community-copy">
        <div>
          <p className="section-kicker">COMMUNITY</p>
          <h2>시장 얘기 같이 보기</h2>
        </div>
        <p>GitHub 계정으로 남긴 커뮤니티 댓글을 최신순으로 모아 보여줍니다.</p>
      </div>
      <div className="comments-box">
        <div className="comments-toolbar">
          <span>{comments.length ? `최근 댓글 ${comments.length}개` : "최근 댓글"}</span>
          <div>
            <button type="button" onClick={() => void loadComments()} disabled={loadingComments}>
              {loadingComments ? "확인 중" : "새로고침"}
            </button>
          </div>
        </div>

        <form className="comment-compose" onSubmit={submitComment}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={1200}
            placeholder={githubClientId ? "시장 생각, 종목 메모, 오늘의 밴드 해석을 편하게 남겨주세요." : "GitHub OAuth Client ID를 설정하면 여기서 바로 댓글을 쓸 수 있습니다."}
            disabled={posting || !githubClientId}
          />
          <div className="comment-compose-footer">
            <span>
              {githubUser ? `@${githubUser}로 작성합니다.` : githubClientId ? "GitHub 계정으로 1회 인증 후 바로 작성됩니다." : "VITE_GITHUB_CLIENT_ID 설정이 필요합니다."}
            </span>
            <div>
              {githubUser && (
                <button
                  type="button"
                  className="comment-ghost-button"
                  onClick={() => {
                    setStoredGithubToken(null);
                    setGithubUser(null);
                    setAuthMessage("로그아웃했습니다.");
                  }}
                  disabled={posting}
                >
                  로그아웃
                </button>
              )}
              <button type="submit" disabled={posting || !draft.trim() || !githubClientId}>
                {posting ? "등록 중..." : githubUser ? "댓글 달기" : "GitHub 로그인하고 댓글 달기"}
              </button>
            </div>
          </div>
          {authMessage && <p className="comment-auth-message">{authMessage}</p>}
        </form>

        {loadingComments ? (
          <div className="comment-skeleton" role="status">
            <span />
            <span />
            <span />
          </div>
        ) : commentsError ? (
          <div className="comment-empty">
            <strong>댓글을 불러오지 못했습니다.</strong>
            <p>GitHub API 제한이 걸렸을 수 있어요. 버튼으로 GitHub 이슈에서 바로 확인할 수 있습니다.</p>
          </div>
        ) : comments.length ? (
          <div className="comment-list">
            {comments.map((comment) => (
              <article className="comment-item" key={comment.id}>
                <span className="comment-avatar">{comment.user?.login.slice(0, 1).toUpperCase() ?? "?"}</span>
                <span>
                  <strong>{comment.user?.login ?? "GitHub user"}</strong>
                  <small>{fetchedTime(comment.created_at)}</small>
                  {comment.issueTitle && <em>{comment.issueTitle}</em>}
                  <p>{commentPreview(comment.body)}</p>
                </span>
              </article>
            ))}
          </div>
        ) : (
          <div className="comment-empty">
            <strong>아직 표시할 커뮤니티 댓글이 없습니다.</strong>
            <p>커뮤니티 라벨이 붙은 GitHub 이슈 댓글이 생기면 이곳에 최신순으로 표시됩니다.</p>
          </div>
        )}
      </div>
    </section>
  );
}

const marketDataUrl = `${import.meta.env.BASE_URL}data/market.json`;

export function BandDashboard() {
  const [payload, setPayload] = useState<MarketPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [query, setQuery] = useState("");
  const [alertsEnabled, setAlertsEnabled] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem("bandwatch-alerts") === "on",
  );
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async (manual = false) => {
    manual ? setRefreshing(true) : setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${marketDataUrl}${manual ? `?t=${Date.now()}` : ""}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as MarketPayload & { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "시세 데이터를 불러오지 못했습니다.");
      }

      setPayload(data);
      setSelectedSymbol((current) => {
        if (current && data.items.some((item) => item.symbol === current)) return current;
        return (
          data.items.find((item) => item.isNewBreach)?.symbol ??
          data.items.find((item) => item.signal.includes("BREAK"))?.symbol ??
          data.items[0]?.symbol ??
          null
        );
      });
      if (manual) setToast("최신 종가를 확인했습니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "알 수 없는 오류가 발생했습니다.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const firstLoad = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 15 * 60 * 1000);
    return () => {
      window.clearTimeout(firstLoad);
      window.clearInterval(interval);
    };
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!alertsEnabled || !payload || payload.isDemo || !("Notification" in window)) return;
    if (window.Notification.permission !== "granted") return;

    const sent = new Set<string>(
      JSON.parse(window.localStorage.getItem("bandwatch-sent") || "[]") as string[],
    );

    for (const item of payload.items.filter((candidate) => candidate.isNewBreach)) {
      const key = `${item.symbol}:${item.signal}:${item.date}`;
      if (sent.has(key)) continue;

      new window.Notification(`${item.symbol} ${signalLabel(item.signal)}`, {
        body: `${quoteValue(item.close, item.kind)} · ${detailSentence(item)}`,
      });
      sent.add(key);
    }

    window.localStorage.setItem("bandwatch-sent", JSON.stringify([...sent].slice(-60)));
  }, [alertsEnabled, payload]);

  const requestAlerts = async () => {
    if (!("Notification" in window)) {
      setToast("이 브라우저는 알림을 지원하지 않습니다.");
      return;
    }

    if (alertsEnabled) {
      setAlertsEnabled(false);
      window.localStorage.setItem("bandwatch-alerts", "off");
      setToast("브라우저 알림을 껐습니다.");
      return;
    }

    const permission = await window.Notification.requestPermission();
    if (permission === "granted") {
      setAlertsEnabled(true);
      window.localStorage.setItem("bandwatch-alerts", "on");
      setToast("새 이탈 신호를 알려드릴게요.");
    } else {
      setToast("브라우저에서 알림 권한을 허용해 주세요.");
    }
  };

  const sortedItems = useMemo(() => {
    if (!payload) return [];
    return [...payload.items].sort((a, b) => {
      if (a.isNewBreach !== b.isNewBreach) return a.isNewBreach ? -1 : 1;
      return SIGNAL_PRIORITY[a.signal] - SIGNAL_PRIORITY[b.signal];
    });
  }, [payload]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return sortedItems.filter((item) => {
      const matchesQuery =
        !normalized ||
        item.symbol.toLowerCase().includes(normalized) ||
        item.name.toLowerCase().includes(normalized);
      const matchesFilter =
        filter === "ALL" ||
        (filter === "BREAK" && item.signal.includes("BREAK")) ||
        (filter === "NEAR" && item.signal.includes("NEAR")) ||
        (filter === "INSIDE" && item.signal === "INSIDE");
      return matchesQuery && matchesFilter;
    });
  }, [filter, query, sortedItems]);

  const selected =
    sortedItems.find((item) => item.symbol === selectedSymbol) ?? sortedItems[0] ?? null;

  const counts = useMemo(() => {
    return sortedItems.reduce(
      (result, item) => {
        if (item.signal === "UPPER_BREAK") result.upper += 1;
        else if (item.signal === "LOWER_BREAK") result.lower += 1;
        else if (item.signal.includes("NEAR")) result.near += 1;
        else result.inside += 1;
        if (item.isNewBreach) result.newSignals += 1;
        return result;
      },
      { upper: 0, lower: 0, near: 0, inside: 0, newSignals: 0 },
    );
  }, [sortedItems]);

  const vixItem = sortedItems.find((item) => item.symbol === "VIX") ?? null;
  const vixMood = vixRegime(vixItem?.close);
  const vixPosition = vixItem ? Math.min(100, Math.max(0, vixItem.bandPositionPercent)) : 50;

  return (
    <main className="dashboard-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar">
        <a className="brand" href="#top" aria-label="BANDWATCH 홈">
          <span className="brand-mark">BW</span>
          <span>BANDWATCH</span>
        </a>
        <div className="topbar-actions">
          <a className="community-link" href="#community">
            커뮤니티
          </a>
          <button className={`utility-button ${alertsEnabled ? "is-active" : ""}`} onClick={requestAlerts}>
            <span className="button-dot" />
            {alertsEnabled ? "알림 켜짐" : "알림 켜기"}
          </button>
          <button
            className="refresh-button"
            onClick={() => void load(true)}
            disabled={refreshing}
          >
            <span aria-hidden="true">↻</span>
            {refreshing ? "확인 중" : "새로고침"}
          </button>
        </div>
      </header>

      <section className={`hero ${vixMood.className}`} id="top">
        <div className="hero-vix-backdrop" aria-label={vixItem ? `VIX ${quoteValue(vixItem.close, vixItem.kind)} ${vixMood.label}` : "VIX loading"}>
          <div className="vix-backdrop-header">
            <span>VIX FEAR INDEX</span>
            <strong>{vixMood.label}</strong>
          </div>
          <div className="vix-backdrop-value">
            <span>VIX</span>
            <strong>{vixItem ? quoteValue(vixItem.close, vixItem.kind) : "—"}</strong>
          </div>
          <div className="vix-backdrop-meta">
            <span className={vixItem && vixItem.changePercent >= 0 ? "positive" : "negative"}>
              {vixItem ? signed(vixItem.changePercent) : "—"}
            </span>
            <span>{vixBandRead(vixItem)}</span>
            <span>{vixItem ? `${koreanDate(vixItem.date)} 종가` : "데이터 연결 중"}</span>
          </div>
          <div className="vix-backdrop-meter" aria-hidden="true">
            <i />
            <b style={{ left: `${vixPosition}%` }} />
          </div>
        </div>
        <div className="hero-copy">
          <p className="eyebrow">US MARKET · DAILY CLOSE</p>
          <h1>밴드 이탈만,<br /><span>빠르게.</span></h1>
          <p className="hero-description">
            VOO와 SPY, VIX 공포지수, 미국 대형주 8개를 20일 이동평균과 2σ 기준으로 추적합니다.
            신호가 생기면 복잡한 차트보다 먼저 보여드립니다.
          </p>
        </div>

        <div className="hero-status" aria-live="polite">
          <div className="status-orbit">
            <div className="orbit-ring orbit-ring-one" />
            <div className="orbit-ring orbit-ring-two" />
            <div className={`signal-core ${counts.newSignals ? "has-signal" : ""}`}>
              <strong>{loading ? "—" : counts.newSignals}</strong>
              <span>NEW SIGNAL</span>
            </div>
          </div>
          <div className="source-line">
            <span className={`live-dot ${payload?.isDemo ? "is-demo" : ""}`} />
            {payload ? `${payload.sourceLabel} · ${koreanDate(payload.asOf)} 종가` : "데이터 연결 중"}
          </div>
        </div>
      </section>

      {payload?.isDemo && (
        <div className="demo-banner" role="status">
          <span>DEMO DATA</span>
          <p>{payload.notice}</p>
        </div>
      )}

      {error && (
        <div className="error-banner" role="alert">
          <div><strong>데이터 연결을 확인해 주세요.</strong><p>{error}</p></div>
          <button onClick={() => void load(true)}>다시 시도</button>
        </div>
      )}

      <section className="summary-grid" aria-label="신호 요약">
        <article className="summary-card upper-card">
          <div><span>상단 이탈</span><strong>{loading ? "—" : counts.upper}</strong></div>
          <p>강한 모멘텀 구간</p>
        </article>
        <article className="summary-card lower-card">
          <div><span>하단 이탈</span><strong>{loading ? "—" : counts.lower}</strong></div>
          <p>과매도 가능 구간</p>
        </article>
        <article className="summary-card near-card">
          <div><span>밴드 1% 이내</span><strong>{loading ? "—" : counts.near}</strong></div>
          <p>다음 신호 관찰</p>
        </article>
        <article className="summary-card inside-card">
          <div><span>정상 범위</span><strong>{loading ? "—" : counts.inside}</strong></div>
          <p>밴드 안에서 움직임</p>
        </article>
      </section>

      <section className="workspace">
        <div className="watchlist-panel">
          <div className="section-heading">
            <div>
              <p className="section-kicker">WATCHLIST / {sortedItems.length}</p>
              <h2>관심 종목</h2>
            </div>
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <span className="sr-only">종목 검색</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="티커 또는 종목명"
              />
            </label>
          </div>

          <div className="filter-row" role="tablist" aria-label="종목 상태 필터">
            {FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={filter === option.key}
                className={filter === option.key ? "is-selected" : ""}
                onClick={() => setFilter(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="watch-table">
            <div className="watch-head" aria-hidden="true">
              <span>종목</span><span>상태</span><span>종가 / 등락</span><span>밴드 위치</span>
            </div>

            {loading && !payload ? (
              <div className="loading-list" role="status" aria-label="종목 데이터를 불러오는 중">
                {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
              </div>
            ) : filteredItems.length ? (
              <div className="watch-rows">
                {filteredItems.map((item) => {
                  const tone = signalTone(item.signal);
                  const marker = Math.min(100, Math.max(0, item.bandPositionPercent));
                  return (
                    <button
                      key={item.symbol}
                      className={`watch-row ${selected?.symbol === item.symbol ? "is-current" : ""}`}
                      onClick={() => setSelectedSymbol(item.symbol)}
                      aria-label={`${item.symbol} ${item.name}, ${signalLabel(item.signal)}`}
                    >
                      <span className="ticker-cell">
                        <TickerLogo symbol={item.symbol} />
                        <span><strong>{item.symbol}</strong><small>{item.name}</small></span>
                      </span>
                      <span className={`signal-pill ${tone}`}>
                        {item.isNewBreach && <i>NEW</i>}
                        {signalLabel(item.signal)}
                      </span>
                      <span className="price-cell">
                        <strong>{quoteValue(item.close, item.kind)}</strong>
                        <small className={item.changePercent >= 0 ? "positive" : "negative"}>
                          {signed(item.changePercent)}
                        </small>
                      </span>
                      <span className="mini-band" aria-label={`밴드 위치 ${item.bandPositionPercent.toFixed(0)}%`}>
                        <i className="mini-zone" />
                        <i className={`mini-marker ${tone}`} style={{ left: `${marker}%` }} />
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">조건에 맞는 종목이 없습니다.</div>
            )}
          </div>
        </div>

        <aside className="detail-panel" aria-live="polite">
          {selected ? (
            <>
              <div className="detail-topline">
                <span className="detail-kind">{selected.kind}</span>
                <span>{koreanDate(selected.date)} 종가</span>
              </div>
              <div className="detail-title">
                <div><p>{selected.name}</p><h2>{selected.symbol}</h2></div>
                <div className="detail-price">
                  <strong>{quoteValue(selected.close, selected.kind)}</strong>
                  <span className={selected.changePercent >= 0 ? "positive" : "negative"}>
                    {signed(selected.changePercent)}
                  </span>
                </div>
              </div>

              <div className={`detail-signal ${signalTone(selected.signal)}`}>
                <div>
                  <span>{selected.isNewBreach ? "NEW BREAKOUT" : "CURRENT POSITION"}</span>
                  <strong>{signalLabel(selected.signal)}</strong>
                </div>
                <p>{detailSentence(selected)}</p>
              </div>

              <div className="band-visual">
                <div className="band-caption"><span>LOWER</span><span>20D SMA</span><span>UPPER</span></div>
                <div className="band-track">
                  <span className="track-fill" />
                  <span className="track-mid" />
                  <span
                    className={`price-marker ${signalTone(selected.signal)}`}
                    style={{ left: `${markerPosition(selected)}%` }}
                  >
                    <i />
                    <b>{quoteValue(selected.close, selected.kind)}</b>
                  </span>
                </div>
                <div className="band-values">
                  <strong>{quoteValue(selected.lowerBand, selected.kind)}</strong>
                  <strong>{quoteValue(selected.sma, selected.kind)}</strong>
                  <strong>{quoteValue(selected.upperBand, selected.kind)}</strong>
                </div>
              </div>

              <div className="history-section">
                <div className="history-heading">
                  <div>
                    <span>BAND HISTORY</span>
                    <strong>종가 · 20일선 · 상하단 밴드</strong>
                  </div>
                  <a
                    href={`https://finance.yahoo.com/quote/${chartSymbol(selected.symbol)}/chart`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    전체 차트 ↗
                  </a>
                </div>
                <BandHistoryChart data={selected.history} />
              </div>

              <section className="context-card" aria-label="통계 참고">
                <div className="context-heading">
                  <span>STATISTICAL CONTEXT</span>
                  <strong>통계 참고 · 투자 추천 아님</strong>
                </div>
                {selected.statisticalContext ? (
                  <div className="context-grid">
                    <div>
                      <span>{selected.signal.includes("NEAR") ? `${selected.statisticalContext.horizonDays}일 내 이탈` : `${selected.statisticalContext.horizonDays}일 내 밴드 복귀`}</span>
                      <strong>{selected.statisticalContext.eventRate.toFixed(0)}%</strong>
                    </div>
                    <div>
                      <span>{selected.statisticalContext.horizonDays}일 중앙 수익률</span>
                      <strong className={selected.statisticalContext.medianReturn >= 0 ? "positive" : "negative"}>{signed(selected.statisticalContext.medianReturn)}</strong>
                    </div>
                    <p>최근 약 1년의 유사 구간 {selected.statisticalContext.sampleSize}회를 비교한 결과입니다. 미래를 예측하거나 매수·매도를 권유하지 않습니다.</p>
                  </div>
                ) : <p className="context-empty">유사 구간 표본이 3회 미만이라 통계 값을 표시하지 않습니다.</p>}
              </section>

              <div className="metric-grid">
                <div><span>밴드 폭</span><strong>{(((selected.upperBand - selected.lowerBand) / selected.sma) * 100).toFixed(2)}%</strong></div>
                <div><span>표준편차</span><strong>{selected.standardDeviation.toFixed(2)}</strong></div>
                <div><span>이탈 시작</span><strong>{selected.currentRunStart ? koreanDate(selected.currentRunStart) : "—"}</strong></div>
                <div><span>최근 이탈</span><strong>{selected.lastBreachEvent ? koreanDate(selected.lastBreachEvent.date) : "없음"}</strong></div>
              </div>

              <div className="detail-note">
                <span>판정 기준</span>
                <p>조정 종가가 상단보다 크거나 하단보다 작을 때만 이탈로 판정합니다. 밴드에 닿은 경우는 정상 범위입니다.</p>
              </div>
            </>
          ) : (
            <div className="detail-empty">종목을 선택하면 밴드 위치를 자세히 보여드립니다.</div>
          )}
        </aside>
      </section>

      <CommunityComments />

      <footer>
        <div>
          <strong>BANDWATCH</strong>
          <p>20일 이동평균 · 모집단 표준편차 · 2σ · 조정 종가 기준</p>
        </div>
        <div className="footer-meta">
          <p>{payload ? `마지막 확인 ${fetchedTime(payload.fetchedAt)}` : "데이터 확인 중"}</p>
          <p>{payload?.source === "tiingo" ? "Data by Tiingo + Cboe" : "데모 데이터 · 실제 투자 판단용 아님"}</p>
        </div>
        <p className="disclaimer">본 서비스는 정보 제공용이며 투자 권유가 아닙니다. 미국 시장 종가 반영에는 지연이 있을 수 있습니다.</p>
      </footer>

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
