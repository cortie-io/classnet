"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeftIcon } from "lucide-react";
import { ExamRunner, type ExamStartResponse } from "@/components/exam/exam-runner";
import { toast } from "@/components/chat/toast";

interface Round {
  roundLabel: string;
  year: string;
  month: string;
  day: string;
  questionCount: number;
}

export default function RoundsPage() {
  const [rounds, setRounds] = useState<Round[] | null>(null);
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [startingLabel, setStartingLabel] = useState<string | null>(null);
  const [start, setStart] = useState<ExamStartResponse | null>(null);

  useEffect(() => {
    fetch("/api/exam/rounds")
      .then((r) => r.json())
      .then(setRounds)
      .catch(() => setRounds([]));
  }, []);

  const years = useMemo(() => {
    if (!rounds) return [];
    const byYear = new Map<string, number>();
    for (const r of rounds) byYear.set(r.year, (byYear.get(r.year) ?? 0) + 1);
    return [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [rounds]);

  const roundsInYear = useMemo(
    () => (rounds ?? []).filter((r) => r.year === selectedYear),
    [rounds, selectedYear],
  );

  const begin = async (roundLabel: string) => {
    setStartingLabel(roundLabel);
    try {
      const res = await fetch(`/api/exam/round/${encodeURIComponent(roundLabel)}/start`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "시작할 수 없습니다.");
      setStart(data);
    } catch (err) {
      toast({ type: "error", description: err instanceof Error ? err.message : "오류가 발생했습니다." });
    } finally {
      setStartingLabel(null);
    }
  };

  if (start) {
    return <ExamRunner proctored={false} start={start} />;
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-10">
      <div>
        <h1 className="font-semibold text-xl">실제 기출문제 회차별 풀이</h1>
        <p className="text-muted-foreground text-sm">
          실제로 출제됐던 회차를 골라 그대로 50문제를 원래 순서대로 풀어봅니다. 다 풀고 제출하면 채점 결과와
          해설을 한 번에 확인할 수 있고, 시간 제한은 없습니다.
        </p>
      </div>

      {rounds === null ? (
        <p className="text-muted-foreground text-sm">불러오는 중...</p>
      ) : rounds.length === 0 ? (
        <p className="text-muted-foreground text-sm">등록된 기출문제 회차가 없습니다.</p>
      ) : selectedYear === null ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {years.map(([year, count]) => (
            <button
              className="flex flex-col items-center gap-1 rounded-xl border border-border/50 bg-card px-4 py-4 text-center shadow-[var(--shadow-card)] transition-all duration-200 hover:-translate-y-0.5 hover:border-ring hover:shadow-[var(--shadow-float)]"
              key={year}
              onClick={() => setSelectedYear(year)}
              type="button"
            >
              <span className="font-semibold text-lg">{year}년</span>
              <span className="text-muted-foreground text-xs">{count}회차</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <button
            className="flex w-fit items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
            onClick={() => setSelectedYear(null)}
            type="button"
          >
            <ChevronLeftIcon className="size-3.5" />
            연도 다시 선택
          </button>
          {roundsInYear.map((r) => (
            <button
              className="flex items-center justify-between rounded-xl border border-border/50 bg-card px-4 py-3 text-left text-[14px] shadow-[var(--shadow-card)] transition-all duration-200 hover:-translate-y-0.5 hover:border-ring hover:shadow-[var(--shadow-float)] disabled:pointer-events-none disabled:opacity-50"
              disabled={startingLabel !== null}
              key={r.roundLabel}
              onClick={() => begin(r.roundLabel)}
              type="button"
            >
              <span className="font-medium">
                {r.year}년 {r.month}월 {r.day}일
              </span>
              <span className="text-muted-foreground text-xs">
                {startingLabel === r.roundLabel ? "시작하는 중..." : `${r.questionCount}문제`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
