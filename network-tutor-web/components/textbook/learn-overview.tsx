"use client";

import {
  ArrowRightIcon,
  BookOpenIcon,
  GraduationCapIcon,
  ListChecksIcon,
  PartyPopperIcon,
} from "lucide-react";
import Link from "next/link";
import { ALL_LESSONS } from "@/lib/textbook/curriculum";
import { TextbookToc } from "./textbook-toc";
import { ContinueReading } from "./continue-reading";
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

// 교재 첫 화면: 전체 진도, 지금 할 단원, 과목별 단계 목록.
export function LearnOverview({
  minutes,
}: {
  minutes: Record<string, number>;
}) {
  const { bySlug } = useLearnProgress();
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
              교재
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
              <ContinueReading />
              {current ? (
                <Link
                  className="inline-flex h-11 max-w-full items-center gap-2 rounded-xl bg-brand px-5 font-semibold text-[14px] text-white shadow-[var(--shadow-brand)] transition-opacity hover:opacity-90"
                  href={`/textbook/${current.slug}`}
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
                href="#textbook-contents"
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

      <div className="mt-8 scroll-mt-20" id="textbook-contents">
        <TextbookToc minutes={minutes} />
      </div>
    </div>
  );
}
