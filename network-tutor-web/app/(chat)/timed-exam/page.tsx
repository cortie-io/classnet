"use client";

import { CalendarRangeIcon, ClipboardCheckIcon, ListOrderedIcon, TimerIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { PageIntro, PageLoading, PageNotice } from "@/components/chat/page-intro";
import { Button } from "@/components/ui/button";
import { ExamRunner, type ExamStartResponse } from "@/components/exam/exam-runner";
import { toast } from "@/components/chat/toast";
import { loadJson } from "@/components/load-json";

interface TimedExamRow {
  id: number;
  title: string;
  duration_minutes: number | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  question_count: number;
  status: "upcoming" | "open" | "closed";
}

const STATUS_LABEL: Record<TimedExamRow["status"], string> = {
  upcoming: "예정",
  open: "응시 가능",
  closed: "마감",
};
const STATUS_CLASS: Record<TimedExamRow["status"], string> = {
  upcoming: "bg-amber-500/12 text-amber-700",
  open: "bg-emerald-500/12 text-emerald-700",
  closed: "bg-muted text-muted-foreground",
};

export default function TimedExamPage() {
  const [rows, setRows] = useState<TimedExamRow[] | null>(null);
  const [startingId, setStartingId] = useState<number | null>(null);
  const [start, setStart] = useState<ExamStartResponse | null>(null);

  useEffect(() => {
    loadJson("/api/exam/timed", setRows, { onError: () => setRows([]) });
  }, []);

  const begin = async (id: number) => {
    setStartingId(id);
    try {
      const res = await fetch(`/api/exam/timed/${id}/start`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "시작할 수 없습니다.");
      setStart(data);
    } catch (err) {
      toast({ type: "error", description: err instanceof Error ? err.message : "오류가 발생했습니다." });
    } finally {
      setStartingId(null);
    }
  };

  if (start) {
    return <ExamRunner proctored={false} start={start} />;
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
      <PageIntro
        description="선생님이 직접 출제해 배정한 시험이에요. 정해진 기간 안에만 응시할 수 있어요."
        icon={ClipboardCheckIcon}
        title="지정 시험"
      />

      {rows === null ? (
        <PageLoading />
      ) : rows.length === 0 ? (
        <PageNotice icon={ClipboardCheckIcon} title="아직 배정된 지정 시험이 없어요" />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <div
              className={`surface flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between ${r.status === "open" ? "border-primary/25" : ""}`}
              key={r.id}
            >
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 font-semibold text-[11.5px] ${STATUS_CLASS[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                  <span className="font-semibold text-[15px] text-foreground">{r.title}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <ListOrderedIcon className="size-3.5" />
                    {r.question_count}문제
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <TimerIcon className="size-3.5" />
                    {r.duration_minutes ? `제한시간 ${r.duration_minutes}분` : "제한시간 없음"}
                  </span>
                  {(r.scheduled_start || r.scheduled_end) && (
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarRangeIcon className="size-3.5" />
                      {r.scheduled_start ? new Date(r.scheduled_start).toLocaleString("ko-KR") : "제한 없음"}
                      {" ~ "}
                      {r.scheduled_end ? new Date(r.scheduled_end).toLocaleString("ko-KR") : "제한 없음"}
                    </span>
                  )}
                </div>
              </div>
              <Button
                className={`h-10 shrink-0 rounded-xl px-5 ${r.status === "open" ? "bg-brand" : ""}`}
                disabled={r.status !== "open" || startingId === r.id}
                onClick={() => begin(r.id)}
                variant={r.status === "open" ? "default" : "outline"}
              >
                {startingId === r.id ? "시작하는 중..." : r.status === "open" ? "응시 시작" : STATUS_LABEL[r.status]}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
