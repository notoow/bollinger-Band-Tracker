import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const requestHost = forwardedHost ?? requestHeaders.get("host") ?? "localhost:3000";
  const safeHost = requestHost.replace(/[^a-zA-Z0-9.:[\]-]/g, "") || "localhost:3000";
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : safeHost.startsWith("localhost")
      ? "http"
      : "https";
  const metadataBase = new URL(`${protocol}://${safeHost}`);
  const title = "BANDWATCH — 볼린저밴드 이탈 추적";
  const description = "밴드 이탈만, 빠르게. 미국 관심 종목 10선을 매일 추적합니다.";
  const image = new URL("/og.png", metadataBase).toString();

  return {
    metadataBase,
    title,
    description:
      "VOO, SPY와 미국 대형주 8개 종목의 20일·2σ 볼린저밴드 이탈을 한눈에 추적합니다.",
    openGraph: {
      title,
      description,
      type: "website",
      locale: "ko_KR",
      images: [{ url: image, width: 1672, height: 941, alt: "BANDWATCH 볼린저밴드 이탈 레이더" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
