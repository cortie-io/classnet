"use client";

import { useEffect, useState } from "react";
import { ExamRunner, type ExamStartResponse } from "@/components/exam/exam-runner";
import { toast } from "@/components/chat/toast";

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
  upcoming: "bg-amber-500/10 text-amber-600",
  open: "bg-emerald-500/10 text-emerald-600",
  closed: "bg-muted text-muted-foreground",
};

export default function TimedExamPage() {
  const [rows, setRows] = useState<TimedExamRow[] | null>(null);
  const [startingId, setStartingId] = useState<number | null>(null);
  const [start, setStart] = useState<ExamStartResponse | null>(null);

  useEffect(() => {
    fetch("/api/exam/timed")
      .then((r) => r.json())
      .then(setRows)
      .catch(() => setRows([]));
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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-3 py-6 sm:px-4 sm:py-8">
      <div>
        <h1 className="font-semibold text-xl">지정 시험</h1>
        <p className="text-muted-foreground text-sm">선생님이 직접 출제해 배정한 시험입니다. 정해진 기간 안에만 응시할 수 있습니다.</p>
      </div>

      {rows === null ? (
        <p className="text-muted-foreground text-sm">불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">아직 배정된 지정 시험이 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((r) => (
            <div
              className="flex flex-col gap-2 rounded-xl border border-border/50 bg-card p-4 shadow-[var(--shadow-card)] sm:flex-row sm:items-center sm:justify-between"
              key={r.id}
            >
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-medium text-[14px]">{r.title}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">
                  {r.question_count}문제 · {r.duration_minutes ? `제한시간 ${r.duration_minutes}분` : "제한시간 없음"}
                </p>
                {(r.scheduled_start || r.scheduled_end) && (
                  <p className="mt-0.5 text-muted-foreground text-xs">
                    {r.scheduled_start ? new Date(r.scheduled_start).toLocaleString("ko-KR") : "제한 없음"}
                    {" ~ "}
                    {r.scheduled_end ? new Date(r.scheduled_end).toLocaleString("ko-KR") : "제한 없음"}
                  </p>
                )}
              </div>
              <button
                className="shrink-0 rounded-lg border border-border px-4 py-2 text-[13px] font-medium transition-colors hover:border-ring disabled:cursor-not-allowed disabled:opacity-40"
                disabled={r.status !== "open" || startingId === r.id}
                onClick={() => begin(r.id)}
                type="button"
              >
                {startingId === r.id ? "시작하는 중..." : r.status === "open" ? "응시 시작" : STATUS_LABEL[r.status]}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
