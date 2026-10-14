"use client";

import { LockIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

// 공식 모의시험을 치르는 중인 학생이 채팅·문제은행 같은 다른 화면을 열면 화면 전체를 덮고 시험으로 돌려보낸다.
// 실제 차단은 서버가 한다(시험 중에는 다른 API가 423으로 거절된다) — 여기서는 왜 막혔는지 알려 주는 역할이다.
export function OfficialExamGuard() {
  const pathname = usePathname();
  const [active, setActive] = useState<{ examId: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/official-exams/active", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setActive(d?.active ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (!active) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-6 backdrop-blur-xl">
      <div className="surface max-w-sm p-7 text-center">
        <LockIcon className="mx-auto size-8 text-primary" />
        <p className="mt-3 font-bold text-[17px]">
          공식 모의시험 응시 중이에요
        </p>
        <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
          시험을 제출하기 전에는 다른 기능을 쓸 수 없어요. 시험 화면으로 돌아가
          이어서 풀어 주세요.
        </p>
        <Button asChild className="mt-5 h-11 w-full rounded-xl bg-brand">
          <Link href={`/exam-room/${active.examId}`}>시험으로 돌아가기</Link>
        </Button>
      </div>
    </div>
  );
}
