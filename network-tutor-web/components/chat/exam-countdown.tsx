"use client";

import { useEffect, useState } from "react";
import { CalendarIcon } from "lucide-react";

export function ExamCountdown() {
  const [dday, setDday] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/settings/exam-date")
      .then((r) => r.json())
      .then((d) => {
        if (!d.examDate) return;
        const target = new Date(`${d.examDate}T00:00:00`);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
        setDday(diffDays);
      })
      .catch(() => undefined);
  }, []);

  if (dday === null) return null;

  return (
    <div className="mx-2 mb-1 flex items-center gap-1.5 rounded-lg border border-sidebar-border px-2.5 py-1.5 text-[12px] text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">
      <CalendarIcon className="size-3.5" />
      <span>{dday > 0 ? `시험까지 D-${dday}` : dday === 0 ? "오늘이 시험일입니다" : `시험일이 ${-dday}일 지났습니다`}</span>
    </div>
  );
}
