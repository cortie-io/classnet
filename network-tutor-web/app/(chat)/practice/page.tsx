"use client";

import { ArrowRightIcon, BookOpenCheckIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { PageIntro } from "@/components/chat/page-intro";
import { Button } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/choice-chip";
import {
  ExamRunner,
  type ExamStartResponse,
} from "@/components/exam/exam-runner";
import { toast } from "@/components/chat/toast";
import { loadJson } from "@/components/load-json";

import { savePracticeSelection } from "@/lib/practice-continuation";

interface Meta {
  subjects: { subject: string; count: number }[];
}

export default function PracticePage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [subject, setSubject] = useState<string>("");
  const [count, setCount] = useState(10);
  const [loading, setLoading] = useState(false);
  const [start, setStart] = useState<ExamStartResponse | null>(null);

  useEffect(() => {
    loadJson("/api/exam/meta", setMeta);
  }, []);

  const begin = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/exam/practice/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: subject || undefined, count }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "시작할 수 없습니다.");
      savePracticeSelection(data.attemptId, { subject, count });
      setStart(data);
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "오류가 발생했습니다.",
      });
    } finally {
      setLoading(false);
    }
  };

  if (start) {
    return <ExamRunner proctored={false} start={start} />;
  }

  const subjectCount = subject
    ? meta?.subjects.find((s) => s.subject === subject)?.count
    : meta?.subjects.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:py-12">
      <PageIntro
        description="과목과 문항 수를 골라 바로 풀어보세요. 모두 풀고 제출하면 채점 결과와 해설을 한 번에 확인할 수 있어요."
        icon={BookOpenCheckIcon}
        title="과목별 문제 연습"
      />

      <div className="surface flex flex-col gap-7 p-5 sm:p-7">
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-[13px] text-foreground">
            <span className="mr-1.5 text-primary">01</span>과목 선택
          </h2>
          <div className="flex flex-wrap gap-2">
            <ChoiceChip active={subject === ""} onClick={() => setSubject("")}>
              전체
            </ChoiceChip>
            {meta?.subjects.map((s) => (
              <ChoiceChip
                active={subject === s.subject}
                key={s.subject}
                onClick={() => setSubject(s.subject)}
              >
                {s.subject.replace(/^\d과목_/, "")}
                <span
                  className={
                    subject === s.subject
                      ? "text-primary-foreground/70"
                      : "text-muted-foreground"
                  }
                >
                  {s.count}
                </span>
              </ChoiceChip>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-[13px] text-foreground">
            <span className="mr-1.5 text-primary">02</span>문항 수
          </h2>
          <div className="grid grid-cols-3 gap-2 sm:max-w-sm">
            {[5, 10, 20].map((n) => (
              <ChoiceChip
                active={count === n}
                className="justify-center rounded-xl"
                key={n}
                onClick={() => setCount(n)}
              >
                {n}문제
              </ChoiceChip>
            ))}
          </div>
        </section>

        <div className="flex flex-col gap-3 border-border border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-muted-foreground">
            <b className="font-semibold text-foreground">
              {subject ? subject.replace(/^\d과목_/, "") : "전체 과목"}
            </b>
            {typeof subjectCount === "number"
              ? ` 문제 ${subjectCount.toLocaleString()}개 중 `
              : "에서 "}
            <b className="font-semibold text-foreground">{count}문제</b>를
            무작위로 출제해요
          </p>
          <Button
            className="h-11 gap-1.5 rounded-xl bg-brand px-5 text-[14px]"
            disabled={loading}
            onClick={begin}
          >
            {loading ? "준비 중..." : "연습 시작"}
            {loading ? null : <ArrowRightIcon className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
