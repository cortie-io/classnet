"use client";

import {
  ArrowRightIcon,
  BookOpenIcon,
  CheckIcon,
  GraduationCapIcon,
  ListChecksIcon,
  PartyPopperIcon,
} from "lucide-react";
import Link from "next/link";
import { ALL_LESSONS, CURRICULUM } from "@/lib/textbook/curriculum";
import { cn } from "@/lib/utils";
import { useLearnProgress } from "./use-learn-progress";

function ProgressRing({ value, total }: { value: number; total: number }) {
  const pct = total ? value / total : 0;
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-24 shrink-0">
      <svg className="-rotate-90 size-24" viewBox="0 0 80 80">
        <circle
          className="stroke-white/70"
          cx="40"
          cy="40"
          fill="none"
          r={r}
          strokeWidth="7"
        />
        <circle
          className="stroke-primary transition-[stroke-dashoffset] duration-700"
          cx="40"
          cy="40"
          fill="none"
          r={r}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          strokeLinecap="round"
          strokeWidth="7"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-bold text-[20px] tabular-nums tracking-tight">
          {Math.round(pct * 100)}%
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {value}/{total}
        </span>
      </div>
    </div>
  );
}

// 처음부터 배우기 첫 화면: 전체 진도, 지금 할 단원, 과목별 단계 목록.
export function LearnOverview({
  minutes,
}: {
  minutes: Record<string, number>;
}) {
  const { bySlug, isLoading } = useLearnProgress();
  const done = ALL_LESSONS.filter((l) => bySlug.get(l.slug)?.completedAt);
  const current =
    ALL_LESSONS.find((l) => !bySlug.get(l.slug)?.completedAt) ?? null;
  const quizzes = ALL_LESSONS.map((l) => bySlug.get(l.slug)).filter(
    (p) => p?.quizTotal
  );
  const correct = quizzes.reduce((a, p) => a + (p?.quizCorrect ?? 0), 0);
  const total = quizzes.reduce((a, p) => a + (p?.quizTotal ?? 0), 0);
  const leftMinutes = ALL_LESSONS.filter(
    (l) => !bySlug.get(l.slug)?.completedAt
  ).reduce((a, l) => a + (minutes[l.slug] ?? 0), 0);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 md:px-8">
      <section className="relative overflow-hidden rounded-[1.375rem] border border-primary/15 bg-brand-soft px-6 py-7 md:px-8">
        <div className="pointer-events-none absolute -top-20 -right-16 size-64 rounded-full bg-brand opacity-[0.12] blur-3xl" />
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 font-semibold text-[12.5px] text-primary">
              <GraduationCapIcon className="size-4" />
              처음부터 배우기
            </p>
            <h1 className="mt-1.5 font-bold text-[24px] tracking-[-0.035em] md:text-[26px]">
              {done.length === 0
                ? "네트워크, 처음이어도 괜찮아요"
                : current
                  ? "좋아요, 계속 이어 가요"
                  : "전 과정을 마쳤어요!"}
            </h1>
            <p className="mt-2 max-w-lg text-[14px] text-muted-foreground leading-relaxed">
              {ALL_LESSONS.length}개 단원을 순서대로 읽고, 단원마다 실제 문제
              5개로 확인하면서 시험 범위를 한 바퀴 돌아요. 한 단원은 보통
              10~15분이면 충분해요.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {current ? (
                <Link
                  className="inline-flex h-11 max-w-full items-center gap-2 rounded-xl bg-brand px-5 font-semibold text-[14px] text-white shadow-[var(--shadow-brand)] transition-opacity hover:opacity-90"
                  href={`/learn/${current.slug}`}
                >
                  <span className="truncate">
                    {done.length === 0
                      ? "1단계부터 시작하기"
                      : `이어서 학습하기 · STEP ${current.index + 1}`}
                  </span>
                  <ArrowRightIcon className="size-4 shrink-0" />
                </Link>
              ) : (
                <Link
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-5 font-semibold text-[14px] text-white"
                  href="/mock-exam"
                >
                  <PartyPopperIcon className="size-4" />
                  모의고사로 실력 확인하기
                </Link>
              )}
              <Link
                className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-border bg-background px-4 font-semibold text-[13.5px] transition-colors hover:bg-accent"
                href="/textbook"
              >
                <BookOpenIcon className="size-4" />
                교재 목차
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-5 sm:flex-col sm:items-end sm:gap-3">
            <ProgressRing total={ALL_LESSONS.length} value={done.length} />
            <dl className="space-y-1 text-[12.5px] text-muted-foreground sm:text-right">
              <div>
                확인 문제 정답률{" "}
                <strong className="text-foreground tabular-nums">
                  {total ? `${Math.round((correct / total) * 100)}%` : "—"}
                </strong>
              </div>
              <div>
                남은 분량 약{" "}
                <strong className="text-foreground tabular-nums">
                  {Math.max(1, Math.round(leftMinutes / 60))}시간
                </strong>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: BookOpenIcon,
            title: "1. 단원 읽기",
            body: "쉬운 비유부터 정확한 정의까지, 교재처럼 읽어요.",
          },
          {
            icon: ListChecksIcon,
            title: "2. 확인 문제 5개",
            body: "단원 내용이 나오는 실제 문제로 바로 확인해요.",
          },
          {
            icon: ArrowRightIcon,
            title: "3. 다음 단원으로",
            body: "틀린 문제는 오답노트에 쌓이고, 다음 단계가 열려요.",
          },
        ].map((s) => (
          <div
            className="rounded-2xl border border-border bg-card px-4 py-3.5"
            key={s.title}
          >
            <p className="flex items-center gap-1.5 font-semibold text-[13.5px]">
              <s.icon className="size-4 text-primary" />
              {s.title}
            </p>
            <p className="mt-1 text-[12.5px] text-muted-foreground leading-relaxed">
              {s.body}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-8 space-y-6">
        {CURRICULUM.map((part) => {
          const partDone = part.lessons.filter(
            (l) => bySlug.get(l.slug)?.completedAt
          ).length;
          return (
            <section
              className="rounded-[1.125rem] border border-border bg-card px-5 py-5"
              key={part.id}
            >
              <header className="flex items-end justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-semibold text-[12px] text-primary">
                    {part.label}
                  </p>
                  <h2 className="font-bold text-[17px] tracking-tight">
                    {part.title}
                  </h2>
                </div>
                <span className="shrink-0 text-[12.5px] text-muted-foreground tabular-nums">
                  {partDone}/{part.lessons.length} 완료
                </span>
              </header>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-700"
                  style={{
                    width: `${(partDone / part.lessons.length) * 100}%`,
                  }}
                />
              </div>
              <ol className="mt-4">
                {part.lessons.map((l, i) => {
                  const step = ALL_LESSONS.find((x) => x.slug === l.slug)!;
                  const p = bySlug.get(l.slug);
                  const isDone = Boolean(p?.completedAt);
                  const isCurrent = !isLoading && current?.slug === l.slug;
                  const last = i === part.lessons.length - 1;
                  return (
                    <li className="relative flex gap-4" key={l.slug}>
                      {!last ? (
                        <span
                          className={cn(
                            "absolute top-9 bottom-0 left-[15px] w-0.5",
                            isDone ? "bg-emerald-200" : "bg-border"
                          )}
                        />
                      ) : null}
                      <span
                        className={cn(
                          "relative z-10 mt-1 flex size-8 shrink-0 items-center justify-center rounded-full font-semibold text-[12px] tabular-nums",
                          isDone
                            ? "bg-emerald-500 text-white"
                            : isCurrent
                              ? "bg-brand text-white shadow-[var(--shadow-brand)] ring-4 ring-primary/15"
                              : p?.firstReadAt
                                ? "border-2 border-primary/40 bg-background text-primary"
                                : "border border-border bg-background text-muted-foreground"
                        )}
                      >
                        {isDone ? (
                          <CheckIcon className="size-4" />
                        ) : (
                          step.index + 1
                        )}
                      </span>
                      <Link
                        className={cn(
                          "group mb-3 flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-accent/60",
                          isCurrent && "bg-accent/70"
                        )}
                        href={`/learn/${l.slug}`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-[14.5px] group-hover:text-primary">
                              {l.title}
                            </span>
                            {isCurrent ? (
                              <span className="rounded-full bg-brand px-2 py-0.5 font-semibold text-[10.5px] text-white">
                                지금 할 차례
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
                            {l.summary}
                          </span>
                        </span>
                        {p?.quizTotal ? (
                          <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-[11.5px] text-emerald-700 tabular-nums">
                            {p.quizCorrect}/{p.quizTotal}
                          </span>
                        ) : minutes[l.slug] ? (
                          <span className="hidden shrink-0 text-[12px] text-muted-foreground sm:block">
                            {minutes[l.slug]}분
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}
