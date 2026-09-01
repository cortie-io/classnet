"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MessageResponse } from "@/components/ai-elements/message";

interface SubjectStat {
  subject: string;
  total: number;
  correct: number;
  accuracy: number;
}
interface WeakTopic {
  subject: string;
  topic: string;
  wrongCount: number;
  totalCount: number;
  accuracy: number;
}
interface ActivityDay {
  day: string;
  count: number;
}
interface RecentAttempt {
  id: number;
  score: number | null;
  total: number;
  setKind: string | null;
  submittedAt: string | null;
}
interface StudentReport {
  totalAnswered: number;
  totalCorrect: number;
  overallAccuracy: number;
  bySubject: SubjectStat[];
  weakTopics: WeakTopic[];
  activityByDay: ActivityDay[];
  recentAttempts: RecentAttempt[];
}

const SET_KIND_LABEL: Record<string, string> = {
  mock: "모의고사",
  admin_timed: "지정 시험",
  practice_custom: "연습",
  past_exam_round: "기출 회차",
};

function AccuracyBar({ label, accuracy, total }: { label: string; accuracy: number; total: number }) {
  const color = accuracy >= 80 ? "bg-emerald-500" : accuracy >= 50 ? "bg-amber-500" : "bg-destructive";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[13px]">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {accuracy}% ({total}문제)
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, accuracy)}%` }} />
      </div>
    </div>
  );
}

// 최근 14일을 매일 하나씩 칸으로 그려서 활동 여부를 한눈에 보여준다(GitHub 잔디 같은 미니 버전).
function ActivityStrip({ activityByDay }: { activityByDay: ActivityDay[] }) {
  const map = new Map(activityByDay.map((a) => [a.day, a.count]));
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    return d.toISOString().slice(0, 10);
  });
  const maxCount = Math.max(1, ...activityByDay.map((a) => a.count));
  return (
    <div className="flex items-end gap-1">
      {days.map((day) => {
        const count = map.get(day) ?? 0;
        const intensity = count === 0 ? 0 : Math.max(0.25, count / maxCount);
        return (
          <div className="flex flex-1 flex-col items-center gap-1" key={day}>
            <div
              className="h-6 w-full rounded-sm bg-emerald-500"
              style={{ opacity: intensity === 0 ? 0.08 : intensity }}
              title={`${day}: ${count}문제`}
            />
            <span className="text-[9px] text-muted-foreground">{day.slice(8)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function MyReportPage() {
  const [data, setData] = useState<StudentReport | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    fetch("/api/exam/my-report")
      .then((r) => r.json())
      .then(setData)
      .catch(() => undefined);
    fetch("/api/exam/my-report/analysis")
      .then((r) => r.json())
      .then((d) => setAnalysis(d.content))
      .catch(() => setAnalysis("분석 글을 불러오지 못했어요."))
      .finally(() => setAnalysisLoading(false));
  }, []);

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const res = await fetch("/api/exam/my-report/analysis/regenerate", { method: "POST" });
      const d = await res.json();
      setAnalysis(d.content);
    } finally {
      setRegenerating(false);
    }
  };

  if (!data) return <div className="px-4 py-10 text-center text-muted-foreground">불러오는 중...</div>;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-3 py-6 sm:px-4 sm:py-8">
      <div>
        <h1 className="font-semibold text-xl">나의 학습 리포트</h1>
        <p className="text-muted-foreground text-sm">지금까지 채점된 문제를 기준으로 한 정답률입니다.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border/50 bg-card p-4 text-center shadow-[var(--shadow-card)]">
          <p className="text-muted-foreground text-xs">누적 풀이 수</p>
          <p className="mt-1 font-bold text-2xl">{data.totalAnswered}</p>
        </div>
        <div className="rounded-2xl border border-border/50 bg-card p-4 text-center shadow-[var(--shadow-card)]">
          <p className="text-muted-foreground text-xs">맞춘 문제</p>
          <p className="mt-1 font-bold text-2xl">{data.totalCorrect}</p>
        </div>
        <div className="col-span-2 rounded-2xl border border-border/50 bg-card p-4 text-center shadow-[var(--shadow-card)] sm:col-span-1">
          <p className="text-muted-foreground text-xs">전체 정답률</p>
          <p className="mt-1 font-bold text-2xl">{data.overallAccuracy}%</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border/50 bg-card p-4 shadow-[var(--shadow-card)] sm:p-5">
        <h2 className="mb-3 font-medium text-sm">최근 14일 학습 활동</h2>
        <ActivityStrip activityByDay={data.activityByDay} />
      </div>

      <div className="rounded-2xl border border-border/50 bg-card p-4 shadow-[var(--shadow-card)] sm:p-5">
        <h2 className="mb-3 font-medium text-sm">과목별 정답률</h2>
        {data.bySubject.length === 0 ? (
          <p className="text-muted-foreground text-xs">아직 채점된 문제가 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {data.bySubject.map((s) => (
              <AccuracyBar accuracy={s.accuracy} key={s.subject} label={s.subject.replace(/^\d과목_/, "")} total={s.total} />
            ))}
          </div>
        )}
      </div>

      {data.weakTopics.length > 0 && (
        <div className="rounded-2xl border border-border/50 bg-card p-4 shadow-[var(--shadow-card)] sm:p-5">
          <h2 className="mb-1 font-medium text-sm">세부 주제별 약점</h2>
          <p className="mb-3 text-muted-foreground text-xs">과목보다 더 구체적으로, 어떤 개념에서 자주 틀렸는지 보여줍니다.</p>
          <div className="flex flex-col gap-2">
            {data.weakTopics.slice(0, 6).map((t) => (
              <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px]" key={t.topic}>
                <span className="min-w-0 truncate">{t.topic}</span>
                <span className="shrink-0 text-destructive text-xs">
                  {Math.round(t.accuracy * 100)}% ({t.totalCount - t.wrongCount}/{t.totalCount})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border/50 bg-card p-4 shadow-[var(--shadow-card)] sm:p-5">
        <h2 className="mb-3 font-medium text-sm">최근 응시</h2>
        {data.recentAttempts.length === 0 ? (
          <p className="text-muted-foreground text-xs">응시 기록이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {data.recentAttempts.map((a) => (
              <Link
                className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-[13px] transition-all duration-150 hover:border-ring hover:bg-accent/40"
                href={`/exam/${a.id}`}
                key={a.id}
              >
                <span>
                  {SET_KIND_LABEL[a.setKind ?? ""] ?? "연습"}
                  {a.submittedAt ? ` · ${new Date(a.submittedAt).toLocaleDateString("ko-KR")}` : ""}
                </span>
                <span className="text-muted-foreground">{a.score !== null ? `${a.score}점` : "-"}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border/50 bg-card p-4 shadow-[var(--shadow-card)] sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium text-sm">AI 종합 분석</h2>
          <Button disabled={analysisLoading || regenerating} onClick={regenerate} size="sm" variant="outline">
            {regenerating ? "다시 생성 중..." : "다시 생성"}
          </Button>
        </div>
        {analysisLoading ? (
          <p className="text-muted-foreground text-xs">분석 글을 준비하고 있어요 (첫 로딩은 시간이 좀 걸릴 수 있어요)...</p>
        ) : (
          <div className="text-[13px] leading-relaxed">
            <MessageResponse>{analysis ?? ""}</MessageResponse>
          </div>
        )}
      </div>
    </div>
  );
}
