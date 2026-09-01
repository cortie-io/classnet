"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
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

const SOURCE_LABEL: Record<string, string> = {
  ai_generated: "AI 생성",
  admin_authored: "관리자 작성",
  past_exam: "기출",
};

interface QuestionRow {
  id: number;
  subject: string;
  stem: string;
  question_type: string;
}
interface ExamSetRow {
  id: number;
  title: string;
  duration_minutes: number | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  is_published: boolean;
  question_count: number;
  attempt_count: number;
}
interface AttemptRow {
  id: number;
  user_name: string;
  user_email: string;
  status: string;
  score: number | null;
  flagged_for_review: boolean;
  set_title: string | null;
}
interface QuestionQualityRow {
  id: number;
  subject: string;
  stem: string;
  question_type: string;
  source: string;
  attempt_count: number;
  correct_count: number;
  accuracy_pct: string;
}
interface GradingItem {
  answer_id: number;
  attempt_id: number;
  question_id: number;
  answer_text: string;
  answered_at: string;
  subject: string;
  stem: string;
  question_type: string;
  model_answer: string | null;
  max_score: string;
  explanation: string | null;
  user_id: number;
  user_name: string;
  user_email: string;
}

// <input type="datetime-local">은 타임존 없는 로컬 문자열을 주고받는다 — 서버에는 명확한 UTC ISO로
// 변환해서 보내고, 서버에서 받은 UTC ISO는 이 입력란에 다시 채울 수 있게 로컬 문자열로 되돌린다.
function localInputToIso(local: string): string | null {
  return local ? new Date(local).toISOString() : null;
}
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ExamsAdminPage() {
  const [approved, setApproved] = useState<QuestionRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(30);
  const [scheduledStart, setScheduledStart] = useState("");
  const [scheduledEnd, setScheduledEnd] = useState("");
  const [sets, setSets] = useState<ExamSetRow[]>([]);
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const [gradingQueue, setGradingQueue] = useState<GradingItem[]>([]);
  const [gradeDrafts, setGradeDrafts] = useState<Record<number, { score: string; feedback: string }>>({});
  const [questionQuality, setQuestionQuality] = useState<QuestionQualityRow[]>([]);

  // 문제 직접 작성 폼 상태
  const [qSubject, setQSubject] = useState(SUBJECTS[0]);
  const [qType, setQType] = useState("multiple_choice");
  const [qStem, setQStem] = useState("");
  const [qChoices, setQChoices] = useState(["", "", "", ""]);
  const [qCorrectIndex, setQCorrectIndex] = useState(0);
  const [qAcceptedAnswers, setQAcceptedAnswers] = useState("");
  const [qModelAnswer, setQModelAnswer] = useState("");
  const [qExplanation, setQExplanation] = useState("");
  const [qMaxScore, setQMaxScore] = useState(1);
  const [creatingQuestion, setCreatingQuestion] = useState(false);
  const [pickerSubject, setPickerSubject] = useState("");
  const [pickerQuery, setPickerQuery] = useState("");

  const loadApproved = (subjectOverride?: string, queryOverride?: string) => {
    // 새 시험 만들기 문제 선택 목록은 관리자가 직접 만들어 등록한 문제만 보여준다(기출/AI 생성 문제 제외).
    const params = new URLSearchParams({ status: "approved", source: "admin_authored" });
    const subj = subjectOverride ?? pickerSubject;
    const q = queryOverride ?? pickerQuery;
    if (subj) params.set("subject", subj);
    if (q.trim()) params.set("q", q.trim());
    fetch(`/api/admin/exam/questions?${params.toString()}`).then((r) => r.json()).then(setApproved);
  };
  const loadSets = () => fetch("/api/admin/exam/sets").then((r) => r.json()).then(setSets);
  const loadAttempts = (flaggedOnly: boolean) =>
    fetch(`/api/admin/exam/attempts${flaggedOnly ? "?flagged=true" : ""}`)
      .then((r) => r.json())
      .then(setAttempts);
  const loadGradingQueue = () => fetch("/api/admin/exam/grading-queue").then((r) => r.json()).then(setGradingQueue);
  const loadQuestionQuality = () =>
    fetch("/api/admin/exam/question-quality").then((r) => r.json()).then(setQuestionQuality);

  useEffect(() => {
    loadApproved();
    loadSets();
    loadAttempts(false);
    loadGradingQueue();
    loadQuestionQuality();
  }, []);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const resetQuestionForm = () => {
    setQStem("");
    setQChoices(["", "", "", ""]);
    setQCorrectIndex(0);
    setQAcceptedAnswers("");
    setQModelAnswer("");
    setQExplanation("");
    setQMaxScore(1);
  };

  const createQuestion = async () => {
    if (!qStem.trim()) {
      toast({ type: "error", description: "문제 지문을 입력하세요." });
      return;
    }
    const body: Record<string, unknown> = {
      subject: qSubject,
      stem: qStem,
      questionType: qType,
      explanation: qExplanation || undefined,
      maxScore: qMaxScore,
    };
    if (qType === "multiple_choice") {
      const cleaned = qChoices.map((c) => c.trim()).filter(Boolean);
      if (cleaned.length < 2) {
        toast({ type: "error", description: "선택지를 2개 이상 입력하세요." });
        return;
      }
      body.choices = cleaned;
      body.correctIndex = Math.min(qCorrectIndex, cleaned.length - 1);
    } else if (qType === "short_answer") {
      const accepted = qAcceptedAnswers.split(",").map((s) => s.trim()).filter(Boolean);
      if (accepted.length === 0) {
        toast({ type: "error", description: "정답으로 인정할 답을 1개 이상 입력하세요(쉼표로 구분)." });
        return;
      }
      body.acceptedAnswers = accepted;
      body.modelAnswer = qModelAnswer || undefined;
    } else {
      body.modelAnswer = qModelAnswer || undefined;
    }

    setCreatingQuestion(true);
    try {
      const res = await fetch("/api/admin/exam/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "문제 생성 실패");
      toast({ type: "success", description: "문제가 추가되었습니다. 아래 목록에서 시험에 포함시킬 수 있습니다." });
      resetQuestionForm();
      await loadApproved();
      setSelected((prev) => new Set(prev).add(data.id));
    } catch (err) {
      toast({ type: "error", description: err instanceof Error ? err.message : "오류가 발생했습니다." });
    } finally {
      setCreatingQuestion(false);
    }
  };

  const exportAttemptsCsv = async () => {
    try {
      const res = await fetch("/api/admin/exam/attempts-export");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "내보내기 실패");
      const blob = new Blob([data.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `성적_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ type: "error", description: err instanceof Error ? err.message : "오류가 발생했습니다." });
    }
  };

  const createSet = async () => {
    if (!title || selected.size === 0) {
      toast({ type: "error", description: "제목과 문제를 1개 이상 선택하세요." });
      return;
    }
    const res = await fetch("/api/admin/exam/sets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        questionIds: [...selected],
        durationMinutes: duration,
        scheduledStart: localInputToIso(scheduledStart),
        scheduledEnd: localInputToIso(scheduledEnd),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ type: "error", description: data.error ?? "생성 실패" });
      return;
    }
    toast({ type: "success", description: "시험이 생성되었습니다. 아래에서 공개하세요." });
    setTitle("");
    setScheduledStart("");
    setScheduledEnd("");
    setSelected(new Set());
    loadSets();
  };

  const togglePublish = async (id: number, publish: boolean) => {
    await fetch(`/api/admin/exam/sets/${id}/${publish ? "publish" : "unpublish"}`, { method: "POST" });
    loadSets();
  };

  const startEditSchedule = (s: ExamSetRow) => {
    setEditingScheduleId(s.id);
    setEditStart(isoToLocalInput(s.scheduled_start));
    setEditEnd(isoToLocalInput(s.scheduled_end));
  };

  const saveSchedule = async (id: number) => {
    const startIso = localInputToIso(editStart);
    const endIso = localInputToIso(editEnd);
    if (startIso && endIso && new Date(startIso).getTime() >= new Date(endIso).getTime()) {
      toast({ type: "error", description: "응시 시작 시각은 마감 시각보다 이전이어야 합니다." });
      return;
    }
    const res = await fetch(`/api/admin/exam/sets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledStart: startIso, scheduledEnd: endIso }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ type: "error", description: data.error ?? "저장 실패" });
      return;
    }
    toast({ type: "success", description: "응시 기간을 저장했습니다." });
    setEditingScheduleId(null);
    loadSets();
  };

  const submitGrade = async (answerId: number, maxScore: number) => {
    const draft = gradeDrafts[answerId];
    const score = Number(draft?.score);
    if (!draft || Number.isNaN(score) || score < 0 || score > maxScore) {
      toast({ type: "error", description: `0 ~ ${maxScore} 사이 점수를 입력하세요.` });
      return;
    }
    const res = await fetch(`/api/admin/exam/answers/${answerId}/grade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score, feedback: draft.feedback || undefined }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ type: "error", description: data.error ?? "채점 실패" });
      return;
    }
    toast({ type: "success", description: "채점을 저장했습니다." });
    setGradingQueue((prev) => prev.filter((g) => g.answer_id !== answerId));
  };

  return (
    <div className="flex w-full flex-col gap-6 overflow-x-hidden">
      <h1 className="font-semibold text-xl">시험 관리</h1>

      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <h2 className="mb-3 font-medium text-sm">문제 직접 작성</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>과목</Label>
            <Select onValueChange={setQSubject} value={qSubject}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SUBJECTS.map((s) => (
                  <SelectItem key={s} value={s}>{s.replace(/^\d과목_/, "")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>출제 형태</Label>
            <Select onValueChange={setQType} value={qType}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="multiple_choice">객관식</SelectItem>
                <SelectItem value="short_answer">단답식</SelectItem>
                <SelectItem value="subjective">주관식</SelectItem>
                <SelectItem value="essay">서술형</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-1.5">
          <Label>문제 지문</Label>
          <Textarea onChange={(e) => setQStem(e.target.value)} placeholder="문제 내용을 입력하세요" rows={3} value={qStem} />
        </div>

        {qType === "multiple_choice" && (
          <div className="mt-3 flex flex-col gap-1.5">
            <Label>선택지 (정답에 표시)</Label>
            {qChoices.map((c, i) => (
              <div className="flex items-center gap-2" key={i}>
                <input
                  checked={qCorrectIndex === i}
                  name="correctChoice"
                  onChange={() => setQCorrectIndex(i)}
                  type="radio"
                />
                <Input
                  onChange={(e) => {
                    const next = [...qChoices];
                    next[i] = e.target.value;
                    setQChoices(next);
                  }}
                  placeholder={`선택지 ${i + 1}`}
                  value={c}
                />
              </div>
            ))}
            <div className="flex gap-2">
              <Button onClick={() => setQChoices((p) => [...p, ""])} size="sm" type="button" variant="outline">
                선택지 추가
              </Button>
              {qChoices.length > 2 && (
                <Button
                  onClick={() => setQChoices((p) => p.slice(0, -1))}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  선택지 제거
                </Button>
              )}
            </div>
          </div>
        )}

        {qType === "short_answer" && (
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>정답으로 인정할 답 (쉼표로 여러 개 가능, 예: TCP, tcp)</Label>
              <Input onChange={(e) => setQAcceptedAnswers(e.target.value)} placeholder="정답1, 정답2" value={qAcceptedAnswers} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>모범답안 (선택, 해설에 참고용)</Label>
              <Textarea onChange={(e) => setQModelAnswer(e.target.value)} rows={2} value={qModelAnswer} />
            </div>
          </div>
        )}

        {(qType === "subjective" || qType === "essay") && (
          <div className="mt-3 flex flex-col gap-1.5">
            <Label>모범답안 (선택 — 채점 시 참고용, 자동채점되지 않습니다)</Label>
            <Textarea onChange={(e) => setQModelAnswer(e.target.value)} rows={qType === "essay" ? 5 : 2} value={qModelAnswer} />
          </div>
        )}

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>해설 (선택)</Label>
            <Textarea onChange={(e) => setQExplanation(e.target.value)} rows={2} value={qExplanation} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>배점</Label>
            <Input
              max={100}
              min={1}
              onChange={(e) => setQMaxScore(Number(e.target.value) || 1)}
              type="number"
              value={qMaxScore}
            />
          </div>
        </div>

        <Button className="mt-4" disabled={creatingQuestion} onClick={createQuestion}>
          {creatingQuestion ? "추가하는 중..." : "문제 추가"}
        </Button>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <h2 className="mb-3 font-medium text-sm">새 시험 만들기</h2>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <Input onChange={(e) => setTitle(e.target.value)} placeholder="시험 제목(예: 1차 지필평가)" value={title} />
          <Input
            className="sm:w-32"
            onChange={(e) => setDuration(Number(e.target.value))}
            placeholder="제한 시간(분)"
            type="number"
            value={duration}
          />
          <Button onClick={createSet}>생성</Button>
        </div>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1">
            <Label className="text-xs">응시 시작(선택, 비우면 제한 없음)</Label>
            <Input onChange={(e) => setScheduledStart(e.target.value)} type="datetime-local" value={scheduledStart} />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <Label className="text-xs">응시 마감(선택, 비우면 제한 없음)</Label>
            <Input onChange={(e) => setScheduledEnd(e.target.value)} type="datetime-local" value={scheduledEnd} />
          </div>
        </div>
        <p className="mb-2 text-muted-foreground text-xs">
          승인된 문제(직접 작성 + 검수 통과) 중 출제할 문제를 선택하세요 ({selected.size}개 선택됨)
        </p>
        <div className="mb-2 flex flex-col gap-2 sm:flex-row">
          <Select onValueChange={(v) => { const val = v === "all" ? "" : v; setPickerSubject(val); loadApproved(val, pickerQuery); }} value={pickerSubject || "all"}>
            <SelectTrigger className="sm:w-56"><SelectValue placeholder="전체 과목" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 과목</SelectItem>
              {SUBJECTS.map((s) => (
                <SelectItem key={s} value={s}>{s.replace(/^\d과목_/, "")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            onChange={(e) => setPickerQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadApproved()}
            placeholder="문제 내용 검색 후 Enter"
            value={pickerQuery}
          />
          <Button onClick={() => loadApproved()} type="button" variant="outline">검색</Button>
        </div>
        <div className="flex max-h-72 flex-col gap-1 overflow-auto rounded-lg border border-border p-2">
          {approved.map((q) => (
            <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-accent/40" key={q.id}>
              <input checked={selected.has(q.id)} onChange={() => toggle(q.id)} type="checkbox" />
              <span className="min-w-0">
                <span className="mr-2 text-muted-foreground">[{q.subject.replace(/^\d과목_/, "")}]</span>
                <Badge className="mr-2 align-middle" variant="secondary">{QUESTION_TYPE_LABEL[q.question_type] ?? q.question_type}</Badge>
                {q.stem}
              </span>
            </label>
          ))}
          {approved.length === 0 && <p className="p-2 text-muted-foreground text-xs">승인된 문제가 없습니다. 위에서 직접 작성하거나 먼저 문제 검수를 진행하세요.</p>}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card">
        <h2 className="p-4 pb-0 font-medium text-sm">생성된 시험</h2>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-border border-b text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">제목</th>
                <th className="px-4 py-2 text-left font-medium">문항수</th>
                <th className="px-4 py-2 text-left font-medium">제한시간</th>
                <th className="px-4 py-2 text-left font-medium">응시 가능 기간</th>
                <th className="px-4 py-2 text-left font-medium">응시 수</th>
                <th className="px-4 py-2 text-left font-medium">공개 상태</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {sets.map((s) => (
                <tr className="border-border border-b last:border-0" key={s.id}>
                  <td className="px-4 py-2">{s.title}</td>
                  <td className="px-4 py-2">{s.question_count}</td>
                  <td className="px-4 py-2">{s.duration_minutes ?? "-"}분</td>
                  <td className="px-4 py-2">
                    {editingScheduleId === s.id ? (
                      <div className="flex flex-col gap-1.5">
                        <Input
                          className="h-8 text-xs"
                          onChange={(e) => setEditStart(e.target.value)}
                          type="datetime-local"
                          value={editStart}
                        />
                        <Input
                          className="h-8 text-xs"
                          onChange={(e) => setEditEnd(e.target.value)}
                          type="datetime-local"
                          value={editEnd}
                        />
                        <div className="flex gap-1.5">
                          <Button onClick={() => saveSchedule(s.id)} size="sm">저장</Button>
                          <Button onClick={() => setEditingScheduleId(null)} size="sm" variant="outline">취소</Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="text-left text-muted-foreground hover:text-foreground hover:underline"
                        onClick={() => startEditSchedule(s)}
                        type="button"
                      >
                        {s.scheduled_start || s.scheduled_end
                          ? `${s.scheduled_start ? new Date(s.scheduled_start).toLocaleString("ko-KR") : "제한 없음"} ~ ${s.scheduled_end ? new Date(s.scheduled_end).toLocaleString("ko-KR") : "제한 없음"}`
                          : "제한 없음 (클릭해서 설정)"}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2">{s.attempt_count}</td>
                  <td className="px-4 py-2">{s.is_published ? "공개됨" : "비공개"}</td>
                  <td className="px-4 py-2">
                    <Button onClick={() => togglePublish(s.id, !s.is_published)} size="sm" variant="outline">
                      {s.is_published ? "비공개로 전환" : "공개"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <h2 className="mb-1 font-medium text-sm">문제 품질 점검</h2>
        <p className="mb-3 text-muted-foreground text-xs">
          5회 이상 응답된 문제 중 정답률이 낮은 순 — 지문이 모호하거나 정답 태깅이 잘못됐을 가능성을 점검하세요.
        </p>
        <div className="flex flex-col gap-2">
          {questionQuality.length === 0 && <p className="text-muted-foreground text-xs">아직 데이터가 충분하지 않습니다.</p>}
          {questionQuality.map((q) => (
            <div className="rounded-lg border border-border/60 px-3 py-2 text-[13px]" key={q.id}>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                <Badge variant="secondary">{q.subject.replace(/^\d과목_/, "")}</Badge>
                <Badge variant="outline">{QUESTION_TYPE_LABEL[q.question_type] ?? q.question_type}</Badge>
                <span>{SOURCE_LABEL[q.source] ?? q.source}</span>
                <span
                  className={`ml-auto font-medium ${Number(q.accuracy_pct) < 40 ? "text-destructive" : "text-amber-600"}`}
                >
                  정답률 {q.accuracy_pct}% ({q.correct_count}/{q.attempt_count})
                </span>
              </div>
              <p className="whitespace-pre-wrap">{q.stem}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <h2 className="mb-3 font-medium text-sm">채점 대기 (주관식·서술형)</h2>
        <div className="flex flex-col gap-3">
          {gradingQueue.length === 0 && <p className="text-muted-foreground text-xs">채점을 기다리는 답안이 없습니다.</p>}
          {gradingQueue.map((g) => {
            const maxScore = Number(g.max_score);
            const draft = gradeDrafts[g.answer_id] ?? { score: "", feedback: "" };
            return (
              <div className="rounded-xl border border-border p-3" key={g.answer_id}>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                  <Badge variant="secondary">{QUESTION_TYPE_LABEL[g.question_type]}</Badge>
                  <span>{g.subject.replace(/^\d과목_/, "")}</span>
                  <span>· {g.user_name} ({g.user_email})</span>
                  <span>· 배점 {maxScore}점</span>
                </div>
                <p className="mb-2 whitespace-pre-wrap font-medium text-[13px]">{g.stem}</p>
                <div className="mb-2 rounded-lg bg-muted/50 p-2 text-[13px] whitespace-pre-wrap">{g.answer_text}</div>
                {g.model_answer && (
                  <p className="mb-2 text-[12px] text-muted-foreground">
                    <span className="font-medium">모범답안: </span>{g.model_answer}
                  </p>
                )}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">점수 (0~{maxScore})</Label>
                    <Input
                      className="sm:w-24"
                      max={maxScore}
                      min={0}
                      onChange={(e) =>
                        setGradeDrafts((p) => ({ ...p, [g.answer_id]: { ...draft, score: e.target.value } }))
                      }
                      type="number"
                      value={draft.score}
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <Label className="text-xs">피드백 (선택)</Label>
                    <Input
                      onChange={(e) =>
                        setGradeDrafts((p) => ({ ...p, [g.answer_id]: { ...draft, feedback: e.target.value } }))
                      }
                      value={draft.feedback}
                    />
                  </div>
                  <Button onClick={() => submitGrade(g.answer_id, maxScore)} size="sm">채점 저장</Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium text-sm">응시 현황 / 부정행위 검토</h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[13px]">
              <input
                checked={showFlaggedOnly}
                onChange={(e) => {
                  setShowFlaggedOnly(e.target.checked);
                  loadAttempts(e.target.checked);
                }}
                type="checkbox"
              />
              검토 대상만 보기
            </label>
            <Button onClick={exportAttemptsCsv} size="sm" variant="outline">
              성적 CSV 내보내기
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {attempts.length === 0 && <p className="text-muted-foreground text-xs">응시 기록이 없습니다.</p>}
          {attempts.map((a) => (
            <div
              className={`flex flex-col gap-1 rounded-lg border px-3 py-2 text-[13px] sm:flex-row sm:items-center sm:justify-between ${
                a.flagged_for_review ? "border-amber-500/50 bg-amber-500/10" : "border-border"
              }`}
              key={a.id}
            >
              <span>
                {a.user_name} ({a.user_email}) — {a.set_title ?? "연습"}
                {a.flagged_for_review && <span className="ml-2 text-amber-600">⚠ 검토 필요</span>}
              </span>
              <span className="text-muted-foreground">
                {a.status} {a.score !== null && `· ${a.score}점`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
