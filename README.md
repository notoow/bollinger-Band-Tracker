# BANDWATCH

VOO, SPY와 미국 대형주 8개 종목의 볼린저밴드 상·하단 이탈을 추적하는 한국어 웹 대시보드입니다.

## 추적 종목

- ETF: `VOO`, `SPY`
- 주식: `GOOGL`, `GOOG`, `AAPL`, `AMZN`, `META`, `TSLA`, `NVDA`, `MSFT`

## 판정 기준

- Tiingo 일별 조정 종가(분할·배당 반영)
- 20거래일 단순이동평균(SMA)
- 모집단 표준편차 × 2
- 종가가 상단보다 **클 때** 상단 이탈, 하단보다 **작을 때** 하단 이탈
- 밴드에 정확히 닿은 경우는 이탈로 판정하지 않음
- 밴드까지 1% 이내면 근접 신호로 표시

## 시작하기

Node.js 22.13 이상이 필요합니다.

```bash
npm install
copy .env.example .env.local
npm run dev
```

`.env.local`의 `TIINGO_API_TOKEN`에 본인의 Tiingo API 토큰을 입력하세요. 토큰이 없으면 앱은 데모 데이터로 실행됩니다. 토큰은 브라우저로 전달되지 않고 서버에서만 사용됩니다.

## 알림 채널

GitHub Pages 배포는 새 볼린저 이탈을 발견했을 때, GitHub Actions에 등록된 채널로 알림을 보냅니다. 필요한 채널만 GitHub 저장소의 `Settings → Secrets and variables → Actions`에 추가하면 됩니다.

- Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- Discord: `DISCORD_WEBHOOK_URL`
- Email (Resend): `RESEND_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO`

한 개 또는 세 채널 모두를 동시에 사용할 수 있습니다. 페이지 푸시 때는 중복 전송을 막고, 예약 실행 또는 수동 실행에서만 신규 이탈 알림을 발송합니다.

## Community comments

The public site uses GitHub Issues as a lightweight community wall. It reads comments from issues labeled `community` plus the `BANDWATCH Community Wall` issue, then shows the latest 50 comments newest-first.

Visitors can write comments directly inside the site. GitHub does not allow anonymous issue comments, so the first post requires a one-time GitHub account authorization.

1. Create a GitHub OAuth App at `Settings -> Developer settings -> OAuth Apps -> New OAuth App`.
2. Use the Pages URL for Homepage URL and Authorization callback URL: `https://notoow.github.io/bollinger-Band-Tracker/`.
3. Enable Device Flow in the OAuth App settings.
4. Save the public Client ID.
   - Local: put `VITE_GITHUB_CLIENT_ID=...` in `.env.local`.
   - GitHub Pages: add repository variable `VITE_GITHUB_CLIENT_ID` under `Settings -> Secrets and variables -> Actions -> Variables`.

Do not put a Client Secret in the static site. Device Flow only needs the public Client ID.

## 확인

```bash
npm test
npm run lint
```

## 데이터 사용 주의

Tiingo 무료 데이터는 개인 내부 사용 기준입니다. 공개 다중 사용자 서비스로 운영하려면 각 사용자가 자신의 토큰을 쓰는 방식이나 별도의 데이터 재배포 라이선스를 검토해야 합니다. 이 앱은 정보 제공용이며 투자 권유가 아닙니다.
