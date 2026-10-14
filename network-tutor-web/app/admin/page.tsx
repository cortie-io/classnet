"use client";
import { ServiceLaunchPanel } from "@/components/admin/service-launch";
import { PeriodButton } from "@/components/admin/service-period";
import { adminFetch } from "@/lib/admin-period";

import { useEffect, useState } from "react";
import {
  ChevronRightIcon,
  ClipboardCheckIcon,
  FileClockIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  MessageSquareWarningIcon,
  UsersIcon,
} from "lucide-react";
import { PageIntro } from "@/components/chat/page-intro";
import { AdminLink as Link } from "@/components/admin/service-period";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/chat/toast";
import { loadJson } from "@/components/load-json";

interface QuestionStats {
  byStatus: { status: string; count: number }[];
}
interface AuditStats {
  byStatus: { verification_status: string; count: number }[];
  pendingReview: number;
}
interface StudentRow {
  id: number;
  role: string;
  question_count: number;
}

interface Overview {
  studentCount: number;
  overallAccuracy: { correct: string; total: string };
  bySubject: { subject: string; correct: string; total: string }[];
  mostMissed: {
    id: number;
    stem: string;
    subject: string;
    correct: string;
    total: string;
  }[];
  recentActivity: { day: string; count: string }[];
  mostActiveStudents: {
    id: number;
    name: string;
    email: string;
    attempt_count: string;
  }[];
}

function pct(correct: string | number, total: string | number): number {
  const t = Number(total);
  return t > 0 ? Math.round((Number(correct) / t) * 1000) / 10 : 0;
}

function Tile({
  label,
  value,
  href,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  href: string;
  icon: LucideIcon;
}) {
  return (
    <Link
      className="surface surface-hover group flex flex-col gap-3 p-5"
      href={href}
    >
      <span className="flex items-center justify-between">
        <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-primary">
          <Icon className="size-[18px]" />
        </span>
        <ChevronRightIcon className="size-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
      </span>
      <span>
        <span className="block text-[12.5px] text-muted-foreground">
          {label}
        </span>
        <span className="font-extrabold text-[28px] text-foreground tabular-nums tracking-tight">
          {value}
        </span>
      </span>
    </Link>
  );
}

