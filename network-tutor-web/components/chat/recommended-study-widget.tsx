"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SparklesIcon } from "lucide-react";

interface Recommendation {
  hasSuggestion: boolean;
  level?: "topic" | "subject";
  label?: string;
  accuracy?: number;
}

// 취약 주제를 매번 학생이 직접 찾아 들어가지 않아도, 사이드바에서 바로 "오늘 뭘 복습하면 좋을지"를
// 보여주고 누르면 바로 채팅으로 관련 문제를 뽑아온다 — 학습 기능들 사이의 연속성을 높여달라는 요구사항 반영.
export function RecommendedStudyWidget() {
  const router = useRouter();
  const [rec, setRec] = useState<Recommendation | null>(null);

  useEffect(() => {
    fetch("/api/exam/recommended-topic")
      .then((r) => r.json())
      .then(setRec)
      .catch(() => undefined);
  }, []);

  if (!rec?.hasSuggestion || !rec.label) return null;

  const start = () => {
    router.push(`/?query=${encodeURIComponent(`${rec.label} 관련 문제 5개 뽑아줘`)}`);
  };

  return (
    <button
      className="mx-2 mb-1 flex flex-col gap-0.5 rounded-lg border border-sidebar-border px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent/50 group-data-[collapsible=icon]:hidden"
      onClick={start}
      type="button"
    >
      <span className="flex items-center gap-1.5 text-[11px] text-sidebar-foreground/60">
        <SparklesIcon className="size-3.5" />
        오늘의 추천 학습
      </span>
      <span className="text-[12.5px] text-sidebar-foreground">
        {rec.label}
        {typeof rec.accuracy === "number" && <span className="text-sidebar-foreground/50"> · 정답률 {rec.accuracy}%</span>}
      </span>
    </button>
  );
}
