"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/chat/toast";

const SUBJECTS = [
  "1과목_네트워크_일반",
  "2과목_TCP_IP",
  "3과목_NOS",
  "4과목_네트워크_운용기기",
  "5과목_정보보호개론",
];

const QUESTION_TYPE_LABEL: Record<string, string> = {
  multiple_choice: "객관식",
  short_answer: "단답식",
  subjective: "주관식",
  essay: "서술형",
};

interface QuestionRow {
  id: number;
  source: string;
  subject: string;
  stem: string;
  question_type: string;
  choices: string[] | null;
  correct_index: number | null;
  accepted_answers: string[] | null;
  model_answer: string | null;
  max_score: string;
  explanation: string;
  status: string;
  created_at: string;
}

const STATUS_TABS = [
  { value: "pending_review", label: "검수 대기" },
  { value: "approved", label: "승인됨" },
  { value: "rejected", label: "반려됨" },
];

interface EditDraft {
  subject: string;
  stem: string;
  choices: string[];
  correctIndex: number;
  acceptedAnswers: string;
  modelAnswer: string;
  explanation: string;
  maxScore: number;
}

function draftFrom(q: QuestionRow): EditDraft {
  return {
    subject: q.subject,
    stem: q.stem,
    choices: q.choices && q.choices.length > 0 ? [...q.choices] : ["", "", "", ""],
    correctIndex: q.correct_index ?? 0,
    acceptedAnswers: (q.accepted_answers ?? []).join(", "),
    modelAnswer: q.model_answer ?? "",
    explanation: q.explanation ?? "",
    maxScore: Number(q.max_score) || 1,
  };
}

