"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClockIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
} from "lucide-react";
import {
  PageIntro,
  PageLoading,
  PageNotice,
} from "@/components/chat/page-intro";
import { handOffAttempt } from "@/lib/attempt-handoff";
import { useRouter } from "next/navigation";
import { toast } from "@/components/chat/toast";
import { loadJson } from "@/components/load-json";

interface Round {
  roundLabel: string;
  year: string;
  month: string;
  day: string;
  questionCount: number;
}

interface RoundProgress {
  roundLabel: string;
  inProgress: { attemptId: number; answered: number; total: number } | null;
  last: { attemptId: number; correct: number; total: number } | null;
  bestCorrect: number | null;
  timesSubmitted: number;
}

export default function RoundsPage() {
  const router = useRouter();
  const [progress, setProgress] = useState<Map<string, RoundProgress>>(
    new Map()
  );
  const [rounds, setRounds] = useState<Round[] | null>(null);
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [startingLabel, setStartingLabel] = useState<string | null>(null);

  useEffect(() => {
    loadJson("/api/exam/rounds", setRounds, { onError: () => setRounds([]) });
    loadJson<RoundProgress[]>(
      "/api/exam/rounds/progress",
      (list) => setProgress(new Map(list.map((p) => [p.roundLabel, p]))),
      { quiet: true }
    );
  }, []);

  const years = useMemo(() => {
    if (!rounds) return [];
    const byYear = new Map<string, number>();
    for (const r of rounds) byYear.set(r.year, (byYear.get(r.year) ?? 0) + 1);
    return [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [rounds]);

  const roundsInYear = useMemo(
    () => (rounds ?? []).filter((r) => r.year === selectedYear),
    [rounds, selectedYear]
  );

  const begin = async (roundLabel: string, fresh = false) => {
    setStartingLabel(roundLabel);
    try {
      const res = await fetch(
        `/api/exam/round/${encodeURIComponent(roundLabel)}/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fresh }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "시작할 수 없습니다.");
      router.push(handOffAttempt(data));
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "오류가 발생했습니다.",
      });
    } finally {
      setStartingLabel(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
      <PageIntro
        description="실제로 출제됐던 회차를 골라 50문제를 원래 순서 그대로 풀어봐요. 중간에 나가도 고른 답은 저장돼 이어서 풀 수 있어요. 시간 제한은 없고, 제출하면 채점 결과와 해설을 한 번에 확인할 수 있어요."
        icon={CalendarClockIcon}
        title="기출문제"
      />

      {rounds === null ? (
        <PageLoading />
      ) : rounds.length === 0 ? (
        <PageNotice icon={FileTextIcon} title="등록된 기출문제 회차가 없어요" />
      ) : selectedYear === null ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {years.map(([year, count]) => (
            <button
              className="surface surface-hover group flex flex-col items-start gap-3 px-4 py-4 text-left"
              key={year}
              onClick={() => setSelectedYear(year)}
              type="button"
            >
              <span className="flex flex-wrap gap-1">
                <span className="rounded-full bg-accent px-2 py-0.5 font-semibold text-[11px] text-primary">
                  {count}회차
                </span>
                {(() => {
                  const done = (rounds ?? []).filter(
                    (r) =>
                      r.year === year &&
                      (progress.get(r.roundLabel)?.timesSubmitted ?? 0) > 0
                  ).length;
                  return done > 0 ? (
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-semibold text-[11px] text-emerald-700">
                      {done}회 완료
                    </span>
                  ) : null;
                })()}
              </span>
              <span className="flex w-full items-center justify-between">
                <span className="font-bold text-[20px] text-foreground tracking-tight">
                  {year}
                </span>
                <ChevronRightIcon className="size-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <button
            className="flex w-fit items-center gap-1 rounded-full px-2 py-1 font-medium text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
            onClick={() => setSelectedYear(null)}
            type="button"
          >
            <ChevronLeftIcon className="size-4" />
            {selectedYear}년 · 연도 다시 선택
          </button>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {roundsInYear.map((r) => {
              const p = progress.get(r.roundLabel);
              return (
                <div className="flex flex-col gap-1" key={r.roundLabel}>
                  <button
                    className="surface surface-hover group flex items-center gap-3.5 px-4 py-3.5 text-left disabled:pointer-events-none disabled:opacity-50"
                    disabled={startingLabel !== null}
                    onClick={() => begin(r.roundLabel)}
                    type="button"
                  >
                    <span className="flex size-10 shrink-0 flex-col items-center justify-center rounded-xl bg-accent font-bold text-[14px] text-primary leading-none">
                      {Number(r.month)}
                      <span className="mt-0.5 font-medium text-[9.5px]">
                        월
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-semibold text-[14px] text-foreground">
                        {r.year}년 {Number(r.month)}월 {Number(r.day)}일
                      </span>
                      <span className="text-[12px] text-muted-foreground">
                        {startingLabel === r.roundLabel
                          ? "여는 중..."
                          : p?.inProgress
                            ? `이어 풀기 · ${p.inProgress.answered}/${p.inProgress.total} 답함`
                            : p?.last
                              ? `최근 ${p.last.correct}/${p.last.total}${p.bestCorrect !== null && p.bestCorrect > p.last.correct ? ` · 최고 ${p.bestCorrect}` : ""} · ${p.timesSubmitted}번 풀었어요`
                              : `${r.questionCount}문제`}
                      </span>
                    </span>
                    {p?.inProgress ? (
                      <span className="shrink-0 rounded-full bg-sky-500/12 px-2 py-0.5 font-semibold text-[11px] text-sky-700">
                        풀던 중
                      </span>
                    ) : p?.last ? (
                      <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 font-semibold text-[11px] text-emerald-700">
                        완료
                      </span>
                    ) : null}
                    <ChevronRightIcon className="size-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </button>
                  {p?.inProgress && (
                    <button
                      className="self-end px-2 text-[12px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline disabled:opacity-50"
                      disabled={startingLabel !== null}
                      onClick={() => begin(r.roundLabel, true)}
                      type="button"
                    >
                      처음부터 새로 풀기
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
