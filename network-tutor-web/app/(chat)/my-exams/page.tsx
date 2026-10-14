"use client";

import { BarChart3Icon, ChevronRightIcon, ClipboardListIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { loadJson } from "@/components/load-json";
import { PageIntro, PageLoading, PageNotice } from "@/components/chat/page-intro";
import { Button } from "@/components/ui/button";

interface AttemptSummary {
  id: number;
  status: string;
  score: number | null;
  startedAt: string;
  submittedAt: string | null;
  setKind: string | null;
  setTitle: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  in_progress: "진행 중",
  submitted: "제출 완료",
  auto_submitted: "시간 초과 자동 제출",
  invalidated: "무효 처리됨",
};

const STATUS_TONE: Record<string, string> = {
  in_progress: "bg-sky-500/12 text-sky-700",
  submitted: "bg-emerald-500/12 text-emerald-700",
  auto_submitted: "bg-amber-500/12 text-amber-700",
  invalidated: "bg-muted text-muted-foreground",
};

function scoreTone(score: number): string {
  // 60점 이상이면 합격선(브랜드 색), 아래면 주의(주황)로만 구분한다.
  if (score >= 60) return "text-primary";
  return "text-amber-600";
}

const KIND_LABEL: Record<string, string> = {
  practice_custom: "연습",
  mock: "모의고사",
  admin_timed: "지정 시험",
};

export default function MyExamsPage() {
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadJson("/api/exam/attempts", setAttempts).finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
      <PageIntro description="지금까지 응시한 연습·모의고사·시험 기록이에요. 눌러서 결과와 해설을 다시 볼 수 있어요." icon={BarChart3Icon} title="내 응시 기록" />
      {loading && <PageLoading />}
      {!loading && attempts.length === 0 && (
        <PageNotice description="문제 연습이나 모의고사를 풀면 여기에 기록이 쌓여요." icon={ClipboardListIcon} title="아직 응시한 기록이 없어요">
          <Button asChild className="rounded-xl bg-brand">
            <Link href="/practice">문제 연습 시작하기</Link>
          </Button>
        </PageNotice>
      )}
      <div className="flex flex-col gap-2.5">
        {attempts.map((a) => (
          <Link className="surface surface-hover group flex items-center gap-4 px-4 py-3.5 sm:px-5" href={`/exam/${a.id}`} key={a.id}>
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
              <ClipboardListIcon className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-[14px] text-foreground">
                {a.setTitle ?? (a.setKind ? KIND_LABEL[a.setKind] : "연습")}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                <span className={`rounded-full px-2 py-px font-semibold text-[11px] ${STATUS_TONE[a.status] ?? "bg-muted text-muted-foreground"}`}>
                  {STATUS_LABEL[a.status] ?? a.status}
                </span>
                {new Date(a.startedAt).toLocaleString("ko-KR")}
              </p>
            </div>
            {a.score !== null && (
              <p className={`font-extrabold text-[22px] tabular-nums tracking-tight ${scoreTone(a.score)}`}>
                {a.score}
                <span className="ml-0.5 font-medium text-[12px] text-muted-foreground">점</span>
              </p>
            )}
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </Link>
        ))}
      </div>
    </div>
  );
}
