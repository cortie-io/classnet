import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";
import { SessionProvider } from "next-auth/react";

export const metadata: Metadata = {
  description: "네트워크관리사 2급 필기시험 대비 AI 튜터",
  metadataBase: new URL("https://classnet.chat"),
  title: {
    default: "classnet — 네트워크관리사 2급 AI 튜터",
    template: "%s · classnet",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "classnet",
  },
  applicationName: "classnet",
};

export const viewport = {
  maximumScale: 1,
  themeColor: "#ffffff",
};

const geist = Geist({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-geist",
});

const geistMono = Geist_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={`${geist.variable} ${geistMono.variable}`}
      lang="ko"
      suppressHydrationWarning
    >
      <head>
        {/* 한글 UI 글꼴. 사용하는 글자 범위만 나눠 받는 dynamic-subset 판이라 첫 로딩이 가볍다. */}
        <link
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        {/* 서비스 배경은 항상 밝은 톤으로 고정한다 — 기기가 다크 모드여도 다크 테마로 바꾸지 않는다. */}
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          disableTransitionOnChange
          enableSystem={false}
          forcedTheme="light"
        >
          <SessionProvider
            basePath={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/auth`}
          >
            <TooltipProvider>{children}</TooltipProvider>
          </SessionProvider>
          {/* 로그인 페이지((auth) 라우트 그룹)에는 자체 Toaster가 없어서 toast()를 호출해도 아무 데도
              렌더링이 안 되는 버그가 있었다(실측 확인됨) — 앱 전체를 덮는 루트 레이아웃에 하나만 둔다. */}
          <Toaster
            position="top-center"
            theme="light"
            toastOptions={{
              className:
                "!bg-card !text-foreground !border-border/50 !shadow-[var(--shadow-float)]",
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
