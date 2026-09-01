"use client";

import { PanelLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";

// (chat) 라우트 그룹의 채팅 이외 페이지들(문제은행, 오답노트, 회차별 풀이 등)은 자체 헤더가 없어서,
// 모바일에서는(사이드바가 기본적으로 닫힌 오프캔버스 시트라) 사이드바를 열 방법이 아예 없었다
// (실사용 스크린샷으로 확인된 버그: "어떤 페이지에서든 사이드 패널 띄울수 있는 버튼은 무조건 있어야 해").
// 데스크톱은 사이드바 자체에 토글이 있어 트리거를 md:hidden으로 모바일 전용으로만 노출한다.
const PAGE_TITLES: [prefix: string, title: string][] = [
  ["/question-bank", "문제은행"],
  ["/practice", "문제 연습"],
  ["/mock-exam", "모의고사"],
  ["/timed-exam", "지정 시험"],
  ["/rounds", "기출문제 회차별 풀이"],
  ["/my-exams", "내 응시 기록"],
  ["/wrong-answers", "오답노트"],
  ["/my-report", "나의 학습 리포트"],
  ["/flashcards", "플래시카드"],
  ["/exam", "결과"],
];

export function pageTitleFor(pathname: string): string | undefined {
  const exact = PAGE_TITLES.find(([prefix]) => prefix === pathname);
  if (exact) return exact[1];
  const prefixed = PAGE_TITLES.find(([prefix]) => pathname.startsWith(`${prefix}/`));
  return prefixed?.[1];
}

export function PageHeader({ pathname }: { pathname: string }) {
  const { toggleSidebar } = useSidebar();
  const title = pageTitleFor(pathname);

  return (
    <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-border/60 border-b bg-background px-3 md:hidden">
      <Button className="shrink-0" onClick={toggleSidebar} size="icon-sm" variant="ghost">
        <PanelLeftIcon className="size-4" />
        <span className="sr-only">사이드바 열기</span>
      </Button>
      {title && <span className="truncate font-medium text-sm">{title}</span>}
    </header>
  );
}
