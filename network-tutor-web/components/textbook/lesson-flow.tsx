"use client";

import {
  ArrowRightIcon,
  CheckCircle2Icon,
  ListChecksIcon,
  RotateCcwIcon,
  SparklesIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "@/components/chat/toast";
import {
  ExamRunner,
  type ExamStartResponse,
} from "@/components/exam/exam-runner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { recordProgress, useLearnProgress } from "./use-learn-progress";

type Phase = "idle" | "loading" | "quiz" | "saving";

// 처음부터 배우기 단원 맨 아래: 확인 문제 → 결과 → 완료하고 다음 단원.
// 확인 문제는 문제은행의 실제 문제로 만든 연습이라 오답노트·학습 리포트에도 그대로 남는다.
export function LessonFlow({
  slug,
  hasQuiz,
  next,
}: {
  slug: string;
  hasQuiz: boolean;
  next: { slug: string; title: string } | null;
}) {
  const router = useRouter();
  const { bySlug, mutate } = useLearnProgress();
  const [phase, setPhase] = useState<Phase>("idle");
  const [start, setStart] = useState<ExamStartResponse | null>(null);
  const [lastAttempt, setLastAttempt] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const mine = bySlug.get(slug);
  const completed = Boolean(mine?.completedAt);

  const goNext = () => router.push(next ? `/textbook/${next.slug}` : "/textbook");

  const beginQuiz = async () => {
    setPhase("loading");
    try {
      const res = await fetch("/api/learn/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "확인 문제를 열지 못했어요.");
      setStart(data);
      setPhase("quiz");
      requestAnimationFrame(() =>
        boxRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      );
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "확인 문제를 열지 못했어요.",
      });
      setPhase("idle");
    }
  };

  const complete = async (attemptId?: number) => {
    setPhase("saving");
    try {
      await recordProgress(slug, "complete", attemptId);
      await mutate();
      if (attemptId) setLastAttempt(attemptId);
      setStart(null);
      setPhase("idle");
      if (!attemptId) goNext();
      else
        requestAnimationFrame(() =>
          boxRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
        );
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "완료로 표시하지 못했어요.",
      });
      setPhase("idle");
    }
  };

  const score = mine?.quizTotal
    ? `${mine.quizCorrect ?? 0} / ${mine.quizTotal}`
    : null;
  const perfect =
    mine?.quizTotal != null && mine.quizCorrect === mine.quizTotal;

  return (
    <section className="mt-12 scroll-mt-24" ref={boxRef}>
      {phase === "quiz" && start ? (
        <div className="rounded-[1.25rem] border border-border bg-card p-4 md:p-6">
          <div className="mb-4 flex items-center gap-2">
            <ListChecksIcon className="size-4.5 text-primary" />
            <p className="font-bold text-[15px]">단원 확인 문제</p>
            <span className="text-[12.5px] text-muted-foreground">
              실제 기출·예상 문제 {start.questions.length}개
            </span>
          </div>
          <ExamRunner
            onSubmitted={(id) => complete(id)}
            proctored={false}
            start={start}
          />
        </div>
      ) : (
        <div
          className={cn(
            "rounded-[1.25rem] border px-5 py-5 md:px-6",
            completed
              ? "border-emerald-200 bg-emerald-50/60"
              : "border-primary/15 bg-brand-soft"
          )}
        >
          {completed ? (
            <>
              <p className="flex items-center gap-1.5 font-bold text-[15px] text-emerald-700">
                <CheckCircle2Icon className="size-5" />이 단원을 끝냈어요
              </p>
              {score ? (
                <p className="mt-1.5 text-[13.5px] text-muted-foreground">
                  확인 문제 <strong className="text-foreground">{score}</strong>{" "}
                  맞힘
                  {perfect
                    ? " — 완벽해요!"
                    : " — 틀린 문제는 해설을 보고 본문의 해당 부분을 다시 읽어 보세요."}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  className="h-10 rounded-xl bg-brand px-4"
                  onClick={goNext}
                  type="button"
                >
                  {next ? `다음 단원: ${next.title}` : "교재 목차로 돌아가기"}
                  <ArrowRightIcon className="size-4" />
                </Button>
                {lastAttempt ? (
                  <Button asChild className="h-10 rounded-xl" variant="outline">
                    <Link href={`/exam/${lastAttempt}`}>문제별 해설 보기</Link>
                  </Button>
                ) : null}
                {hasQuiz ? (
                  <Button
                    className="h-10 rounded-xl"
                    disabled={phase !== "idle"}
                    onClick={beginQuiz}
                    type="button"
                    variant="ghost"
                  >
                    <RotateCcwIcon className="size-4" />
                    확인 문제 다시 풀기
                  </Button>
                ) : null}
              </div>
            </>
          ) : hasQuiz ? (
            <>
              <p className="flex items-center gap-1.5 font-bold text-[15px]">
                <SparklesIcon className="size-4.5 text-primary" />다 읽었나요?
                확인 문제로 마무리해요
              </p>
              <p className="mt-1.5 text-[13.5px] text-muted-foreground leading-relaxed">
                이 단원 내용이 나오는 실제 문제 5개를 풀어요. 점수와 상관없이
                제출하면 단원이 완료되고, 틀린 문제는 오답노트에 쌓여요.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  className="h-10 rounded-xl bg-brand px-4"
                  disabled={phase !== "idle"}
                  onClick={beginQuiz}
                  type="button"
                >
                  {phase === "loading" ? "문제를 고르는 중…" : "확인 문제 풀기"}
                  <ArrowRightIcon className="size-4" />
                </Button>
                <Button
                  className="h-10 rounded-xl text-muted-foreground"
                  disabled={phase !== "idle"}
                  onClick={() => complete()}
                  type="button"
                  variant="ghost"
                >
                  문제 없이 완료하고 넘어가기
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="font-bold text-[15px]">
                이 단원은 확인 문제가 없어요
              </p>
              <p className="mt-1.5 text-[13.5px] text-muted-foreground">
                읽었다면 완료로 표시하고 다음 단원으로 넘어가요.
              </p>
              <Button
                className="mt-4 h-10 rounded-xl bg-brand px-4"
                disabled={phase !== "idle"}
                onClick={() => complete()}
                type="button"
              >
                {phase === "saving"
                  ? "저장 중…"
                  : next
                    ? "완료하고 다음 단원으로"
                    : "완료하기"}
                <ArrowRightIcon className="size-4" />
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
