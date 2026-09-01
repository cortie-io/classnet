"use client";

import { use, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/chat/toast";

interface StudentDetail {
  user: {
    id: number;
    name: string;
    email: string;
    student_id: string | null;
    birthdate: string | null;
    level: string;
    role: string;
  };
  categoryStats: { subject: string; count: number }[];
  weakAreas: { subject: string; wrongCount: number; totalCount: number; accuracy: number }[];
  weakTopics: { subject: string; topic: string; wrongCount: number; totalCount: number; accuracy: number }[];
  examStats: { correct: string; total: string };
  prePostTest: {
    preTestScore: number | null;
    postTestScore: number | null;
    manualPreTestScore: number | null;
    manualPostTestScore: number | null;
    improvement: number | null;
  };
  attempts: {
    id: number;
    status: string;
    score: string | null;
    started_at: string;
    submitted_at: string | null;
    flagged_for_review: boolean;
    set_kind: string | null;
    set_title: string | null;
  }[];
}

const KIND_LABEL: Record<string, string> = {
  mock: "모의고사",
  admin_timed: "지정 시험",
  practice_custom: "연습",
  past_exam_round: "기출 회차",
};

interface HistoryItem {
  id: number;
  question: string;
  intent: string;
  verification_status: string;
  confidence: number | null;
  final_answer: string;
  created_at: string;
}

export default function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [newPassword, setNewPassword] = useState("");
  const [preScoreDraft, setPreScoreDraft] = useState("");
  const [postScoreDraft, setPostScoreDraft] = useState("");
  const [savingPreScore, setSavingPreScore] = useState(false);
  const [savingPostScore, setSavingPostScore] = useState(false);

  const loadDetail = () => {
    fetch(`/api/admin/users/${id}`)
      .then((r) => r.json())
      .then((d: StudentDetail) => {
        setDetail(d);
        setPreScoreDraft(d.prePostTest.manualPreTestScore != null ? String(d.prePostTest.manualPreTestScore) : "");
        setPostScoreDraft(d.prePostTest.manualPostTestScore != null ? String(d.prePostTest.manualPostTestScore) : "");
      });
  };

  useEffect(() => {
    loadDetail();
    fetch(`/api/admin/users/${id}/history?limit=50`).then((r) => r.json()).then(setHistory);
  }, [id]);

  const saveScore = async (field: "pre" | "post", draft: string, setSaving: (v: boolean) => void) => {
    const trimmed = draft.trim();
    const score = trimmed === "" ? null : Number(trimmed);
    if (score !== null && (Number.isNaN(score) || score < 0 || score > 100)) {
      toast({ type: "error", description: "점수는 0~100 사이 숫자여야 합니다." });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${id}/${field}-test-score`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "저장 실패");
      toast({ type: "success", description: `${field === "pre" ? "사전" : "사후"}테스트 점수가 저장되었습니다.` });
      loadDetail();
    } catch (err) {
      toast({ type: "error", description: err instanceof Error ? err.message : "저장 중 오류가 발생했습니다." });
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async () => {
    if (newPassword.length < 8) {
      toast({ type: "error", description: "비밀번호는 8자 이상이어야 합니다." });
      return;
    }
    const res = await fetch(`/api/admin/users/${id}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword }),
    });
    if (res.ok) {
      toast({ type: "success", description: "비밀번호가 초기화되었습니다." });
      setNewPassword("");
    } else {
      toast({ type: "error", description: "초기화 실패" });
    }
  };

  if (!detail) return <div className="text-muted-foreground text-sm">불러오는 중...</div>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-semibold text-xl">{detail.user.name}</h1>
        <p className="text-muted-foreground text-sm">{detail.user.email}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-muted-foreground text-xs">학번</p>
          <p>{detail.user.student_id ?? "-"}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-muted-foreground text-xs">생년월일</p>
          <p>{detail.user.birthdate ? new Date(detail.user.birthdate).toLocaleDateString("ko-KR") : "-"}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-muted-foreground text-xs">학습 수준</p>
          <p>{detail.user.level}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-muted-foreground text-xs">과목별 질문 분포</p>
          <p>{detail.categoryStats.map((c) => `${c.subject.replace(/^\d과목_/, "")}(${c.count})`).join(", ") || "없음"}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-1 font-medium text-sm">시험 성적</h2>
        <p className="mb-3 text-muted-foreground text-xs">
          전체 정답률 {detail.examStats.total !== "0" ? `${Math.round((Number(detail.examStats.correct) / Number(detail.examStats.total)) * 1000) / 10}% (${detail.examStats.correct}/${detail.examStats.total})` : "채점 기록 없음"}
        </p>
        {(detail.prePostTest.preTestScore != null || detail.prePostTest.postTestScore != null) && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[12.5px]">
            <span className="text-muted-foreground">사전→사후테스트</span>
            <span className="font-medium">
              {detail.prePostTest.preTestScore ?? "미응시"} → {detail.prePostTest.postTestScore ?? "미응시"}
            </span>
            {detail.prePostTest.improvement != null && (
              <span className={`font-semibold ${detail.prePostTest.improvement >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                ({detail.prePostTest.improvement > 0 ? "+" : ""}{detail.prePostTest.improvement}점)
              </span>
            )}
          </div>
        )}
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-[12.5px]">
          <span className="text-muted-foreground">사전테스트 점수 직접 입력</span>
          <span className="text-muted-foreground text-[11px]">(사이트 밖에서 치른 경우)</span>
          <Input
            className="h-8 w-20"
            max={100}
            min={0}
            onChange={(e) => setPreScoreDraft(e.target.value)}
            placeholder="점수"
            type="number"
            value={preScoreDraft}
          />
          <Button disabled={savingPreScore} onClick={() => saveScore("pre", preScoreDraft, setSavingPreScore)} size="sm">
            {savingPreScore ? "저장 중..." : "저장"}
          </Button>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-[12.5px]">
          <span className="text-muted-foreground">사후테스트 점수 직접 입력</span>
          <span className="text-muted-foreground text-[11px]">(사이트 밖에서 치른 경우)</span>
          <Input
            className="h-8 w-20"
            max={100}
            min={0}
            onChange={(e) => setPostScoreDraft(e.target.value)}
            placeholder="점수"
            type="number"
            value={postScoreDraft}
          />
          <Button disabled={savingPostScore} onClick={() => saveScore("post", postScoreDraft, setSavingPostScore)} size="sm">
            {savingPostScore ? "저장 중..." : "저장"}
          </Button>
        </div>
        {(detail.weakAreas.length > 0 || detail.weakTopics.length > 0) && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {detail.weakAreas.map((w) => (
              <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-[12px] text-destructive" key={w.subject}>
                {w.subject.replace(/^\d과목_/, "")} {Math.round(w.accuracy * 100)}%
              </span>
            ))}
            {detail.weakTopics.slice(0, 5).map((w) => (
              <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[12px] text-amber-600" key={w.topic}>
                {w.topic} {Math.round(w.accuracy * 100)}%
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          {detail.attempts.length === 0 && <p className="text-muted-foreground text-xs">응시 기록이 없습니다.</p>}
          {detail.attempts.map((a) => (
            <div
              className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[12.5px] ${
                a.flagged_for_review ? "border-amber-500/50 bg-amber-500/10" : "border-border/60"
              }`}
              key={a.id}
            >
              <span>
                {a.set_title ?? (a.set_kind ? KIND_LABEL[a.set_kind] : "연습")}
                {a.flagged_for_review && <span className="ml-1.5 text-amber-600">⚠ 검토 필요</span>}
              </span>
              <span className="text-muted-foreground">
                {a.status} {a.score !== null && `· ${a.score}점`} · {new Date(a.started_at).toLocaleDateString("ko-KR")}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-2 font-medium text-sm">비밀번호 초기화</h2>
        <div className="flex gap-2">
          <Input onChange={(e) => setNewPassword(e.target.value)} placeholder="새 비밀번호(8자 이상)" type="password" value={newPassword} />
          <Button onClick={resetPassword}>초기화</Button>
        </div>
      </div>

      <div>
        <h2 className="mb-2 font-medium text-sm">질문/채팅 기록</h2>
        <div className="flex flex-col gap-2">
          {history.length === 0 && <p className="text-muted-foreground text-sm">기록이 없습니다.</p>}
          {history.map((h) => (
            <div className="rounded-xl border border-border bg-card p-4 text-[13px]" key={h.id}>
              <div className="mb-1 flex items-center gap-2 text-muted-foreground text-xs">
                <span
                  className={`rounded-full px-2 py-0.5 ${
                    h.verification_status === "verified"
                      ? "bg-emerald-500/10 text-emerald-600"
                      : h.verification_status === "flagged"
                        ? "bg-amber-500/10 text-amber-600"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {h.verification_status}
                </span>
                <span>{h.intent}</span>
                <span>{new Date(h.created_at).toLocaleString("ko-KR")}</span>
              </div>
              <p className="mb-1 font-medium">Q. {h.question}</p>
              <p className="whitespace-pre-wrap text-muted-foreground">{h.final_answer.slice(0, 300)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
