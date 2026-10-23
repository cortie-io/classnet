"use client";

import { subjectLabel } from "@/lib/subject";
import {
  BookOpenIcon,
  NotebookPenIcon,
  PartyPopperIcon,
  RepeatIcon,
  RotateCcwIcon,
  SparklesIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  PageIntro,
  PageLoading,
  PageNotice,
} from "@/components/chat/page-intro";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { handOffAttempt } from "@/lib/attempt-handoff";
import { toast } from "@/components/chat/toast";
import { loadJson } from "@/components/load-json";
import { MessageResponse } from "@/components/ai-elements/message";
import { daysFromToday, type ReviewState } from "@/lib/study-summary";

type QuestionType = "multiple_choice" | "short_answer" | "subjective" | "essay";

const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  multiple_choice: "객관식",
  short_answer: "단답식",
  subjective: "주관식",
  essay: "서술형",
};

const MAX_BULK_EXPLAIN = 8;

interface WrongAnswerItem {
  answerId: number;
  questionId: number;
  conceptNodeId: number | null;
  subject: string;
  stem: string;
  questionType: QuestionType;
  choices: string[] | null;
  correctIndex: number | null;
  selectedIndex: number | null;
  answerText: string | null;
  explanation: string;
  answeredAt: string;
  wrongCount: number;
  reviewState: ReviewState;
  reviewDueAt: string | null;
}

// 오답노트 안에서 해설을 자체적으로 보여주지 않고, 항상 새 채팅으로 이어서 그 안에서 꼬리질문까지
// 자연스럽게 이어갈 수 있게 한다 — use-active-chat.tsx의 ?query= 자동 전송 메커니즘을 그대로 재사용.
function questionBlock(item: WrongAnswerItem, index?: number): string {
  let text = index !== undefined ? `${index + 1}. ${item.stem}` : item.stem;
  if (item.questionType === "multiple_choice" && item.choices) {
    text += `\n${item.choices.map((c, i) => `${String.fromCharCode(9312 + i)} ${c}`).join(" ")}`;
    if (item.selectedIndex !== null) {
      text += `\n내가 선택한 답: ${String.fromCharCode(9312 + item.selectedIndex)} ${item.choices[item.selectedIndex] ?? ""}`;
    }
  } else if (item.answerText) {
    text += `\n내가 작성한 답: ${item.answerText}`;
  }
  return text;
}

function composeQuestionPrompt(item: WrongAnswerItem): string {
  return `이 문제 해설해줘.\n\n${questionBlock(item)}`;
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    chunks.push(items.slice(i, i + size));
  return chunks;
}

function composeMultiQuestionPrompt(
  items: WrongAnswerItem[],
  chunkIndex: number,
  totalChunks: number
): string {
  const body = items.map((item, i) => questionBlock(item, i)).join("\n\n");
  const lead =
    totalChunks > 1
      ? `(${chunkIndex + 1}/${totalChunks}번째 묶음) 아래 틀린 문제 ${items.length}개를 하나씩 순서대로 해설해줘.`
      : `아래 틀린 문제 ${items.length}개를 하나씩 순서대로 해설해줘.`;
  return `${lead}\n\n${body}`;
}

