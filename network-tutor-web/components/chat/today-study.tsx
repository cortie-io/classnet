"use client";

import { FlameIcon, PlayIcon, RepeatIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { attemptTitle, type StudySummary } from "@/lib/study-summary";

// 홈 인사말 아래 "오늘의 학습" 한 줄 — 연속 학습일, 오늘 푼 문제, 오늘 복습할 오답, 풀다 만 문제 이어 하기.
// 처음 쓰는 학생(기록 없음)에게는 아무것도 보이지 않는다.
export function TodayStudy() {
  const [s, setS] = useState<StudySummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/exam/study-summary")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && d && setS(d))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!s) {
    return null;
  }
  const hasHistory =
    s.streakDays > 0 ||
    s.todayAnswered > 0 ||
    s.unfinished !== null ||
    s.review.dueCount + s.review.waitingCount + s.review.masteredCount > 0;
  if (!hasHistory) {
    return null;
  }

  const chip =
    "pointer-events-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors";

  return (
    <div className="mt-5 flex max-w-xl flex-wrap items-center justify-center gap-2">
      <span
        className={`${chip} border-border bg-card text-muted-foreground`}
        title="문제를 풀었거나 교재를 읽은 날이 이어진 날수"
      >
        <FlameIcon
          className={`size-3.5 ${s.studiedToday ? "text-orange-500" : "text-muted-foreground/60"}`}
        />
        {s.streakDays > 0 ? `${s.streakDays}일 연속` : "오늘 시작해요"}
        {s.todayAnswered > 0 && (
          <span className="text-muted-foreground/80">
            · 오늘 {s.todayCorrect}/{s.todayAnswered}
          </span>
        )}
      </span>
      {s.review.dueCount > 0 && (
        <Link
          className={`${chip} border-primary/30 bg-accent font-semibold text-primary hover:bg-primary hover:text-primary-foreground`}
          href="/review"
        >
          <RepeatIcon className="size-3.5" />
          오늘의 복습 {s.review.dueCount}문제
        </Link>
      )}
      {s.unfinished ? (
        <Link
          className={`${chip} border-border bg-card text-foreground hover:border-primary/40 hover:bg-accent`}
          href={`/exam/${s.unfinished.attemptId}`}
        >
          <PlayIcon className="size-3.5 text-primary" />
          이어서 풀기 · {attemptTitle(s.unfinished.title)}{" "}
          {s.unfinished.answered}/{s.unfinished.total}
        </Link>
      ) : null}
    </div>
  );
}
