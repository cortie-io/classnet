"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface AttemptSummary {
  id: number;
  status: string;
  score: number | null;
  startedAt: string;
  submittedAt: string | null;
  setKind: string | null;
  setTitle: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  in_progress: "진행 중",
  submitted: "제출 완료",
  auto_submitted: "시간 초과 자동 제출",
  invalidated: "무효 처리됨",
};

const KIND_LABEL: Record<string, string> = {
  practice_custom: "연습",
  mock: "모의고사",
  admin_timed: "지정 시험",
};

export default function MyExamsPage() {
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/exam/attempts")
      .then((r) => r.json())
      .then(setAttempts)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8">
      <h1 className="font-semibold text-xl">내 응시 기록</h1>
      {loading && <p className="text-muted-foreground text-sm">불러오는 중...</p>}
      {!loading && attempts.length === 0 && (
        <p className="text-muted-foreground text-sm">아직 응시한 기록이 없습니다.</p>
      )}
      <div className="flex flex-col gap-2">
        {attempts.map((a) => (
          <Link
            className="flex items-center justify-between rounded-xl border border-border/50 bg-card px-4 py-3 text-[13px] shadow-[var(--shadow-card)] transition-all duration-200 hover:-translate-y-0.5 hover:border-ring hover:shadow-[var(--shadow-float)]"
            href={`/exam/${a.id}`}
            key={a.id}
          >
            <div>
              <p className="font-medium">{a.setTitle ?? (a.setKind ? KIND_LABEL[a.setKind] : "연습")}</p>
              <p className="text-muted-foreground text-xs">{new Date(a.startedAt).toLocaleString("ko-KR")}</p>
            </div>
            <div className="text-right">
              <p className="text-muted-foreground">{STATUS_LABEL[a.status] ?? a.status}</p>
              {a.score !== null && <p className="font-semibold">{a.score}점</p>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
