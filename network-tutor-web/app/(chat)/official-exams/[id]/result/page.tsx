"use client";

import { subjectLabel } from "@/lib/subject";
import { AwardIcon, CheckIcon, ClockIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { PageLoading, PageNotice } from "@/components/chat/page-intro";
import { loadJson } from "@/components/load-json";
import { Button } from "@/components/ui/button";

interface Item {
  questionId: number;
  subject: string;
  stem: string;
  questionType: string;
  choices: string[];
  selectedIndex: number | null;
  correctIndex: number | null;
  answerText: string | null;
  isCorrect: boolean | null;
  explanation: string;
  stemImageUrl: string | null;
}

type Result =
  | { released: false; title: string; status: string }
  | {
      released: true;
      title: string;
      status: string;
      score: number | null;
      correctCount: number;
      total: number;
      items: Item[];
      rank: { rank: number; participants: number } | null;
    };

export default function OfficialExamResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<Result | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    loadJson<Result>(
      `/api/official-exams/${encodeURIComponent(id)}/result`,
      setData,
      { quiet: true, onError: () => setFailed(true) }
    );
  }, [id]);

  if (failed) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12">
        <PageNotice
          title="결과를 볼 수 없어요"
          description="응시 기록이 없거나 아직 응시 중인 시험이에요."
        />
      </div>
    );
  }
  if (!data) return <PageLoading />;
  if (!data.released) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12">
        <PageNotice
          icon={ClockIcon}
          title="아직 결과가 공개되지 않았어요"
          description="선생님이 결과를 공개하면 이 화면에서 점수와 해설을 볼 수 있어요."
        >
          <Button asChild variant="outline">
            <Link href="/official-exams">목록으로</Link>
          </Button>
        </PageNotice>
      </div>
    );
  }

  const pct = Math.max(0, Math.min(100, data.score ?? 0));
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-8 sm:py-12">
      <div className="surface relative overflow-hidden p-6 text-center sm:p-8">
        <div className="pointer-events-none absolute inset-0 bg-brand-soft opacity-70" />
        <div className="relative flex flex-col items-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 font-semibold text-[12px] text-primary">
            <AwardIcon className="size-3.5" /> {data.title}
          </span>
          <div
            className="mt-5 flex size-36 items-center justify-center rounded-full"
            style={{
              background: `conic-gradient(var(--primary) ${pct * 3.6}deg, oklch(0.92 0.02 277) 0deg)`,
            }}
          >
            <div className="flex size-[124px] flex-col items-center justify-center rounded-full bg-card">
              <span className="font-extrabold text-[40px] tabular-nums leading-none tracking-tight">
                {data.score ?? "-"}
              </span>
              <span className="mt-1 text-[12px] text-muted-foreground">점</span>
            </div>
          </div>
          <p className="mt-4 text-[14px] text-muted-foreground">
            <b className="text-foreground">{data.correctCount}</b> /{" "}
            {data.total} 정답
          </p>
          {data.rank ? (
            <p className="mt-2 rounded-full bg-white/80 px-4 py-1.5 font-semibold text-[14px] text-primary">
              응시자 {data.rank.participants}명 중{" "}
              <b className="text-[16px]">{data.rank.rank}등</b>
            </p>
          ) : null}
        </div>
      </div>

      <h2 className="mt-2 px-1 font-bold text-[17px] tracking-tight">
        문제별 해설
      </h2>
      {data.items.map((item, i) => (
        <div className="surface p-5 sm:p-6" key={item.questionId}>
          <div className="mb-3 flex items-center gap-2">
            <span
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1 font-bold text-[12px] ${
                item.isCorrect
                  ? "bg-emerald-500/12 text-emerald-700"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {item.isCorrect ? (
                <CheckIcon className="size-3.5" strokeWidth={3} />
              ) : (
                <XIcon className="size-3.5" strokeWidth={3} />
              )}
              Q{i + 1}
            </span>
            <span className="text-[12px] text-muted-foreground">
              {subjectLabel(item.subject)}
            </span>
          </div>
          <p className="mb-4 whitespace-pre-wrap font-semibold text-[14.5px] leading-relaxed">
            {item.stem}
          </p>
          {item.stemImageUrl ? (
            // biome-ignore lint/performance/noImgElement: 문제 지문 이미지는 public/exam-images의 고정 자산
            <img
              alt="문제 지문 이미지"
              className="mb-4 max-h-80 w-fit max-w-full rounded-xl border"
              src={item.stemImageUrl}
            />
          ) : null}
          <div className="flex flex-col gap-1.5">
            {item.choices.map((c, ci) => {
              let tone = "border-border/70 text-muted-foreground";
              let mark: string | null = null;
              if (ci === item.correctIndex) {
                tone =
                  "border-emerald-500/50 bg-emerald-500/8 font-medium text-emerald-900";
                mark = ci === item.selectedIndex ? "정답 · 내 답" : "정답";
              } else if (ci === item.selectedIndex) {
                tone =
                  "border-destructive/40 bg-destructive/6 text-destructive";
                mark = "내 답";
              }
              return (
                <div
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-[13.5px] ${tone}`}
                  key={ci}
                >
                  <span>
                    {ci + 1}. {c}
                  </span>
                  {mark ? (
                    <span className="shrink-0 font-semibold text-[11px]">
                      {mark}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
          {item.explanation ? (
            <div className="mt-4 rounded-xl bg-muted/70 p-3.5">
              <p className="mb-1 font-semibold text-[12px]">해설</p>
              <p className="whitespace-pre-wrap text-[13px] text-muted-foreground leading-relaxed">
                {item.explanation}
              </p>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
