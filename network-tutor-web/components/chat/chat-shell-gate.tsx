"use client";

import { usePathname } from "next/navigation";
import { ActiveChatProvider } from "@/hooks/use-active-chat";
import { PageHeader } from "./page-header";
import { ChatShell } from "./shell";

// (chat) 라우트 그룹은 사이드바를 공유하려고 여러 페이지(문제 연습, 회차별 풀이, 오답노트 등)를
// 한 레이아웃 아래 모아둔 것뿐인데, ChatShell(채팅 UI 전체)이 조건 없이 항상 렌더링돼 있어서
// 채팅과 무관한 모든 페이지 위에 풀스크린 채팅 화면이 겹쳐 보이는 문제가 있었다(실측 확인됨:
// "모든 패널이 그래" — 정확히 이 증상). 실제 채팅 경로(/ , /chat/*)에서만 그리도록 막는다.
// 그 외 경로는 자체 헤더가 없어 모바일에서 사이드바를 열 방법이 아예 없었으므로, 대신 가벼운
// PageHeader(모바일 전용 사이드바 트리거)를 그린다.
export function ChatShellGate() {
  const pathname = usePathname();
  const isChatRoute = pathname === "/" || pathname.startsWith("/chat/");
  if (!isChatRoute) return <PageHeader pathname={pathname} />;
  return (
    <ActiveChatProvider>
      <ChatShell />
    </ActiveChatProvider>
  );
}
