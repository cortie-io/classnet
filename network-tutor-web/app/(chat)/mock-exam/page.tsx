"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ExamRunner, type ExamStartResponse } from "@/components/exam/exam-runner";
import { toast } from "@/components/chat/toast";

export default function MockExamPage() {
  const [loading, setLoading] = useState(false);
  const [start, setStart] = useState<ExamStartResponse | null>(null);

  const begin = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/exam/mock/start", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "시작할 수 없습니다. 과목별 승인된 문제 수가 부족할 수 있습니다.");
      try {
        await document.documentElement.requestFullscreen?.();
      } catch {
        /* 전체화면이 막혀도 시험 자체는 계속 진행한다 */
      }
      setStart(data);
    } catch (err) {
      toast({ type: "error", description: err instanceof Error ? err.message : "오류가 발생했습니다." });
    } finally {
      setLoading(false);
    }
  };

  if (start) {
    return <ExamRunner proctored start={start} />;
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-10">
      <h1 className="font-semibold text-xl">모의고사</h1>
      <div className="rounded-2xl border border-border/50 bg-card p-5 text-[14px] leading-relaxed shadow-[var(--shadow-card)]">
        <p className="mb-2 font-medium">실제 네트워크관리사 2급 필기시험과 동일한 구성입니다.</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>1과목 네트워크 일반 10문제</li>
          <li>2과목 TCP/IP 17문제</li>
          <li>3과목 NOS 18문제</li>
          <li>4과목 네트워크 운용기기 5문제</li>
          <li>총 50문제, 제한시간 60분</li>
        </ul>
        <p className="mt-3 text-muted-foreground text-xs">
          시작하면 화면 이탈·전체화면 해제·복사/붙여넣기가 감지·기록되며, 제출 전까지는 정답을 확인할 수 없습니다.
        </p>
      </div>
      <Button disabled={loading} onClick={begin}>
        {loading ? "준비 중..." : "모의고사 시작"}
      </Button>
    </div>
  );
}
