"use client";
import { adminFetch } from "@/lib/admin-period";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  PenLineIcon,
  PlusIcon,
  SearchIcon,
  ShuffleIcon,
  Trash2Icon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "@/components/chat/toast";
import { loadJson } from "@/components/load-json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const OFFICIAL_SUBJECTS = [
  "1과목_네트워크_일반",
  "2과목_TCP_IP",
  "3과목_NOS",
  "4과목_네트워크_운용기기",
  "5과목_정보보호개론",
] as const;
const subjectName = (s: string) => s.replace(/^\d과목_/, "").replace(/_/g, " ");

export interface PickedQuestion {
  id: number;
  subject: string;
  stem: string;
  status?: string;
}

export interface OfficialExamFormValues {
  title: string;
  description: string;
  scheduledStart: string; // datetime-local 값
  scheduledEnd: string;
  durationMinutes: number;
  maxViolations: number;
  questions: PickedQuestion[];
}

/** Date → <input type="datetime-local"> 값(로컬 시각). */
export function toLocalInput(d: Date | string): string {
  const date = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function postJson<T>(
  url: string,
  body: unknown,
  method = "POST"
): Promise<T> {
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
  return data as T;
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="surface p-5 sm:p-6">
      <h2 className="font-semibold text-[15px]">{title}</h2>
      {description ? (
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          {description}
        </p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-medium text-[13px]">{label}</span>
      {children}
      {hint ? (
        <span className="text-[11.5px] text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export function OfficialExamForm({
  initial,
  examId,
  questionsLocked = false,
}: {
  initial: OfficialExamFormValues;
  examId?: number;
  /** 이미 응시한 학생이 있으면 문항은 바꿀 수 없다(서버도 막는다). */
  questionsLocked?: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState({ subject: "", q: "" });
  const [results, setResults] = useState<PickedQuestion[] | null>(null);
  const [authoring, setAuthoring] = useState(false);
  const [draft, setDraft] = useState({
    subject: OFFICIAL_SUBJECTS[1] as string,
    stem: "",
    choices: ["", "", "", ""],
    correctIndex: 0,
    explanation: "",
    maxScore: 1,
  });

  const set = <K extends keyof OfficialExamFormValues>(
    k: K,
    value: OfficialExamFormValues[K]
  ) => setV((p) => ({ ...p, [k]: value }));
  const pickedIds = new Set(v.questions.map((q) => q.id));

  const runSearch = () => {
    const params = new URLSearchParams({ status: "approved" });
    if (search.subject) params.set("subject", search.subject);
    if (search.q.trim()) params.set("q", search.q.trim());
    loadJson<PickedQuestion[]>(
      `/api/admin/exam/questions?${params}`,
      setResults
    );
  };
  useEffect(runSearch, []); // eslint-disable-line react-hooks/exhaustive-deps

  const autoFill = async () => {
    try {
      const { questions: picked } = await postJson<{
        questions: PickedQuestion[];
      }>("/api/admin/official-exams/auto-pick", {
        excludeIds: v.questions.map((q) => q.id),
      });
      set("questions", [...v.questions, ...picked]);
      toast({
        type: "success",
        description: `실제 시험 구성(과목별 10·17·18·5문항)으로 ${picked.length}문항을 채웠어요.`,
      });
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "자동 채우기에 실패했어요.",
      });
    }
  };

  const addAuthored = async () => {
    try {
      const { id } = await postJson<{ id: number }>(
        "/api/admin/official-exams/questions",
        draft
      );
      set("questions", [
        ...v.questions,
        { id, subject: draft.subject, stem: draft.stem, status: "exam_only" },
      ]);
      setDraft({
        ...draft,
        stem: "",
        choices: ["", "", "", ""],
        correctIndex: 0,
        explanation: "",
      });
      setAuthoring(false);
      toast({
        type: "success",
        description:
          "시험 전용 문제를 추가했어요. 이 문제는 문제은행에 나오지 않아요.",
      });
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "문제를 추가하지 못했어요.",
      });
    }
  };

  const move = (i: number, d: -1 | 1) => {
    const next = [...v.questions];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    set("questions", next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        title: v.title,
        description: v.description || null,
        scheduledStart: new Date(v.scheduledStart).toISOString(),
        scheduledEnd: new Date(v.scheduledEnd).toISOString(),
        durationMinutes: Number(v.durationMinutes),
        maxViolations: Number(v.maxViolations),
        ...(questionsLocked
          ? {}
          : { questionIds: v.questions.map((q) => q.id) }),
      };
      if (examId) {
        await postJson(`/api/admin/official-exams/${examId}`, body, "PATCH");
        toast({ type: "success", description: "저장했어요." });
        router.push(`/admin/official-exams/${examId}`);
      } else {
        const { id } = await postJson<{ id: number }>(
          "/api/admin/official-exams",
          body
        );
        toast({
          type: "success",
          description:
            "시험을 만들었어요. 확인한 뒤 '학생에게 공개'를 눌러 주세요.",
        });
        router.push(`/admin/official-exams/${id}`);
      }
    } catch (err) {
      toast({
        type: "error",
        description: err instanceof Error ? err.message : "저장하지 못했어요.",
      });
      setSaving(false);
    }
  };

  const bySubject = OFFICIAL_SUBJECTS.map((s) => ({
    s,
    n: v.questions.filter((q) => q.subject === s).length,
  })).filter((x) => x.n > 0);

  return (
    <div className="flex flex-col gap-5">
      <Section title="기본 정보">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="시험 이름">
              <Input
                maxLength={100}
                onChange={(e) => set("title", e.target.value)}
                placeholder="예: 1차 공식 모의시험"
                value={v.title}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field
              hint="응시 전 안내 화면에 그대로 보여요."
              label="안내 문구(선택)"
            >
              <Textarea
                maxLength={2000}
                onChange={(e) => set("description", e.target.value)}
                rows={3}
                value={v.description}
              />
            </Field>
          </div>
          <Field label="응시 시작">
            <Input
              onChange={(e) => set("scheduledStart", e.target.value)}
              type="datetime-local"
              value={v.scheduledStart}
            />
          </Field>
          <Field
            hint="이 시각이 지나면 응시 중인 학생도 자동 제출돼요."
            label="응시 마감"
          >
            <Input
              onChange={(e) => set("scheduledEnd", e.target.value)}
              type="datetime-local"
              value={v.scheduledEnd}
            />
          </Field>
          <Field
            hint="학생마다 시작한 때부터 흐르고, 응시 마감을 넘지 않아요."
            label="제한 시간(분)"
          >
            <Input
              max={600}
              min={1}
              onChange={(e) => set("durationMinutes", Number(e.target.value))}
              type="number"
              value={v.durationMinutes}
            />
          </Field>
          <Field
            hint="화면 이탈·전체화면 해제 등이 이 횟수에 닿으면 자동 제출돼요."
            label="자동 제출 위반 횟수"
          >
            <Input
              max={20}
              min={1}
              onChange={(e) => set("maxViolations", Number(e.target.value))}
              type="number"
              value={v.maxViolations}
            />
          </Field>
        </div>
      </Section>

      <Section
        description={
          questionsLocked
            ? "이미 응시한 학생이 있어 문항은 바꿀 수 없어요."
            : "학생마다 문항 순서와 보기 순서는 자동으로 섞여요."
        }
        title={`문항 구성 · ${v.questions.length}문항`}
      >
        {bySubject.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {bySubject.map(({ s, n }) => (
              <span
                className="rounded-full bg-accent px-2.5 py-1 font-medium text-[12px] text-primary"
                key={s}
              >
                {subjectName(s)} {n}
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex max-h-[420px] flex-col gap-1.5 overflow-y-auto">
          {v.questions.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
              아래에서 문제를 고르거나, 자동 채우기·직접 작성으로 문항을 넣어
              주세요.
            </p>
          ) : (
            v.questions.map((q, i) => (
              <div
                className="flex items-start gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-[13px]"
                key={q.id}
              >
                <span className="mt-0.5 w-6 shrink-0 text-right font-semibold text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="mr-1.5 text-[11.5px] text-primary">
                    {subjectName(q.subject)}
                  </span>
                  {q.status === "exam_only" ? (
                    <span className="mr-1.5 rounded bg-amber-500/12 px-1.5 py-px font-semibold text-[10.5px] text-amber-700">
                      시험 전용
                    </span>
                  ) : null}
                  <span className="line-clamp-2">{q.stem}</span>
                </div>
                {questionsLocked ? null : (
                  <div className="flex shrink-0 gap-0.5">
                    <Button
                      aria-label="위로"
                      onClick={() => move(i, -1)}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      aria-label="아래로"
                      onClick={() => move(i, 1)}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <ArrowDownIcon />
                    </Button>
                    <Button
                      aria-label="빼기"
                      onClick={() =>
                        set(
                          "questions",
                          v.questions.filter((x) => x.id !== q.id)
                        )
                      }
                      size="icon-xs"
                      variant="ghost"
                    >
                      <Trash2Icon className="text-destructive" />
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {questionsLocked ? null : (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={autoFill} size="sm" variant="outline">
                <ShuffleIcon className="size-3.5" /> 실제 시험 구성으로 자동
                채우기(50문항)
              </Button>
              <Button
                onClick={() => setAuthoring((x) => !x)}
                size="sm"
                variant="outline"
              >
                <PenLineIcon className="size-3.5" /> 시험 전용 문제 직접 작성
              </Button>
              {v.questions.length > 0 ? (
                <Button
                  className="text-destructive"
                  onClick={() => set("questions", [])}
                  size="sm"
                  variant="ghost"
                >
                  전부 비우기
                </Button>
              ) : null}
            </div>
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              문제은행(기출) 문제는 응시 기간 동안 모든 학생에게 잠기지만, 원래
              공개된 기출이라 정답을 미리 외웠을 수 있어요. 완전히 새 문제로
              치르려면 시험 전용 문제를 직접 작성하세요.
            </p>

            {authoring ? (
              <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-primary/20 bg-accent/40 p-4">
                <div className="grid gap-3 sm:grid-cols-[200px_1fr_100px]">
                  <Field label="과목">
                    <select
                      className="h-9 rounded-[10px] border border-input bg-card px-2 text-[13px]"
                      onChange={(e) =>
                        setDraft({ ...draft, subject: e.target.value })
                      }
                      value={draft.subject}
                    >
                      {OFFICIAL_SUBJECTS.map((s) => (
                        <option key={s} value={s}>
                          {subjectName(s)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div />
                  <Field label="배점">
                    <Input
                      min={1}
                      max={100}
                      onChange={(e) =>
                        setDraft({ ...draft, maxScore: Number(e.target.value) })
                      }
                      type="number"
                      value={draft.maxScore}
                    />
                  </Field>
                </div>
                <Field label="문제 지문">
                  <Textarea
                    maxLength={3000}
                    onChange={(e) =>
                      setDraft({ ...draft, stem: e.target.value })
                    }
                    rows={3}
                    value={draft.stem}
                  />
                </Field>
                <div className="flex flex-col gap-2">
                  <span className="font-medium text-[13px]">
                    보기 (정답에 표시)
                  </span>
                  {draft.choices.map((c, i) => (
                    <div className="flex items-center gap-2" key={i}>
                      <input
                        checked={draft.correctIndex === i}
                        name="correct"
                        onChange={() => setDraft({ ...draft, correctIndex: i })}
                        type="radio"
                      />
                      <Input
                        maxLength={500}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            choices: draft.choices.map((x, j) =>
                              j === i ? e.target.value : x
                            ),
                          })
                        }
                        placeholder={`보기 ${i + 1}`}
                        value={c}
                      />
                    </div>
                  ))}
                </div>
                <Field label="해설(결과 공개 때 학생에게 보여요)">
                  <Textarea
                    maxLength={3000}
                    onChange={(e) =>
                      setDraft({ ...draft, explanation: e.target.value })
                    }
                    rows={2}
                    value={draft.explanation}
                  />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button
                    onClick={() => setAuthoring(false)}
                    size="sm"
                    variant="ghost"
                  >
                    취소
                  </Button>
                  <Button
                    className="bg-brand"
                    disabled={
                      !draft.stem.trim() || draft.choices.some((c) => !c.trim())
                    }
                    onClick={addAuthored}
                    size="sm"
                  >
                    <PlusIcon className="size-3.5" /> 문항으로 추가
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="mt-5 border-border border-t pt-4">
              <p className="mb-2 font-medium text-[13px]">
                문제은행에서 고르기
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  className="h-9 rounded-[10px] border border-input bg-card px-2 text-[13px] sm:w-48"
                  onChange={(e) =>
                    setSearch({ ...search, subject: e.target.value })
                  }
                  value={search.subject}
                >
                  <option value="">전체 과목</option>
                  {OFFICIAL_SUBJECTS.map((s) => (
                    <option key={s} value={s}>
                      {subjectName(s)}
                    </option>
                  ))}
                </select>
                <div className="relative flex-1">
                  <SearchIcon className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    onChange={(e) =>
                      setSearch({ ...search, q: e.target.value })
                    }
                    onKeyDown={(e) => e.key === "Enter" && runSearch()}
                    placeholder="지문 검색"
                    value={search.q}
                  />
                </div>
                <Button onClick={runSearch} variant="outline">
                  검색
                </Button>
              </div>
              <div className="mt-3 flex max-h-[360px] flex-col gap-1.5 overflow-y-auto">
                {(results ?? []).map((q) => (
                  <div
                    className="flex items-start gap-2 rounded-xl border border-border/70 px-3 py-2 text-[13px]"
                    key={q.id}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="mr-1.5 text-[11.5px] text-primary">
                        {subjectName(q.subject)}
                      </span>
                      <span className="line-clamp-2">{q.stem}</span>
                    </div>
                    <Button
                      disabled={pickedIds.has(q.id)}
                      onClick={() =>
                        set("questions", [
                          ...v.questions,
                          { id: q.id, subject: q.subject, stem: q.stem },
                        ])
                      }
                      size="xs"
                      variant={pickedIds.has(q.id) ? "ghost" : "outline"}
                    >
                      {pickedIds.has(q.id) ? "추가됨" : "추가"}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </Section>

      <div className="flex justify-end gap-2">
        <Button
          className="h-11 rounded-xl"
          onClick={() => router.back()}
          variant="outline"
        >
          취소
        </Button>
        <Button
          className="h-11 rounded-xl bg-brand px-6"
          disabled={
            saving ||
            !v.title.trim() ||
            !v.scheduledStart ||
            !v.scheduledEnd ||
            v.questions.length === 0
          }
          onClick={save}
        >
          {saving ? "저장 중…" : examId ? "변경 저장" : "시험 만들기"}
        </Button>
      </div>
    </div>
  );
}
