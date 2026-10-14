"use client";

import { ArrowRightIcon, ShieldCheckIcon, TimerIcon } from "lucide-react";
import { useState } from "react";
import { PageIntro } from "@/components/chat/page-intro";
import { Button } from "@/components/ui/button";
import { ExamRunner, type ExamStartResponse } from "@/components/exam/exam-runner";
import { toast } from "@/components/chat/toast";

const SECTIONS = [
  { no: 1, name: "네트워크 일반", count: 10 },
  { no: 2, name: "TCP/IP", count: 17 },
  { no: 3, name: "NOS", count: 18 },
  { no: 4, name: "네트워크 운용기기", count: 5 },
];

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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:py-12">
      <PageIntro
        description="실제 네트워크관리사 2급 필기시험과 똑같은 구성으로 실전 감각을 길러보세요."
        icon={TimerIcon}
        title="모의고사"
      />

      <div className="surface overflow-hidden">
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          {SECTIONS.map((sec) => (
            <div className="flex flex-col gap-1 bg-card px-4 py-4" key={sec.no}>
              <span className="font-semibold text-[11.5px] text-primary">{sec.no}과목</span>
              <span className="font-semibold text-[14px] text-foreground">{sec.name}</span>
              <span className="text-[12.5px] text-muted-foreground">{sec.count}문제</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-border border-t bg-brand-soft px-5 py-4">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[12.5px] text-muted-foreground">총</span>
            <span className="font-extrabold text-[22px] text-foreground tracking-tight">50</span>
            <span className="text-[13px] text-muted-foreground">문제</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[12.5px] text-muted-foreground">제한시간</span>
            <span className="font-extrabold text-[22px] text-foreground tracking-tight">60</span>
            <span className="text-[13px] text-muted-foreground">분</span>
          </div>
        </div>
      </div>

      <div className="flex gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3.5 text-[13px] leading-relaxed">
        <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <p className="text-foreground/80">
          시작하면 전체화면으로 전환되고, 화면 이탈·전체화면 해제·복사/붙여넣기가 감지·기록돼요. 제출하기 전까지는 정답을
          확인할 수 없어요.
        </p>
      </div>

      <Button className="h-12 gap-1.5 rounded-xl bg-brand text-[15px]" disabled={loading} onClick={begin}>
        {loading ? "준비 중..." : "모의고사 시작"}
        {loading ? null : <ArrowRightIcon className="size-4" />}
      </Button>
    </div>
  );
}
