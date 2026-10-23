"use client";

import { subjectLabel } from "@/lib/subject";
import {
  ActivityIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  PencilLineIcon,
  RefreshCwIcon,
  SparklesIcon,
  TargetIcon,
  TrendingUpIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/brand/logo";
import { PageIntro, PageLoading } from "@/components/chat/page-intro";
import { Button } from "@/components/ui/button";
import { MessageResponse } from "@/components/ai-elements/message";
import { loadJson } from "@/components/load-json";
import { matchLesson, type LessonMatch } from "@/lib/textbook/lesson-match";
import { attemptTitle } from "@/lib/study-summary";

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
  setTitle: string | null;
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

function AccuracyBar({
  label,
  accuracy,
  total,
  subject,
  weakest,
}: {
  label: string;
  accuracy: number;
  total: number;
  subject: string;
  weakest: boolean;
}) {
  const color =
    accuracy >= 80
      ? "bg-brand"
      : accuracy >= 50
        ? "bg-amber-400"
        : "bg-destructive/80";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="flex items-center gap-2 font-medium text-foreground">
          {label}
          {weakest && (
            <span className="rounded-full bg-destructive/10 px-1.5 py-px font-semibold text-[10.5px] text-destructive">
              가장 약함
            </span>
          )}
        </span>
        <span className="text-muted-foreground">
          <b className="font-bold text-[14px] text-foreground tabular-nums">
            {accuracy}%
          </b>{" "}
          · {total}문제
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${Math.min(100, accuracy)}%` }}
        />
      </div>
      <Link
        className="self-end font-medium text-[12px] text-primary hover:underline"
        href={`/practice?subject=${encodeURIComponent(subject)}`}
      >
        이 과목 연습하기 →
      </Link>
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
    <div className="flex items-end gap-1.5">
      {days.map((day) => {
        const count = map.get(day) ?? 0;
        const intensity = count === 0 ? 0 : Math.max(0.25, count / maxCount);
        return (
          <div className="flex flex-1 flex-col items-center gap-1" key={day}>
            <div
              className="h-8 w-full rounded-md bg-primary"
              style={{ opacity: intensity === 0 ? 0.07 : intensity }}
              title={`${day}: ${count}문제`}
            />
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {day.slice(8)}
            </span>
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

  // 복습 중인 오답을 교재 단원별로 묶어 "자주 틀리는 단원" — 과목보다 구체적이고 바로 읽으러 갈 수 있다
  const [weakLessons, setWeakLessons] = useState<
    { lesson: LessonMatch; n: number }[]
  >([]);
  useEffect(() => {
    loadJson<
      {
        stem: string;
        choices: string[] | null;
        subject: string;
        reviewState: string;
      }[]
    >(
      "/api/exam/wrong-answers",
      (items) => {
        const counts = new Map<string, { lesson: LessonMatch; n: number }>();
        for (const i of items) {
          if (i.reviewState === "mastered") {
            continue;
          }
          const l = matchLesson(i.stem, i.choices, i.subject);
          if (l) {
            const c = counts.get(l.slug) ?? { lesson: l, n: 0 };
            c.n += 1;
            counts.set(l.slug, c);
          }
        }
        setWeakLessons(
          [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 5)
        );
      },
      { quiet: true }
    );
  }, []);

  useEffect(() => {
    loadJson("/api/exam/my-report", setData);
    loadJson<{ content: string }>(
      "/api/exam/my-report/analysis",
      (d) => setAnalysis(d.content),
      {
        quiet: true,
        onError: () => setAnalysis("분석 글을 불러오지 못했어요."),
      }
    ).finally(() => setAnalysisLoading(false));
  }, []);

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const res = await fetch("/api/exam/my-report/analysis/regenerate", {
        method: "POST",
      });
      const d = await res.json();
      setAnalysis(d.content);
    } finally {
      setRegenerating(false);
    }
  };

  if (!data) return <PageLoading />;

  const card = "surface p-5 sm:p-6";
  const cardTitle =
    "flex items-center gap-2 font-semibold text-[14px] text-foreground";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-8 sm:py-12">
      <PageIntro
        className="mb-1"
        description="지금까지 채점된 문제를 기준으로 한 정답률이에요."
        icon={TrendingUpIcon}
        title="나의 학습 리포트"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          {
            label: "누적 풀이 수",
            value: data.totalAnswered.toLocaleString(),
            unit: "문제",
            icon: PencilLineIcon,
          },
          {
            label: "맞춘 문제",
            value: data.totalCorrect.toLocaleString(),
            unit: "문제",
            icon: CheckCircle2Icon,
          },
          {
            label: "전체 정답률",
            value: String(data.overallAccuracy),
            unit: "%",
            icon: TargetIcon,
            highlight: true,
          },
        ].map((t) => (
          <div
            className={`surface relative overflow-hidden p-4 sm:p-5 ${t.highlight ? "col-span-2 border-transparent bg-brand text-white shadow-[var(--shadow-brand)] sm:col-span-1" : ""}`}
            key={t.label}
          >
            <t.icon
              className={`size-5 ${t.highlight ? "text-white/80" : "text-primary"}`}
            />
            <p
              className={`mt-3 text-[12.5px] ${t.highlight ? "text-white/75" : "text-muted-foreground"}`}
            >
              {t.label}
            </p>
            <p className="mt-0.5 font-extrabold text-[28px] tabular-nums tracking-tight">
              {t.value}
              <span
                className={`ml-0.5 font-semibold text-[14px] ${t.highlight ? "text-white/75" : "text-muted-foreground"}`}
              >
                {t.unit}
              </span>
            </p>
          </div>
        ))}
      </div>

      <div className={card}>
        <h2 className={`${cardTitle} mb-4`}>
          <ActivityIcon className="size-4 text-primary" />
          최근 14일 학습 활동
        </h2>
        <ActivityStrip activityByDay={data.activityByDay} />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className={card}>
          <h2 className={`${cardTitle} mb-4`}>과목별 정답률</h2>
          {data.bySubject.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              아직 채점된 문제가 없어요.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {data.bySubject.map((s) => (
                <AccuracyBar
                  accuracy={s.accuracy}
                  key={s.subject}
                  label={subjectLabel(s.subject)}
                  subject={s.subject}
                  total={s.total}
                  weakest={
                    data.bySubject.length > 1 &&
                    s.total >= 5 &&
                    s.accuracy ===
                      Math.min(
                        ...data.bySubject
                          .filter((x) => x.total >= 5)
                          .map((x) => x.accuracy)
                      )
                  }
                />
              ))}
            </div>
          )}
        </div>

        <div className={card}>
          <h2 className={`${cardTitle} mb-4`}>최근 응시</h2>
          {data.recentAttempts.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              응시 기록이 없어요.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {data.recentAttempts.map((a) => (
                <Link
                  className="group flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-[13px] transition-colors hover:bg-accent"
                  href={`/exam/${a.id}`}
                  key={a.id}
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-foreground">
                      {a.setKind === "practice_custom" &&
                      a.setTitle &&
                      !a.setTitle.startsWith("연습 문제")
                        ? a.setTitle
                        : a.setKind === "past_exam_round"
                          ? attemptTitle(a.setTitle)
                          : (SET_KIND_LABEL[a.setKind ?? ""] ?? "연습")}
                    </span>
                    {a.submittedAt ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {new Date(a.submittedAt).toLocaleDateString("ko-KR")}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 font-bold text-foreground tabular-nums">
                    {a.score !== null ? `${a.score}점` : "-"}
                    <ChevronRightIcon className="size-3.5 text-muted-foreground/50 group-hover:text-primary" />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {weakLessons.length > 0 && (
        <div className={card}>
          <h2 className={cardTitle}>자주 틀리는 단원</h2>
          <p className="mt-1 mb-4 text-[12.5px] text-muted-foreground">
            아직 극복하지 못한 오답이 많이 몰린 교재 단원이에요. 개념을 다시
            읽고 확인 문제를 풀어 보세요.
          </p>
          <div className="flex flex-col gap-1.5">
            {weakLessons.map(({ lesson, n }) => (
              <Link
                className="group flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-[13px] transition-colors hover:bg-accent"
                href={`/textbook/${lesson.slug}`}
                key={lesson.slug}
              >
                <span className="min-w-0 truncate">
                  <span className="mr-1.5 text-muted-foreground">
                    {lesson.partLabel}
                  </span>
                  <span className="font-medium text-foreground">
                    {lesson.title}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1 font-semibold text-destructive tabular-nums">
                  {n}문제
                  <ChevronRightIcon className="size-3.5 text-muted-foreground/50 group-hover:text-primary" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {data.weakTopics.length > 0 && (
        <div className={card}>
          <h2 className={cardTitle}>세부 주제별 약점</h2>
          <p className="mt-1 mb-4 text-[12.5px] text-muted-foreground">
            과목보다 더 구체적으로, 어떤 개념에서 자주 틀렸는지 보여줘요.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.weakTopics.slice(0, 6).map((t) => (
              <div
                className="flex items-center justify-between gap-3 rounded-xl border border-destructive/15 bg-destructive/5 px-3.5 py-2.5 text-[13px]"
                key={t.topic}
              >
                <span className="min-w-0 truncate font-medium text-foreground">
                  {t.topic}
                </span>
                <span className="shrink-0 font-semibold text-[12px] text-destructive tabular-nums">
                  {Math.round(t.accuracy * 100)}%{" "}
                  <span className="font-normal opacity-70">
                    ({t.totalCount - t.wrongCount}/{t.totalCount})
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="surface overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-border border-b bg-brand-soft px-5 py-3.5 sm:px-6">
          <h2 className="flex items-center gap-2.5 font-semibold text-[14px] text-foreground">
            <BrandMark className="size-6" />
            AI 종합 분석
          </h2>
          <Button
            disabled={analysisLoading || regenerating}
            onClick={regenerate}
            size="sm"
            variant="outline"
          >
            <RefreshCwIcon
              className={`size-3.5 ${regenerating ? "animate-spin" : ""}`}
            />
            {regenerating ? "다시 생성 중..." : "다시 생성"}
          </Button>
        </div>
        <div className="px-5 py-5 sm:px-6">
          {analysisLoading ? (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <SparklesIcon className="size-4 animate-pulse text-primary" />
              분석 글을 준비하고 있어요 (첫 로딩은 시간이 좀 걸릴 수 있어요)…
            </p>
          ) : (
            <div className="text-[14px] leading-[1.75]">
              <MessageResponse>{analysis ?? ""}</MessageResponse>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
