"use client";

import { subjectLabel } from "@/lib/subject";
import { ArrowRightIcon, BookOpenCheckIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { PageIntro } from "@/components/chat/page-intro";
import { Button } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { handOffAttempt } from "@/lib/attempt-handoff";
import { useRouter } from "next/navigation";
import { toast } from "@/components/chat/toast";
import { loadJson } from "@/components/load-json";

import { savePracticeSelection } from "@/lib/practice-continuation";

const COUNTS = [5, 10, 20, 30];
const LAST_KEY = "classnet:practice:last";

interface Meta {
  subjects: { subject: string; count: number }[];
}

export default function PracticePage() {
  const router = useRouter();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [subject, setSubject] = useState<string>("");
  const [count, setCount] = useState(10);
  const [unseenFirst, setUnseenFirst] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadJson("/api/exam/meta", setMeta);
    // 지난번에 고른 과목·문항 수를 기억한다. 리포트의 "이 과목 연습하기"는 ?subject=로 과목을 넘긴다.
    try {
      const last = JSON.parse(localStorage.getItem(LAST_KEY) ?? "null");
      if (last && typeof last.subject === "string") setSubject(last.subject);
      if (last && COUNTS.includes(last.count)) setCount(last.count);
      if (last && typeof last.unseenFirst === "boolean")
        setUnseenFirst(last.unseenFirst);
    } catch {
      /* 저장소를 못 써도 기본값으로 동작 */
    }
    const fromQuery = new URLSearchParams(window.location.search).get(
      "subject"
    );
    if (fromQuery) setSubject(fromQuery);
  }, []);

  const begin = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/exam/practice/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject || undefined,
          count,
          unseenFirst,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "시작할 수 없습니다.");
      savePracticeSelection(data.attemptId, { subject, count, unseenFirst });
      try {
        localStorage.setItem(
          LAST_KEY,
          JSON.stringify({ subject, count, unseenFirst })
        );
      } catch {
        /* 기억만 못 할 뿐 */
      }
      router.push(handOffAttempt(data));
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
                {subjectLabel(s.subject)}
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
          <div className="grid grid-cols-4 gap-2 sm:max-w-md">
            {COUNTS.map((n) => (
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

        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-[13px] text-foreground">
            <span className="mr-1.5 text-primary">03</span>출제 방식
          </h2>
          <div className="flex flex-wrap gap-2">
            <ChoiceChip
              active={unseenFirst}
              onClick={() => setUnseenFirst(true)}
            >
              안 푼 문제 먼저
            </ChoiceChip>
            <ChoiceChip
              active={!unseenFirst}
              onClick={() => setUnseenFirst(false)}
            >
              전체에서 무작위
            </ChoiceChip>
          </div>
          <p className="text-[12px] text-muted-foreground">
            {unseenFirst
              ? "한 번도 안 풀어 본 문제부터 내고, 모자라면 푼 문제에서 채워요."
              : "이미 푼 문제도 섞어서 나올 수 있어요."}
          </p>
        </section>

        <div className="flex flex-col gap-3 border-border border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-muted-foreground">
            <b className="font-semibold text-foreground">
              {subject ? subjectLabel(subject) : "전체 과목"}
            </b>
            {typeof subjectCount === "number"
              ? ` 문제 ${subjectCount.toLocaleString()}개 중 `
              : "에서 "}
            <b className="font-semibold text-foreground">{count}문제</b>를
            {unseenFirst ? " 안 푼 문제부터 " : " 무작위로 "}출제해요
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