export default function AdminDashboardPage() {
  const [qStats, setQStats] = useState<QuestionStats | null>(null);
  const [aStats, setAStats] = useState<AuditStats | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [examDate, setExamDate] = useState("");
  const [savingDate, setSavingDate] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);

  useEffect(() => {
    loadJson("/api/admin/exam/stats", setQStats);
    loadJson("/api/audit-summary/stats", setAStats);
    loadJson("/api/admin/users", setStudents);
    loadJson<{ examDate?: string | null }>("/api/settings/exam-date", (d) =>
      setExamDate(d.examDate ?? "")
    );
    loadJson("/api/admin/analytics/overview", setOverview);
  }, []);

  const saveExamDate = async () => {
    setSavingDate(true);
    try {
      const res = await adminFetch("/api/admin/settings/exam-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examDate: examDate || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "저장 실패");
      toast({
        type: "success",
        description: "시험일이 저장되었습니다. 학생 화면에 D-day가 표시됩니다.",
      });
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "오류가 발생했습니다.",
      });
    } finally {
      setSavingDate(false);
    }
  };

  const pendingQuestions =
    qStats?.byStatus.find((s) => s.status === "pending_review")?.count ?? 0;
  const approvedQuestions =
    qStats?.byStatus.find((s) => s.status === "approved")?.count ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        description="학생들의 학습 현황과 검수할 항목을 한눈에 확인하세요."
        icon={LayoutDashboardIcon}
        title="대시보드"
      />
      <ServiceLaunchPanel />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile
          href="/admin/students"
          icon={UsersIcon}
          label="전체 학생 수"
          value={
            overview?.studentCount ??
            students.filter((s) => s.role !== "admin").length
          }
        />
        <Tile
          href="/admin/questions"
          icon={FileClockIcon}
          label="검수 대기 문제"
          value={pendingQuestions}
        />
        <Tile
          href="/admin/questions"
          icon={ClipboardCheckIcon}
          label="승인된 문제"
          value={approvedQuestions}
        />
        <Tile
          href="/admin/audit"
          icon={MessageSquareWarningIcon}
          label="교사 검수 대기(질의응답)"
          value={aStats?.pendingReview ?? 0}
        />
      </div>

      {overview && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="surface p-5">
            <h2 className="mb-1 font-semibold text-[14px]">전체 정답률</h2>
            <p className="mb-3 text-muted-foreground text-xs">
              전 학생 응시 기준 · {overview.overallAccuracy.total}건 채점됨
            </p>
            <p className="mb-5 font-extrabold text-[34px] text-primary tabular-nums tracking-tight">
              {pct(
                overview.overallAccuracy.correct,
                overview.overallAccuracy.total
              )}
              %
            </p>
            <div className="flex flex-col gap-2">
              {overview.bySubject.map((s) => {
                const p = pct(s.correct, s.total);
                return (
                  <div className="flex flex-col gap-1" key={s.subject}>
                    <div className="flex items-center justify-between text-[12.5px]">
                      <span>{s.subject.replace(/^\d과목_/, "")}</span>
                      <span className="text-muted-foreground">
                        {p}% ({s.total}건)
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${p >= 70 ? "bg-brand" : p >= 50 ? "bg-amber-400" : "bg-destructive/80"}`}
                        style={{ width: `${Math.min(100, p)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="surface p-5">
            <h2 className="mb-1 font-semibold text-[14px]">
              정답률 최저 문제 (검토 필요 가능성)
            </h2>
            <p className="mb-3 text-muted-foreground text-xs">
              5회 이상 응답된 문제 중 정답률이 가장 낮은 순 — 지문/정답 오류
              확인용
            </p>
            <div className="flex flex-col gap-2">
              {overview.mostMissed.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  아직 데이터가 충분하지 않습니다.
                </p>
              )}
              {overview.mostMissed.slice(0, 5).map((q) => (
                <div
                  className="rounded-xl border border-destructive/15 bg-destructive/5 px-3.5 py-2.5 text-[12.5px]"
                  key={q.id}
                >
                  <div className="mb-0.5 flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      {q.subject.replace(/^\d과목_/, "")}
                    </span>
                    <span className="font-medium text-destructive">
                      {pct(q.correct, q.total)}% ({q.correct}/{q.total})
                    </span>
                  </div>
                  <p className="line-clamp-2">{q.stem}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="surface p-5 lg:col-span-2">
            <h2 className="mb-3 font-semibold text-[14px]">
              최근 14일간 가장 활발한 학생
            </h2>
            <div className="flex flex-wrap gap-2">
              {overview.mostActiveStudents.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  최근 응시 기록이 없습니다.
                </p>
              )}
              {overview.mostActiveStudents.map((s) => (
                <Link
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-[12.5px] transition-colors hover:border-primary/40 hover:text-primary"
                  href={`/admin/students/${s.id}`}
                  key={s.id}
                >
                  {s.name} · {s.attempt_count}회
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="surface p-5">
        <h2 className="mb-1 font-semibold text-[14px]">시험일 설정</h2>
        <p className="mb-3 text-muted-foreground text-xs">
          설정하면 학생 화면 사이드바에 D-day 카운트다운이 표시됩니다.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            className="sm:w-48"
            onChange={(e) => setExamDate(e.target.value)}
            type="date"
            value={examDate}
          />
          <PeriodButton disabled={savingDate} onClick={saveExamDate} size="sm">
            저장
          </PeriodButton>
          {examDate && (
            <PeriodButton
              onClick={() => setExamDate("")}
              size="sm"
              variant="outline"
            >
              해제
            </PeriodButton>
          )}
        </div>
      </div>

      <div className="surface p-5">
        <h2 className="mb-3 font-semibold text-[14px]">빠른 작업</h2>
        <div className="flex flex-wrap gap-2 text-[13px]">
          <Link
            className="rounded-xl border border-border bg-card px-3.5 py-2 font-medium shadow-[var(--shadow-card)] transition-colors hover:border-primary/40 hover:text-primary"
            href="/admin/students"
          >
            학생 계정 추가 / CSV 일괄 등록
          </Link>
          <Link
            className="rounded-xl border border-border bg-card px-3.5 py-2 font-medium shadow-[var(--shadow-card)] transition-colors hover:border-primary/40 hover:text-primary"
            href="/admin/questions"
          >
            AI 생성 문제 검수
          </Link>
          <Link
            className="rounded-xl border border-border bg-card px-3.5 py-2 font-medium shadow-[var(--shadow-card)] transition-colors hover:border-primary/40 hover:text-primary"
            href="/admin/exams"
          >
            시험 만들기
          </Link>
        </div>
      </div>
    </div>
  );
}
