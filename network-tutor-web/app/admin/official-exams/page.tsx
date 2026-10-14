"use client";

import { AwardIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { AdminLink as Link } from "@/components/admin/service-period";
import { useEffect, useState } from "react";
import {
  PageIntro,
  PageLoading,
  PageNotice,
} from "@/components/chat/page-intro";
import { loadJson } from "@/components/load-json";
import { Button } from "@/components/ui/button";

interface Row {
  id: number;
  title: string;
  scheduled_start: string;
  scheduled_end: string;
  duration_minutes: number;
  is_published: boolean;
  results_released: boolean;
  question_count: number;
  participant_count: number;
  submitted_count: number;
  in_progress_count: number;
  flagged_count: number;
  student_count: number;
  avg_score: number | null;
  status: "upcoming" | "open" | "closed";
}

const EXAM_STATUS = {
  upcoming: { label: "예정", tone: "bg-amber-500/12 text-amber-700" },
  open: { label: "응시 기간", tone: "bg-emerald-500/12 text-emerald-700" },
  closed: { label: "종료", tone: "bg-muted text-muted-foreground" },
} as const;

export default function AdminOfficialExamsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    loadJson("/api/admin/official-exams", setRows, {
      onError: () => setRows([]),
    });
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        description="전체 학생이 정해진 기간에 한 번 치르는 실전 시험이에요. 결과 공개 여부를 직접 정하고, 학습 순위에는 반영되지 않아요."
        icon={AwardIcon}
        title="공식 모의시험"
      >
        <Button asChild className="rounded-xl bg-brand">
          <Link href="/admin/official-exams/new">
            <PlusIcon className="size-4" /> 새 시험 만들기
          </Link>
        </Button>
      </PageIntro>
      {rows === null ? (
        <PageLoading />
      ) : rows.length === 0 ? (
        <PageNotice
          description="새 시험 만들기로 첫 공식 모의시험을 만들어 보세요."
          icon={AwardIcon}
          title="아직 만든 공식 모의시험이 없어요"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <Link
              className="surface surface-hover group flex flex-col gap-3 p-5 sm:flex-row sm:items-center"
              href={`/admin/official-exams/${r.id}`}
              key={r.id}
            >
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 font-semibold text-[11.5px] ${EXAM_STATUS[r.status].tone}`}
                  >
                    {EXAM_STATUS[r.status].label}
                  </span>
                  {!r.is_published ? (
                    <span className="rounded-full bg-muted px-2.5 py-0.5 font-semibold text-[11.5px] text-muted-foreground">
                      비공개
                    </span>
                  ) : null}
                  {r.results_released ? (
                    <span className="rounded-full bg-accent px-2.5 py-0.5 font-semibold text-[11.5px] text-primary">
                      결과 공개됨
                    </span>
                  ) : null}
                  <span className="font-semibold text-[15px]">{r.title}</span>
                </div>
                <p className="text-[12.5px] text-muted-foreground">
                  {new Date(r.scheduled_start).toLocaleString("ko-KR")} ~{" "}
                  {new Date(r.scheduled_end).toLocaleString("ko-KR")} ·{" "}
                  {r.question_count}문항 · {r.duration_minutes}분
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-5 text-center text-[12px] text-muted-foreground">
                <div>
                  <p className="font-bold text-[17px] text-foreground tabular-nums">
                    {r.submitted_count}
                    <span className="font-medium text-[12px] text-muted-foreground">
                      /{r.student_count}
                    </span>
                  </p>
                  제출
                </div>
                <div>
                  <p className="font-bold text-[17px] text-foreground tabular-nums">
                    {r.avg_score ?? "-"}
                  </p>
                  평균
                </div>
                <div>
                  <p
                    className={`font-bold text-[17px] tabular-nums ${r.flagged_count > 0 ? "text-destructive" : "text-foreground"}`}
                  >
                    {r.flagged_count}
                  </p>
                  검토
                </div>
                <ChevronRightIcon className="size-4 text-muted-foreground/50 group-hover:text-primary" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
