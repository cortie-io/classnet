"use client";

import { useEffect, useState } from "react";
import { CalendarCheck2Icon } from "lucide-react";

export function ExamCountdown() {
  const [exam, setExam] = useState<{ dday: number; date: Date } | null>(null);

  useEffect(() => {
    fetch("/api/settings/exam-date")
      .then((r) => r.json())
      .then((d) => {
        if (!d.examDate) return;
        const target = new Date(`${d.examDate}T00:00:00`);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diffDays = Math.round(
          (target.getTime() - today.getTime()) / 86_400_000
        );
        setExam({ dday: diffDays, date: target });
      })
      .catch(() => undefined);
  }, []);

  if (exam === null) return null;
  const { dday, date } = exam;

  return (
    <div className="mx-2 mt-1 mb-1.5 flex items-center gap-3 rounded-xl border border-primary/10 bg-brand-soft px-3 py-2.5 group-data-[collapsible=icon]:hidden">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-primary shadow-[var(--shadow-card)]">
        <CalendarCheck2Icon className="size-[18px]" />
      </div>
      <div className="min-w-0 leading-tight">
        <p className="truncate font-medium text-[11px] text-sidebar-foreground/60">
          네트워크관리사 2급 필기
        </p>
        <p className="mt-0.5 flex items-baseline gap-1.5">
          <span className="font-extrabold text-[16px] text-foreground tabular-nums tracking-tight">
            {dday > 0 ? `D-${dday}` : dday === 0 ? "D-DAY" : "시험 종료"}
          </span>
          <span className="truncate text-[11.5px] text-sidebar-foreground/55">
            {dday === 0
              ? "오늘이 시험일이에요!"
              : dday < 0
                ? `${-dday}일 지났어요`
                : `${date.getMonth() + 1}월 ${date.getDate()}일`}
          </span>
        </p>
      </div>
    </div>
  );
}