export default function QuestionsReviewPage() {
  const [status, setStatus] = useState("pending_review");
  const [subject, setSubject] = useState("");
  const [query, setQuery] = useState("");
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = (statusOverride?: string, subjectOverride?: string, queryOverride?: string) => {
    setLoading(true);
    const params = new URLSearchParams({ status: statusOverride ?? status });
    const subj = subjectOverride ?? subject;
    const q = queryOverride ?? query;
    if (subj) params.set("subject", subj);
    if (q.trim()) params.set("q", q.trim());
    fetch(`/api/admin/exam/questions?${params.toString()}`)
      .then((r) => r.json())
      .then(setQuestions)
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (id: number, action: "approve" | "reject") => {
    const res = await fetch(`/api/admin/exam/questions/${id}/${action}`, { method: "POST" });
    if (res.ok) {
      setQuestions((qs) => qs.filter((q) => q.id !== id));
      toast({ type: "success", description: action === "approve" ? "승인되었습니다." : "반려되었습니다." });
    } else {
      toast({ type: "error", description: "처리 실패" });
    }
  };

  const startEdit = (q: QuestionRow) => {
    setEditingId(q.id);
    setDraft(draftFrom(q));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const saveEdit = async (q: QuestionRow) => {
    if (!draft) return;
    setSavingEdit(true);
    try {
      const body: Record<string, unknown> = {
        subject: draft.subject,
        stem: draft.stem,
        explanation: draft.explanation,
        maxScore: draft.maxScore,
      };
      if (q.question_type === "multiple_choice") {
        body.choices = draft.choices.map((c) => c.trim()).filter(Boolean);
        body.correctIndex = draft.correctIndex;
      } else if (q.question_type === "short_answer") {
        body.acceptedAnswers = draft.acceptedAnswers.split(",").map((a) => a.trim()).filter(Boolean);
      } else {
        body.modelAnswer = draft.modelAnswer;
      }
      const res = await fetch(`/api/admin/exam/questions/${q.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "수정 실패");
      toast({ type: "success", description: "수정되었습니다." });
      cancelEdit();
      load();
    } catch (err) {
      toast({ type: "error", description: err instanceof Error ? err.message : "수정 중 오류가 발생했습니다." });
    } finally {
      setSavingEdit(false);
    }
  };

  const removeQuestion = async (id: number) => {
    if (!confirm("이 문제를 완전히 삭제하시겠습니까? 되돌릴 수 없습니다.")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/exam/questions/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "삭제 실패");
      setQuestions((qs) => qs.filter((q) => q.id !== id));
      toast({ type: "success", description: "삭제되었습니다." });
    } catch (err) {
      toast({ type: "error", description: err instanceof Error ? err.message : "삭제 중 오류가 발생했습니다." });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-semibold text-xl">문제 검수</h1>
        <p className="text-muted-foreground text-sm">
          AI 생성 문제의 검수(승인/반려)뿐 아니라, 문제은행 전체를 검색해서 직접 수정하거나 삭제할 수 있습니다.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((t) => (
          <button
            className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
              status === t.value ? "border-ring bg-accent" : "border-border hover:border-ring"
            }`}
            key={t.value}
            onClick={() => setStatus(t.value)}
            type="button"
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Select onValueChange={(v) => { const val = v === "all" ? "" : v; setSubject(val); load(status, val, query); }} value={subject || "all"}>
          <SelectTrigger className="sm:w-56"><SelectValue placeholder="전체 과목" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 과목</SelectItem>
            {SUBJECTS.map((s) => (
              <SelectItem key={s} value={s}>{s.replace(/^\d과목_/, "")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
          placeholder="문제 내용 검색 후 Enter"
          value={query}
        />
        <Button onClick={() => load()} type="button" variant="outline">검색</Button>
      </div>

      {loading && <p className="text-muted-foreground text-sm">불러오는 중...</p>}
      {!loading && questions.length === 0 && <p className="text-muted-foreground text-sm">해당 조건의 문제가 없습니다.</p>}

      <div className="flex flex-col gap-3">
        {questions.map((q) => {
          const isEditing = editingId === q.id;
          return (
            <div className="rounded-2xl border border-border bg-card p-5" key={q.id}>
              <div className="mb-2 flex items-center gap-2 text-muted-foreground text-xs">
                <span className="rounded-full bg-muted px-2 py-0.5">{q.subject.replace(/^\d과목_/, "")}</span>
                <span>{q.source === "ai_generated" ? "AI 생성" : q.source === "admin_authored" ? "관리자 작성" : "기출"}</span>
                <span>{QUESTION_TYPE_LABEL[q.question_type] ?? q.question_type}</span>
              </div>

              {!isEditing ? (
                <>
                  <p className="mb-3 whitespace-pre-wrap font-medium text-[14px]">{q.stem}</p>
                  {q.question_type === "multiple_choice" && (
                    <div className="flex flex-col gap-1.5">
                      {(q.choices ?? []).map((c, i) => (
                        <div
                          className={`rounded-lg border px-3 py-2 text-[13px] ${
                            i === q.correct_index ? "border-emerald-500 bg-emerald-500/10" : "border-border text-muted-foreground"
                          }`}
                          key={i}
                        >
                          {String.fromCharCode(9312 + i)} {c}
                        </div>
                      ))}
                    </div>
                  )}
                  {q.question_type === "short_answer" && (
                    <p className="text-[13px] text-muted-foreground">
                      정답: {(q.accepted_answers ?? []).join(", ") || "-"}
                    </p>
                  )}
                  {(q.question_type === "subjective" || q.question_type === "essay") && q.model_answer && (
                    <p className="whitespace-pre-wrap rounded-lg border border-border/60 p-3 text-[13px] text-muted-foreground">
                      모범답안: {q.model_answer}
                    </p>
                  )}
                  {q.explanation && (
                    <p className="mt-3 whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-[12px] text-muted-foreground">
                      {q.explanation}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {status === "pending_review" && (
                      <>
                        <Button onClick={() => act(q.id, "approve")} size="sm">승인</Button>
                        <Button onClick={() => act(q.id, "reject")} size="sm" variant="outline">반려</Button>
                      </>
                    )}
                    <Button onClick={() => startEdit(q)} size="sm" variant="outline">수정</Button>
                    <Button
                      disabled={deletingId === q.id}
                      onClick={() => removeQuestion(q.id)}
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                    >
                      {deletingId === q.id ? "삭제 중..." : "삭제"}
                    </Button>
                  </div>
                </>
              ) : draft ? (
                <div className="flex flex-col gap-3">
                  <Select onValueChange={(v) => setDraft({ ...draft, subject: v })} value={draft.subject}>
                    <SelectTrigger className="sm:w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SUBJECTS.map((s) => (
                        <SelectItem key={s} value={s}>{s.replace(/^\d과목_/, "")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Textarea onChange={(e) => setDraft({ ...draft, stem: e.target.value })} rows={3} value={draft.stem} />

                  {q.question_type === "multiple_choice" && (
                    <div className="flex flex-col gap-2">
                      {draft.choices.map((c, i) => (
                        <label className="flex items-center gap-2" key={i}>
                          <input
                            checked={draft.correctIndex === i}
                            onChange={() => setDraft({ ...draft, correctIndex: i })}
                            type="radio"
                          />
                          <Input
                            onChange={(e) => {
                              const next = [...draft.choices];
                              next[i] = e.target.value;
                              setDraft({ ...draft, choices: next });
                            }}
                            value={c}
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  {q.question_type === "short_answer" && (
                    <Input
                      onChange={(e) => setDraft({ ...draft, acceptedAnswers: e.target.value })}
                      placeholder="정답(쉼표로 여러 개 가능)"
                      value={draft.acceptedAnswers}
                    />
                  )}
                  {(q.question_type === "subjective" || q.question_type === "essay") && (
                    <Textarea
                      onChange={(e) => setDraft({ ...draft, modelAnswer: e.target.value })}
                      placeholder="모범답안(선택)"
                      rows={3}
                      value={draft.modelAnswer}
                    />
                  )}
                  <Textarea
                    onChange={(e) => setDraft({ ...draft, explanation: e.target.value })}
                    placeholder="해설(선택)"
                    rows={2}
                    value={draft.explanation}
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-muted-foreground text-xs">배점</label>
                    <Input
                      className="w-20"
                      onChange={(e) => setDraft({ ...draft, maxScore: Number(e.target.value) })}
                      type="number"
                      value={draft.maxScore}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button disabled={savingEdit} onClick={() => saveEdit(q)} size="sm">
                      {savingEdit ? "저장 중..." : "저장"}
                    </Button>
                    <Button onClick={cancelEdit} size="sm" variant="outline">취소</Button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
