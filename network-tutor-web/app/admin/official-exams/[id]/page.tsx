"use client";
import { adminFetch } from "@/lib/admin-period";

import {
  AwardIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  FileTextIcon,
  KeyRoundIcon,
  PencilIcon,
  RotateCcwIcon,
  SendIcon,
  ShieldAlertIcon,
  Trash2Icon,
} from "lucide-react";
import { AdminLink as Link } from "@/components/admin/service-period";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { PageIntro, PageLoading } from "@/components/chat/page-intro";
import { toast } from "@/components/chat/toast";
import { loadJson } from "@/components/load-json";
import { Button } from "@/components/ui/button";

interface Detail {
  exam: {
    id: number;
    title: string;
    description: string | null;
    duration_minutes: number;
    scheduled_start: string;
    scheduled_end: string;
    is_published: boolean;
    results_released: boolean;
    rank_released: boolean;
    max_violations: number;
    status: "upcoming" | "open" | "closed";
    question_count: number;
  };
  questions: {
    id: number;
    subject: string;
    stem: string;
    choices: string[] | null;
    correct_index: number | null;
    status: string;
  }[];
  roster: {
    user_id: number;
    student_id: string | null;
    name: string;
    department: string | null;
    attempt_id: number | null;
    status: string;
    score: number | null;
    started_at: string | null;
    submitted_at: string | null;
    flagged_for_review: boolean | null;
    device_locked: boolean | null;
    violations: number;
    rank: number | null;
  }[];
  stats: {
    studentCount: number;
    participantCount: number;
    submittedCount: number;
    inProgressCount: number;
    notStartedCount: number;
    flaggedCount: number;
    avgScore: number | null;
    maxScore: number | null;
    minScore: number | null;
  };
}

const STATUS = {
  not_started: { label: "미응시", tone: "bg-muted text-muted-foreground" },
  in_progress: { label: "응시 중", tone: "bg-sky-500/12 text-sky-700" },
  submitted: { label: "제출", tone: "bg-emerald-500/12 text-emerald-700" },
  auto_submitted: {
    label: "자동 제출",
    tone: "bg-amber-500/12 text-amber-700",
  },
  invalidated: {
    label: "무효",
    tone: "bg-muted text-muted-foreground line-through",
  },
} as Record<string, { label: string; tone: string }>;

const WINDOW = {
  upcoming: { label: "예정", tone: "bg-amber-500/12 text-amber-700" },
  open: { label: "응시 기간", tone: "bg-emerald-500/12 text-emerald-700" },
  closed: { label: "종료", tone: "bg-muted text-muted-foreground" },
};

const FILTERS = [
  { key: "all", label: "전체" },
  { key: "done", label: "제출" },
  { key: "in_progress", label: "응시 중" },
  { key: "not_started", label: "미응시" },
  { key: "flagged", label: "검토 대상" },
] as const;

async function call(url: string, method = "POST", body: unknown = {}) {
  const res = await adminFetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      typeof data?.error === "string" ? data.error : "요청을 처리하지 못했어요."
    );
  return data;
}