export default function WrongAnswersPage() {
  const router = useRouter();
  const [items, setItems] = useState<WrongAnswerItem[] | null>(null);
  const [subject, setSubject] = useState("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);
  const [view, setView] = useState<"review" | "mastered">("review");
  const [hideAnswers, setHideAnswers] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [openExplanation, setOpenExplanation] = useState<Set<number>>(
    new Set()
  );
  const toggleIn = (setter: typeof setRevealed) => (id: number) =>
    setter((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  useEffect(() => {
    loadJson("/api/exam/wrong-answers", setItems, {
      onError: () => setItems([]),
    });
  }, []);

  // 탭: 아직 복습 중인 문제 / 틀린 뒤 연속으로 맞혀 극복한 문제
  const inView = useMemo(
    () =>
      (items ?? []).filter((i) =>
        view === "mastered"
          ? i.reviewState === "mastered"
          : i.reviewState !== "mastered"
      ),
    [items, view]
  );
  const masteredCount = (items ?? []).filter(
    (i) => i.reviewState === "mastered"
  ).length;
  const dueCount = (items ?? []).filter((i) => i.reviewState === "due").length;

  const subjects = useMemo(
    () => [...new Set(inView.map((i) => i.subject))].sort(),
    [inView]
  );

  const filtered = useMemo(
    () =>
      subject === "all" ? inView : inView.filter((i) => i.subject === subject),
    [inView, subject]
  );

  // URL 쿼리 파라미터(router.push("/?query=..."))로는 절대 안 보낸다 — 문제 지문+보기가 길면 nginx
  // 요청 URI 길이 제한에 걸려 414 Request-URI Too Large가 난다(실사용 중 확인된 버그: 기출 회차 전체
  // 풀이 후 종합 분석 요청이 이 경로로 414를 냈다). sessionStorage 큐는 길이 제한이 없다.
  const askInChat = (item: WrongAnswerItem) => {
    sessionStorage.setItem(
      "classnet:phase2:queuedQueries",
      JSON.stringify([composeQuestionPrompt(item)])
    );
    router.push("/");
  };

  // MAX_BULK_EXPLAIN개 넘게 고르면 한 프롬프트에 다 밀어넣지 않고 그만큼씩 나눠서, 새 채팅에서
  // 앞 묶음의 답변이 끝날 때마다 다음 묶음을 자동으로 이어 보낸다(use-active-chat.tsx 큐 참고) —
  // 예전처럼 넘는 문제를 그냥 버리지 않고 전부 설명받을 수 있게 한다.
  const explainInChat = (items: WrongAnswerItem[]) => {
    if (items.length === 0) return;
    const chunks = chunkItems(items, MAX_BULK_EXPLAIN);
    const queries = chunks.map((c, i) =>
      composeMultiQuestionPrompt(c, i, chunks.length)
    );
    sessionStorage.setItem(
      "classnet:phase2:queuedQueries",
      JSON.stringify(queries)
    );
    if (chunks.length > 1) {
      toast({
        type: "success",
        description: `${items.length}개 문제를 ${MAX_BULK_EXPLAIN}개씩 ${chunks.length}번에 나눠 순서대로 해설해드릴게요.`,
      });
    }
    router.push("/");
  };

  const askSelectedInChat = () => {
    explainInChat(filtered.filter((i) => selected.has(i.answerId)));
  };

  const toggleSelected = (answerId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(answerId) ? next.delete(answerId) : next.add(answerId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const allSelected =
      filtered.length > 0 && filtered.every((i) => selected.has(i.answerId));
    setSelected(
      allSelected ? new Set() : new Set(filtered.map((i) => i.answerId))
    );
  };

  const retry = async (item: WrongAnswerItem) => {
    setRetryingId(item.answerId);
    try {
      const res = await fetch(`/api/exam/bank/${item.questionId}/start`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "다시 풀 수 없습니다.");
      router.push(handOffAttempt(data));
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "오류가 발생했습니다.",
      });
    } finally {
      setRetryingId(null);
    }
  };

  const retryAll = async () => {
    setRetryingAll(true);
    try {
      const res = await fetch("/api/exam/wrong-answers/retry-all", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "다시 풀 수 없습니다.");
      if (
        typeof data.totalWrongCount === "number" &&
        data.totalWrongCount > data.includedCount
      ) {
        toast({
          type: "success",
          description: `틀린 문제가 ${data.totalWrongCount}개라 한 번에 다 담을 수 없어, 이번엔 ${data.includedCount}개만 포함했어요. 다시 누르면 나머지를 이어서 볼 수 있어요.`,
        });
      }
      router.push(handOffAttempt(data));
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "오류가 발생했습니다.",
      });
    } finally {
      setRetryingAll(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:py-12">
      <PageIntro
        description="연습·모의고사·기출에서 틀린 문제를 모았어요. 다시 풀어 두 번 연속 맞히면 극복으로 옮겨져요."
        icon={NotebookPenIcon}
        title="오답노트"
      />

      {items === null ? (
        <PageLoading />
      ) : items.length === 0 ? (
        <PageNotice
          icon={PartyPopperIcon}
          title="아직 틀린 문제가 없어요. 잘하고 있어요!"
        />
      ) : (
        <>
          {dueCount > 0 && (
            <Link
              className="surface surface-hover flex items-center justify-between gap-3 border-primary/30 bg-accent px-4 py-3.5"
              href="/review"
            >
              <span className="flex items-center gap-2.5 text-[13.5px]">
                <RepeatIcon className="size-4 text-primary" />
                <span>
                  <b className="font-semibold text-foreground">
                    오늘 다시 풀 문제 {dueCount}개
                  </b>
                  <span className="text-muted-foreground">
                    {" "}
                    · 틀린 지 하루 지난 문제부터 복습해요
                  </span>
                </span>
              </span>
              <span className="shrink-0 font-semibold text-[13px] text-primary">
                오늘의 복습 →
              </span>
            </Link>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1 rounded-full bg-muted p-1">
              {(
                [
                  ["review", `복습할 문제 ${items.length - masteredCount}`],
                  ["mastered", `극복한 문제 ${masteredCount}`],
                ] as const
              ).map(([key, label]) => (
                <button
                  className={`rounded-full px-3.5 py-1.5 font-medium text-[13px] transition-colors ${view === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  key={key}
                  onClick={() => {
                    setView(key);
                    setSubject("all");
                    setSelected(new Set());
                  }}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <input
                checked={hideAnswers}
                className="size-4 accent-primary"
                onChange={(e) => {
                  setHideAnswers(e.target.checked);
                  setRevealed(new Set());
                }}
                type="checkbox"
              />
              정답 가리고 풀어보기
            </label>
          </div>

          {subjects.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <ChoiceChip
                active={subject === "all"}
                onClick={() => setSubject("all")}
              >
                전체{" "}
                <span
                  className={
                    subject === "all"
                      ? "text-primary-foreground/70"
                      : "text-muted-foreground"
                  }
                >
                  {inView.length}
                </span>
              </ChoiceChip>
              {subjects.map((s) => (
                <ChoiceChip
                  active={subject === s}
                  key={s}
                  onClick={() => setSubject(s)}
                >
                  {subjectLabel(s)}{" "}
                  <span
                    className={
                      subject === s
                        ? "text-primary-foreground/70"
                        : "text-muted-foreground"
                    }
                  >
                    {inView.filter((i) => i.subject === s).length}
                  </span>
                </ChoiceChip>
              ))}
            </div>
          )}

          {filtered.length === 0 ? (
            <PageNotice
              icon={PartyPopperIcon}
              title={
                view === "mastered"
                  ? "아직 극복한 문제가 없어요"
                  : "복습할 문제를 모두 극복했어요!"
              }
              description={
                view === "mastered"
                  ? "틀린 문제를 다시 풀어 두 번 연속 맞히면 여기로 옮겨져요."
                  : undefined
              }
            />
          ) : (
            <>
              <div className="surface z-[5] flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:sticky sm:top-3">
                <label className="flex items-center gap-2 font-medium text-[13px]">
                  <input
                    checked={
                      filtered.length > 0 &&
                      filtered.every((i) => selected.has(i.answerId))
                    }
                    className="size-4 accent-primary"
                    onChange={toggleSelectAll}
                    type="checkbox"
                  />
                  전체 선택 ({selected.size}개 선택됨)
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={selected.size === 0}
                    onClick={askSelectedInChat}
                    size="sm"
                    variant="outline"
                  >
                    <SparklesIcon className="size-3.5" />
                    선택한 문제 AI에게 묻기
                  </Button>
                  <Button
                    className="bg-brand"
                    disabled={retryingAll}
                    onClick={retryAll}
                    size="sm"
                  >
                    <RotateCcwIcon className="size-3.5" />
                    {retryingAll ? "준비 중..." : "모두 다시 풀기"}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                {filtered.map((item) => (
                  <div
                    className={`surface flex flex-col p-4 transition-colors sm:p-5 ${selected.has(item.answerId) ? "border-primary/40 ring-2 ring-primary/10" : ""}`}
                    key={item.answerId}
                  >
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                      <input
                        checked={selected.has(item.answerId)}
                        className="size-4 accent-primary"
                        onChange={() => toggleSelected(item.answerId)}
                        type="checkbox"
                      />
                      <Badge variant="secondary">
                        {subjectLabel(item.subject)}
                      </Badge>
                      {item.questionType !== "multiple_choice" && (
                        <Badge variant="outline">
                          {QUESTION_TYPE_LABEL[item.questionType]}
                        </Badge>
                      )}
                      {item.wrongCount > 1 && (
                        <Badge variant="outline">
                          {item.wrongCount}번 틀림
                        </Badge>
                      )}
                      <span>
                        {new Date(item.answeredAt).toLocaleDateString("ko-KR")}
                      </span>
                      <span
                        className={`ml-auto rounded-full px-2 py-px font-semibold text-[11px] ${
                          item.reviewState === "due"
                            ? "bg-primary/10 text-primary"
                            : item.reviewState === "mastered"
                              ? "bg-emerald-500/12 text-emerald-700"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {item.reviewState === "due"
                          ? "오늘 복습"
                          : item.reviewState === "mastered"
                            ? "극복"
                            : item.reviewDueAt
                              ? `${daysFromToday(item.reviewDueAt)} 복습`
                              : "복습 대기"}
                      </span>
                    </div>
                    <p className="mb-3 whitespace-pre-wrap font-semibold text-[14px] text-foreground leading-relaxed">
                      {item.stem}
                    </p>

                    {item.questionType === "multiple_choice" && item.choices ? (
                      <div className="flex flex-col gap-1.5">
                        {item.choices.map((c, i) => {
                          let stateClass =
                            "border-border/70 text-muted-foreground";
                          let mark: string | null = null;
                          const hidden =
                            hideAnswers && !revealed.has(item.answerId);
                          if (hidden) {
                            // 정답 가리기: 보기만 보여 주고 스스로 떠올려 본 뒤 "정답 보기"
                          } else if (i === item.correctIndex) {
                            stateClass =
                              "border-emerald-500/50 bg-emerald-500/8 text-emerald-900 font-medium";
                            mark = "정답";
                          } else if (i === item.selectedIndex) {
                            stateClass =
                              "border-destructive/40 bg-destructive/6 text-destructive";
                            mark = "내 답";
                          }
                          return (
                            <div
                              className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[13px] ${stateClass}`}
                              key={i}
                            >
                              <span>
                                {String.fromCharCode(9312 + i)} {c}
                              </span>
                              {mark ? (
                                <span className="shrink-0 font-semibold text-[11px]">
                                  {mark}
                                </span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-destructive/40 bg-destructive/6 px-3 py-2 text-[13px] text-destructive">
                        내 답: {item.answerText || "(미응답)"}
                      </div>
                    )}

                    {openExplanation.has(item.answerId) && (
                      <div className="mt-3 rounded-xl bg-muted/70 px-3.5 py-3 text-[13px] text-foreground/90 leading-relaxed">
                        <p className="mb-1 font-semibold text-[12px] text-muted-foreground">
                          해설
                        </p>
                        <MessageResponse>
                          {item.explanation?.trim() ||
                            "저장된 해설이 없어요. AI에게 물어보세요."}
                        </MessageResponse>
                      </div>
                    )}

                    <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
                      {hideAnswers && !revealed.has(item.answerId) ? (
                        <Button
                          onClick={() => toggleIn(setRevealed)(item.answerId)}
                          size="sm"
                          variant="outline"
                        >
                          정답 보기
                        </Button>
                      ) : (
                        <Button
                          onClick={() =>
                            toggleIn(setOpenExplanation)(item.answerId)
                          }
                          size="sm"
                          variant="outline"
                        >
                          <BookOpenIcon className="size-3.5" />
                          {openExplanation.has(item.answerId)
                            ? "해설 접기"
                            : "해설 보기"}
                        </Button>
                      )}
                      <Button
                        onClick={() => askInChat(item)}
                        size="sm"
                        variant="ghost"
                      >
                        <SparklesIcon className="size-3.5" />
                        AI에게 묻기
                      </Button>
                      <Button
                        disabled={retryingId === item.answerId}
                        onClick={() => retry(item)}
                        size="sm"
                        variant="ghost"
                      >
                        {retryingId === item.answerId
                          ? "준비 중..."
                          : "다시 풀어보기"}
                      </Button>
                      {item.conceptNodeId !== null && (
                        <Button asChild size="sm" variant="ghost">
                          <Link
                            href={`/flashcards?nodeId=${item.conceptNodeId}`}
                          >
                            <BookOpenIcon className="size-3.5" />
                            개념 복습
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
