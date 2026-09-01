"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ExamRunner, type ExamStartResponse } from "@/components/exam/exam-runner";
import { toast } from "@/components/chat/toast";

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
    fetch("/api/exam/meta")
      .then((r) => r.json())
      .then(setMeta)
      .catch(() => undefined);
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
      setStart(data);
    } catch (err) {
      toast({ type: "error", description: err instanceof Error ? err.message : "오류가 발생했습니다." });
    } finally {
      setLoading(false);
    }
  };

  if (start) {
    return <ExamRunner proctored={false} start={start} />;
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-10">
      <h1 className="font-semibold text-xl">문제 연습</h1>
      <p className="text-muted-foreground text-sm">
        과목과 문항 수를 골라 바로 풀어보세요. 모든 문제를 풀고 제출하면 채점 결과와 해설을 한 번에 확인할 수 있습니다.
      </p>

      <div className="flex flex-col gap-2">
        <span className="text-muted-foreground text-xs">과목</span>
        <div className="flex flex-wrap gap-2">
          <button
            className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
              subject === "" ? "border-ring bg-accent" : "border-border hover:border-ring"
            }`}
            onClick={() => setSubject("")}
            type="button"
          >
            전체
          </button>
          {meta?.subjects.map((s) => (
            <button
              className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                subject === s.subject ? "border-ring bg-accent" : "border-border hover:border-ring"
              }`}
              key={s.subject}
              onClick={() => setSubject(s.subject)}
              type="button"
            >
              {s.subject.replace(/^\d과목_/, "")} ({s.count})
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-muted-foreground text-xs">문항 수</span>
        <div className="flex gap-2">
          {[5, 10, 20].map((n) => (
            <button
              className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                count === n ? "border-ring bg-accent" : "border-border hover:border-ring"
              }`}
              key={n}
              onClick={() => setCount(n)}
              type="button"
            >
              {n}문제
            </button>
          ))}
        </div>
      </div>

      <Button className="mt-2" disabled={loading} onClick={begin}>
        {loading ? "준비 중..." : "연습 시작"}
      </Button>
    </div>
  );
}