function Switch({
  on,
  disabled,
  onChange,
  label,
  hint,
}: {
  on: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      className={`flex items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-left transition-colors ${on ? "border-primary/40 bg-accent/60" : "border-border bg-card"} disabled:opacity-50`}
      disabled={disabled}
      onClick={() => onChange(!on)}
      type="button"
    >
      <span>
        <span className="block font-semibold text-[14px]">{label}</span>
        <span className="block text-[12px] text-muted-foreground">{hint}</span>
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-muted-foreground/30"}`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

export default function AdminOfficialExamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [busy, setBusy] = useState(false);
  const [showQuestions, setShowQuestions] = useState(false);

  const load = useCallback(
    () =>
      loadJson<Detail>(
        `/api/admin/official-exams/${encodeURIComponent(id)}`,
        setData
      ),
    [id]
  );
  useEffect(() => {
    load();
  }, [load]);
  // 응시 기간 중에는 15초마다 새로 고친다(응시 중·제출 현황이 실시간으로 바뀐다).
  useEffect(() => {
    if (data?.exam.status !== "open") return;
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [data?.exam.status, load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast({ type: "success", description: ok });
      await load();
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "요청을 처리하지 못했어요.",
      });
    } finally {
      setBusy(false);
    }
  };

  const rows = useMemo(() => {
    if (!data) return [];
    return data.roster.filter((r) => {
      if (filter === "done")
        return r.status === "submitted" || r.status === "auto_submitted";
      if (filter === "flagged")
        return r.flagged_for_review && r.status !== "invalidated";
      if (filter === "not_started")
        return r.status === "not_started" || r.status === "invalidated";
      if (filter === "in_progress") return r.status === "in_progress";
      return true;
    });
  }, [data, filter]);

  if (!data) return <PageLoading />;
  const { exam, stats } = data;
  const base = `/api/admin/official-exams/${exam.id}`;

  const exportCsv = async () => {
    try {
      const res = await adminFetch(`${base}/export`);
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "내보내지 못했어요.");
      const url = URL.createObjectURL(
        new Blob([d.csv], { type: "text/csv;charset=utf-8" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `${exam.title}-결과.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        type: "error",
        description: err instanceof Error ? err.message : "내보내지 못했어요.",
      });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        description={`${new Date(exam.scheduled_start).toLocaleString("ko-KR")} ~ ${new Date(exam.scheduled_end).toLocaleString("ko-KR")} · ${exam.question_count}문항 · ${exam.duration_minutes}분 · 위반 ${exam.max_violations}회 자동 제출`}
        icon={AwardIcon}
        title={exam.title}
      >
        <span
          className={`self-center rounded-full px-2.5 py-1 font-semibold text-[12px] ${WINDOW[exam.status].tone}`}
        >
          {WINDOW[exam.status].label}
        </span>
        <Button onClick={exportCsv} size="sm" variant="outline">
          <DownloadIcon className="size-3.5" /> CSV
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={`/admin/official-exams/${exam.id}/edit`}>
            <PencilIcon className="size-3.5" /> 수정
          </Link>
        </Button>
        {stats.participantCount === 0 ? (
          <Button
            className="text-destructive"
            disabled={busy}
            onClick={() =>
              confirm("이 시험을 삭제할까요?") &&
              run(async () => {
                await call(base, "DELETE");
                router.push("/admin/official-exams");
              }, "삭제했어요.")
            }
            size="sm"
            variant="ghost"
          >
            <Trash2Icon className="size-3.5" /> 삭제
          </Button>
        ) : null}
      </PageIntro>

      <div className="grid gap-3 md:grid-cols-3">
        <Switch
          disabled={busy || (exam.is_published && stats.participantCount > 0)}
          hint={
            exam.is_published ? "학생 목록에 보여요" : "학생에게 아직 안 보여요"
          }
          label="학생에게 공개"
          on={exam.is_published}
          onChange={(v) =>
            run(
              () => call(`${base}/${v ? "publish" : "unpublish"}`),
              v ? "학생에게 공개했어요." : "비공개로 돌렸어요."
            )
          }
        />
        <Switch
          disabled={busy}
          hint="점수·정답·해설을 학생이 볼 수 있어요"
          label="결과 공개"
          on={exam.results_released}
          onChange={(v) =>
            run(
              () =>
                call(`${base}/release`, "POST", {
                  results: v,
                  rank: v ? exam.rank_released : false,
                }),
              v ? "결과를 공개했어요." : "결과를 다시 감췄어요."
            )
          }
        />
        <Switch
          disabled={busy || !exam.results_released}
          hint="학생에게 '○명 중 ○등'을 보여 줘요"
          label="등수 공개"
          on={exam.rank_released}
          onChange={(v) =>
            run(
              () => call(`${base}/release`, "POST", { results: true, rank: v }),
              v ? "등수를 공개했어요." : "등수를 감췄어요."
            )
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {[
          { label: "응시 대상", value: stats.studentCount },
          { label: "제출", value: stats.submittedCount },
          { label: "응시 중", value: stats.inProgressCount },
          { label: "미응시", value: stats.notStartedCount },
          { label: "평균", value: stats.avgScore ?? "-" },
          {
            label: "최고 / 최저",
            value:
              stats.maxScore !== null
                ? `${stats.maxScore} / ${stats.minScore}`
                : "-",
          },
          {
            label: "검토 대상",
            value: stats.flaggedCount,
            alert: stats.flaggedCount > 0,
          },
        ].map((t) => (
          <div className="surface p-4" key={t.label}>
            <p className="text-[12px] text-muted-foreground">{t.label}</p>
            <p
              className={`mt-1 font-extrabold text-[22px] tabular-nums tracking-tight ${t.alert ? "text-destructive" : ""}`}
            >
              {t.value}
            </p>
          </div>
        ))}
      </div>

      <div className="surface overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-border border-b px-4 py-3">
          <h2 className="mr-2 font-semibold text-[14px]">응시 현황 · 등수</h2>
          {FILTERS.map((f) => (
            <button
              className={`rounded-full border px-3 py-1 font-medium text-[12.5px] ${filter === f.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-primary"}`}
              key={f.key}
              onClick={() => setFilter(f.key)}
              type="button"
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="table w-full min-w-[900px] text-[13px]">
            <thead>
              <tr className="border-border border-b bg-muted/50 text-[12px] text-muted-foreground">
                <th className="px-4 py-2.5 text-right font-semibold">등수</th>
                <th className="px-4 py-2.5 text-left font-semibold">학번</th>
                <th className="px-4 py-2.5 text-left font-semibold">이름</th>
                <th className="px-4 py-2.5 text-left font-semibold">상태</th>
                <th className="px-4 py-2.5 text-right font-semibold">점수</th>
                <th className="px-4 py-2.5 text-right font-semibold">위반</th>
                <th className="px-4 py-2.5 text-left font-semibold">
                  시작 · 제출
                </th>
                <th className="px-4 py-2.5 text-right font-semibold">관리</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = STATUS[r.status] ?? STATUS.not_started;
                return (
                  <tr
                    className="border-border border-b last:border-0 hover:bg-accent/40"
                    key={r.user_id}
                  >
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                      {r.rank ?? "-"}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {r.student_id ?? "-"}
                    </td>
                    <td className="px-4 py-2.5 font-medium">
                      {r.name}
                      {r.flagged_for_review && r.status !== "invalidated" ? (
                        <ShieldAlertIcon
                          aria-label="검토 대상"
                          className="ml-1.5 inline size-3.5 text-destructive"
                        />
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 font-semibold text-[11.5px] ${st.tone}`}
                      >
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                      {r.score ?? "-"}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right tabular-nums ${r.violations > 0 ? "font-bold text-destructive" : "text-muted-foreground"}`}
                    >
                      {r.attempt_id ? r.violations : "-"}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-muted-foreground">
                      {r.started_at
                        ? new Date(r.started_at).toLocaleTimeString("ko-KR")
                        : "-"}
                      {r.submitted_at
                        ? ` → ${new Date(r.submitted_at).toLocaleTimeString("ko-KR")}`
                        : ""}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.attempt_id ? (
                        <div className="flex justify-end gap-1">
                          <Button asChild size="xs" variant="ghost">
                            <Link
                              href={`/admin/official-exams/${exam.id}/attempts/${r.attempt_id}`}
                            >
                              <FileTextIcon className="size-3" /> 답안·기록
                            </Link>
                          </Button>
                          {r.status === "in_progress" && r.device_locked ? (
                            <Button
                              disabled={busy}
                              onClick={() =>
                                confirm(
                                  `${r.name} 학생의 기기 잠금을 풀까요? 다음에 시험을 여는 기기에서 이어서 풀게 돼요.`
                                ) &&
                                run(
                                  () =>
                                    call(
                                      `${base}/attempts/${r.attempt_id}/reset-device`
                                    ),
                                  "기기 잠금을 풀었어요."
                                )
                              }
                              size="xs"
                              variant="ghost"
                            >
                              <KeyRoundIcon className="size-3" /> 잠금 해제
                            </Button>
                          ) : null}
                          {r.status === "in_progress" ? (
                            <Button
                              disabled={busy}
                              onClick={() =>
                                confirm(
                                  `${r.name} 학생의 시험을 지금 제출 처리할까요?`
                                ) &&
                                run(
                                  () =>
                                    call(
                                      `${base}/attempts/${r.attempt_id}/force-submit`
                                    ),
                                  "제출 처리했어요."
                                )
                              }
                              size="xs"
                              variant="ghost"
                            >
                              <SendIcon className="size-3" /> 강제 제출
                            </Button>
                          ) : null}
                          {r.status !== "invalidated" ? (
                            <Button
                              className="text-destructive"
                              disabled={busy}
                              onClick={() =>
                                confirm(
                                  `${r.name} 학생의 응시를 무효로 할까요? 점수가 빠지고, 학생은 다시 응시할 수 있게 돼요.`
                                ) &&
                                run(
                                  () =>
                                    call(
                                      `${base}/attempts/${r.attempt_id}/invalidate`
                                    ),
                                  "무효 처리했어요."
                                )
                              }
                              size="xs"
                              variant="ghost"
                            >
                              <RotateCcwIcon className="size-3" /> 무효·재응시
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="surface p-5">
        <button
          className="flex w-full items-center justify-between font-semibold text-[14px]"
          onClick={() => setShowQuestions((x) => !x)}
          type="button"
        >
          문항 · 정답 보기 ({data.questions.length})
          {showQuestions ? (
            <EyeOffIcon className="size-4 text-muted-foreground" />
          ) : (
            <EyeIcon className="size-4 text-muted-foreground" />
          )}
        </button>
        {showQuestions ? (
          <ol className="mt-4 flex flex-col gap-3">
            {data.questions.map((q, i) => (
              <li
                className="rounded-xl border border-border p-3.5 text-[13px]"
                key={q.id}
              >
                <p className="font-semibold">
                  {i + 1}. {q.stem}
                </p>
                {q.choices ? (
                  <ol className="mt-2 flex flex-col gap-1">
                    {q.choices.map((c, ci) => (
                      <li
                        className={
                          ci === q.correct_index
                            ? "font-semibold text-emerald-700"
                            : "text-muted-foreground"
                        }
                        key={ci}
                      >
                        {ci + 1}) {c} {ci === q.correct_index ? "← 정답" : ""}
                      </li>
                    ))}
                  </ol>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
