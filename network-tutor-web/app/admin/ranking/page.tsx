"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/chat/toast";

interface RankedStudent {
  id: number;
  studentId: string | null;
  name: string;
  email: string;
  chatCount: number;
  questionsAttempted: number;
  questionsCorrect: number;
  questionsGraded: number;
  accuracyPct: number;
  activeDays: number;
  compositeScore: number;
  rank: number;
  preTestScore: number | null;
  postTestScore: number | null;
  improvement: number | null;
}

interface PrePostSummary {
  preParticipantCount: number;
  avgPreTestScore: number | null;
  postParticipantCount: number;
  avgPostTestScore: number | null;
  improvementParticipantCount: number;
  avgImprovement: number | null;
}

interface RankingResponse {
  methodology: string;
  noUsageYet: boolean;
  prePostNote: string;
  prePostSummary: PrePostSummary | null;
  students: RankedStudent[];
}

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type PrePostField = "pre" | "post";

export default function RankingPage() {
  const [data, setData] = useState<RankingResponse | null>(null);
  // 편집 대상은 (학생 id, pre/post) 조합이라 문자열 키("id:pre"/"id:post")로 묶어서 관리한다.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = () => {
    fetch("/api/admin/analytics/ranking", { cache: "no-store" }).then((r) => r.json()).then(setData);
  };

  useEffect(() => {
    load();
    const intervalId = setInterval(load, 5000); // 배치가 계속 채팅 기록을 쌓으므로 화면도 주기적으로 최신화한다
    return () => clearInterval(intervalId);
  }, []);

  const keyOf = (id: number, field: PrePostField) => `${id}:${field}`;

  const startEdit = (s: RankedStudent, field: PrePostField) => {
    setEditingKey(keyOf(s.id, field));
    const current = field === "pre" ? s.preTestScore : s.postTestScore;
    setDraft(current != null ? String(current) : "");
  };

  const saveScore = async (studentId: number, field: PrePostField) => {
    const trimmed = draft.trim();
    const score = trimmed === "" ? null : Number(trimmed);
    if (score !== null && (Number.isNaN(score) || score < 0 || score > 100)) {
      toast({ type: "error", description: "점수는 0~100 사이 숫자여야 합니다." });
      return;
    }
    const key = keyOf(studentId, field);
    setSavingKey(key);
    try {
      const res = await fetch(`/api/admin/users/${studentId}/${field}-test-score`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "저장 실패");
      setEditingKey(null);
      load();
    } catch (err) {
      toast({ type: "error", description: err instanceof Error ? err.message : "저장 중 오류가 발생했습니다." });
    } finally {
      setSavingKey(null);
    }
  };

  const exportCsv = () => {
    if (!data) return;
    const header = ["순위", "학번", "이름", "이메일", "종합점수", "채팅 질문 수", "활동 일수", "시도한 문제 수", "맞춘 문제 수", "정답률", "사전테스트", "사후테스트", "향상률"];
    const lines = data.students.map((s) =>
      [
        s.rank, s.studentId, s.name, s.email, s.compositeScore, s.chatCount, s.activeDays, s.questionsAttempted, s.questionsCorrect, `${s.accuracyPct}%`,
        s.preTestScore ?? "", s.postTestScore ?? "", s.improvement ?? "",
      ]
        .map(csvEscape)
        .join(","),
    );
    const csv = `﻿${[header.join(","), ...lines].join("\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `학습순위_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!data) return <div className="text-muted-foreground text-sm">불러오는 중...</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-semibold text-xl">학습 순위</h1>
        <Button onClick={exportCsv} size="sm" variant="outline">CSV 내보내기</Button>
      </div>

      {data.prePostSummary ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-[13px] leading-relaxed">
          <p className="mb-1 font-medium">사전·사후테스트 평균 <span className="font-normal text-muted-foreground">(증빙자료용)</span></p>
          <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-muted-foreground">
              사전 평균{" "}
              {data.prePostSummary.avgPreTestScore != null
                ? `${data.prePostSummary.avgPreTestScore}% (${data.prePostSummary.preParticipantCount}명)`
                : "아직 없음"}
              {" · "}
              사후 평균{" "}
              {data.prePostSummary.avgPostTestScore != null
                ? `${data.prePostSummary.avgPostTestScore}% (${data.prePostSummary.postParticipantCount}명)`
                : "아직 없음"}
            </span>
            {data.prePostSummary.avgImprovement != null && (
              <span className="font-semibold text-emerald-700 text-base dark:text-emerald-400">
                평균 {data.prePostSummary.avgImprovement > 0 ? "+" : ""}
                {data.prePostSummary.avgImprovement}%p 향상 ({data.prePostSummary.improvementParticipantCount}명 기준)
              </span>
            )}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-muted/30 p-4 text-[13px] text-muted-foreground leading-relaxed">
          {data.prePostNote}
        </div>
      )}

      {data.noUsageYet && (
        <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4 text-[13px] leading-relaxed text-sky-700 dark:text-sky-400">
          아직 채팅·문제풀이 사용 기록이 없어서, 종합 점수 대신 <strong>사전테스트 점수 순</strong>으로 순위를 보여주고 있습니다. 실제 사용이 시작되면 자동으로 종합 점수 순위로 바뀝니다.
        </div>
      )}

      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-[13px] leading-relaxed">
        <p className="mb-1 font-medium">산정 방식</p>
        <p className="text-muted-foreground">{data.methodology}</p>
      </div>

      <div className="rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-[13px]">
            <thead>
              <tr className="border-border border-b text-muted-foreground">
                <th className="whitespace-nowrap px-4 py-2 text-left font-medium">순위</th>
                <th className="whitespace-nowrap px-4 py-2 text-left font-medium">학생</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">종합점수</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">채팅 질문</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">활동 일수</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">푼 문제/맞춘시도</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">정답률</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">사전→사후</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">향상률</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((s) => (
                <tr className="border-border border-b last:border-0 hover:bg-accent/40" key={s.id}>
                  <td className="px-4 py-2 font-medium">
                    {s.rank <= 3 ? ["🥇", "🥈", "🥉"][s.rank - 1] : s.rank}
                  </td>
                  <td className="px-4 py-2">
                    <Link className="block" href={`/admin/students/${s.id}`}>
                      <span className="font-medium">{s.name}</span>
                      <span className="ml-1.5 text-muted-foreground text-xs">{s.studentId ?? s.email}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right font-medium">{s.compositeScore}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground">{s.chatCount}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground">{s.activeDays}일</td>
                  <td className="px-4 py-2 text-right text-muted-foreground">
                    {s.questionsCorrect}/{s.questionsAttempted}
                  </td>
                  <td className="px-4 py-2 text-right text-muted-foreground">{s.accuracyPct}%</td>
                  <td className="px-4 py-2 text-right text-muted-foreground">
                    <div className="flex items-center justify-end gap-1">
                      {(["pre", "post"] as const).map((field, idx) => {
                        const key = keyOf(s.id, field);
                        const value = field === "pre" ? s.preTestScore : s.postTestScore;
                        return (
                          <span className="flex items-center gap-1" key={field}>
                            {idx === 1 && <span>→</span>}
                            {editingKey === key ? (
                              <>
                                <Input
                                  autoFocus
                                  className="h-7 w-16 px-2 text-right"
                                  max={100}
                                  min={0}
                                  onChange={(e) => setDraft(e.target.value)}
                                  onKeyDown={(e) => e.key === "Enter" && saveScore(s.id, field)}
                                  type="number"
                                  value={draft}
                                />
                                <Button className="h-7 px-2" disabled={savingKey === key} onClick={() => saveScore(s.id, field)} size="sm" variant="ghost">
                                  {savingKey === key ? "..." : "저장"}
                                </Button>
                                <Button className="h-7 px-2" onClick={() => setEditingKey(null)} size="sm" variant="ghost">
                                  취소
                                </Button>
                              </>
                            ) : (
                              <button
                                className="rounded px-1.5 py-0.5 hover:bg-accent hover:underline"
                                onClick={() => startEdit(s, field)}
                                type="button"
                              >
                                {value ?? "입력"}
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right font-medium">
                    {s.improvement != null ? (
                      <span className={s.improvement >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
                        {s.improvement > 0 ? "+" : ""}{s.improvement}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {data.students.length === 0 && (
                <tr>
                  <td className="px-4 py-4 text-muted-foreground" colSpan={9}>학생 데이터가 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
