"use client";

import {
  AwardIcon,
  CalendarRangeIcon,
  ClipboardCheckIcon,
  ListOrderedIcon,
  TimerIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  PageIntro,
  PageLoading,
  PageNotice,
} from "@/components/chat/page-intro";
import { loadJson } from "@/components/load-json";
import { Button } from "@/components/ui/button";

interface OfficialExamRow {
  id: number;
  title: string;
  description: string | null;
  durationMinutes: number;
  scheduledStart: string;
  scheduledEnd: string;
  questionCount: number;
  status: "upcoming" | "open" | "closed";
  myStatus: "not_started" | "in_progress" | "submitted" | "auto_submitted";
  resultsReleased: boolean;
}

const WINDOW_LABEL = {
  upcoming: "응시 예정",
  open: "응시 기간",
  closed: "기간 종료",
} as const;
const WINDOW_TONE = {
  upcoming: "bg-amber-500/12 text-amber-700",
  open: "bg-emerald-500/12 text-emerald-700",
  closed: "bg-muted text-muted-foreground",
} as const;

function action(row: OfficialExamRow) {
  if (row.myStatus === "in_progress")
    return {
      label: "이어서 응시",
      href: `/exam-room/${row.id}`,
      primary: true,
    };
  if (row.myStatus === "submitted" || row.myStatus === "auto_submitted") {
    return row.resultsReleased
      ? {
          label: "결과 보기",
          href: `/official-exams/${row.id}/result`,
          primary: true,
        }
      : { label: "결과 공개 전", href: null, primary: false };
  }
  if (row.status === "open")
    return { label: "응시하기", href: `/exam-room/${row.id}`, primary: true };
  if (row.status === "upcoming")
    return { label: "응시 전", href: null, primary: false };
  return { label: "미응시", href: null, primary: false };
}

export default function OfficialExamsPage() {
  const [rows, setRows] = useState<OfficialExamRow[] | null>(null);

  useEffect(() => {
    loadJson("/api/official-exams", setRows, { onError: () => setRows([]) });
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
      <PageIntro
        description="선생님이 정한 기간에 전체 학생이 함께 치르는 실전 모의시험이에요. 한 번만 응시할 수 있고, 결과는 선생님이 공개하면 확인할 수 있어요."
        icon={AwardIcon}
        title="공식 모의시험"
      />
      {rows === null ? (
        <PageLoading />
      ) : rows.length === 0 ? (
        <PageNotice
          icon={ClipboardCheckIcon}
          title="아직 예정된 공식 모의시험이 없어요"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => {
            const a = action(r);
            return (
              <div
                className={`surface flex flex-col gap-4 p-5 sm:flex-row sm:items-center ${r.status === "open" && r.myStatus === "not_started" ? "border-primary/30" : ""}`}
                key={r.id}
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 font-semibold text-[11.5px] ${WINDOW_TONE[r.status]}`}
                    >
                      {WINDOW_LABEL[r.status]}
                    </span>
                    {r.myStatus === "submitted" ||
                    r.myStatus === "auto_submitted" ? (
                      <span className="rounded-full bg-accent px-2.5 py-0.5 font-semibold text-[11.5px] text-primary">
                        응시 완료
                      </span>
                    ) : null}
                    <span className="font-semibold text-[15px]">{r.title}</span>
                  </div>
                  {r.description ? (
                    <p className="mb-2 line-clamp-2 text-[13px] text-muted-foreground">
                      {r.description}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <ListOrderedIcon className="size-3.5" />
                      {r.questionCount}문제
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <TimerIcon className="size-3.5" />
                      {r.durationMinutes}분
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarRangeIcon className="size-3.5" />
                      {new Date(r.scheduledStart).toLocaleString("ko-KR")} ~{" "}
                      {new Date(r.scheduledEnd).toLocaleString("ko-KR")}
                    </span>
                  </div>
                </div>
                {a.href ? (
                  <Button
                    asChild
                    className={`h-10 shrink-0 rounded-xl px-5 ${a.primary ? "bg-brand" : ""}`}
                    variant={a.primary ? "default" : "outline"}
                  >
                    <Link href={a.href}>{a.label}</Link>
                  </Button>
                ) : (
                  <Button
                    className="h-10 shrink-0 rounded-xl px-5"
                    disabled
                    variant="outline"
                  >
                    {a.label}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
