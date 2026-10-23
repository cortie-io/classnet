"use client";

import { subjectLabel } from "@/lib/subject";
import {
  CheckIcon,
  ClockIcon,
  MessageCircleQuestionIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { use, useEffect, useState } from "react";
import { PageLoading, PageNotice } from "@/components/chat/page-intro";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/chat/toast";
import { loadJson } from "@/components/load-json";
import { MessageResponse } from "@/components/ai-elements/message";

import {
  ExamRunner,
  type ExamStartResponse,
} from "@/components/exam/exam-runner";
import {
  readPracticeSelection,
  savePracticeSelection,
  type PracticeSelection,
} from "@/lib/practice-continuation";
import { handOffAttempt, takeHandedAttempt } from "@/lib/attempt-handoff";

type QuestionType = "multiple_choice" | "short_answer" | "subjective" | "essay";

const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  multiple_choice: "객관식",
  short_answer: "단답식",
  subjective: "주관식",
  essay: "서술형",
};

interface ResultItem {
  questionId: number;
  subject: string;
  stem: string;
  questionType: QuestionType;
  choices: string[];
  selectedIndex: number | null;
  correctIndex: number | null;
  answerText: string | null;
  isCorrect: boolean | null;
  score: number | null;
  maxScore: number;
  graderFeedback: string | null;
  explanation: string;
  stemImageUrl: string | null;
}

interface AttemptResult {
  status: string;
  score: number | null;
  total: number;
  gradingPending: boolean;
  items: ResultItem[];
  deadline?: number;
  questionCount?: number;
  setKind?: string | null;
}

// 채팅에서 바로 이어서 꼬리질문할 수 있도록, 결과 화면에서 자체적으로 해설을 붙들고 있지 않고 항상
// 새 채팅으로 이어지게 한다 — 오답노트와 동일한 패턴(use-active-chat.tsx의 ?query= 자동 전송 재사용).
function composeQuestionPrompt(item: ResultItem, index: number): string {
  let text = `${index + 1}번 문제 해설해줘.\n\n${item.stem}`;
  if (item.questionType === "multiple_choice" && item.choices.length > 0) {
    text += `\n\n${item.choices.map((c, i) => `${String.fromCharCode(9312 + i)} ${c}`).join(" ")}`;
    if (item.selectedIndex !== null) {
      text += `\n\n내가 선택한 답: ${String.fromCharCode(9312 + item.selectedIndex)} ${item.choices[item.selectedIndex] ?? ""}`;
    }
  } else if (item.answerText) {
    text += `\n\n내가 작성한 답: ${item.answerText}`;
  }
  return text;
}

const MAX_BULK_EXPLAIN = 8;

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    chunks.push(items.slice(i, i + size));
  return chunks;
}

function composeWrongAnswersPrompt(
  items: ResultItem[],
  chunkIndex: number,
  totalChunks: number
): string {
  const body = items
    .map((item, i) => {
      const globalIndex = i; // 표시용 — 실제 문제 번호는 아래 stem에 이미 포함돼 있지 않으므로 순번만 매긴다.
      return composeQuestionPrompt(item, globalIndex).replace(
        /^\d+번 문제 해설해줘\.\n\n/,
        `${i + 1}. `
      );
    })
    .join("\n\n");
  const lead =
    totalChunks > 1
      ? `(${chunkIndex + 1}/${totalChunks}번째 묶음) 아래는 이번에 틀린 문제 ${items.length}개예요. 하나씩 순서대로 해설해줘.`
      : `아래는 이번에 틀린 문제 ${items.length}개예요. 하나씩 순서대로 해설해줘.`;
  return `${lead}\n\n${body}`;
}

// 개별 문제 해설이 아니라, 이번 응시 전체를 놓고 과목별 정답률과 틀린 문제들의 공통점(패턴)을
// 짚어달라는 종합 리포트 요청. 문제 지문 전체를 다 넣으면 프롬프트가 지나치게 길어지므로, 틀린
// 문제는 과목과 요약(앞부분)만 간추려서 넣는다.
function composeAnalysisPrompt(
  data: AttemptResult,
  items: ResultItem[]
): string {
  const bySubject = new Map<string, { correct: number; total: number }>();
  for (const item of items) {
    const stat = bySubject.get(item.subject) ?? { correct: 0, total: 0 };
    stat.total++;
    if (item.isCorrect) stat.correct++;
    bySubject.set(item.subject, stat);
  }
  const subjectLines = [...bySubject.entries()]
    .map(
      ([subject, s]) => `- ${subjectLabel(subject)}: ${s.correct}/${s.total}`
    )
    .join("\n");

  const wrongItems = items.filter((i) => i.isCorrect === false);
  const wrongLines = wrongItems
    .map(
      (i) =>
        `- [${subjectLabel(i.subject)}] ${i.stem.slice(0, 60)}${i.stem.length > 60 ? "…" : ""}`
    )
    .join("\n");

  return (
    `이번 시험 결과를 종합적으로 분석해줘. 개별 문제 하나하나 해설하기보다는, 과목별 정답률과 틀린 문제들 사이의 공통된 약점 패턴을 짚어주고, 무엇을 우선 복습해야 할지 학습 방향을 제안해줘.\n\n` +
    `총점: ${data.score}점 (${items.filter((i) => i.isCorrect).length}/${items.length} 정답)\n\n` +
    `과목별 정답률:\n${subjectLines}\n\n` +
    (wrongItems.length > 0
      ? `틀린 문제 목록:\n${wrongLines}`
      : "틀린 문제가 없습니다 — 잘한 점과 더 심화로 준비하면 좋을 부분을 짚어줘.")
  );
}

export default function ExamResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<AttemptResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<PracticeSelection | null>(null);
  const [startingMore, setStartingMore] = useState(false);
  const [onlyWrong, setOnlyWrong] = useState(false);
  useEffect(() => {
    setSelection(readPracticeSelection(id));
  }, [id]);
  const morePractice = async () => {
    if (!selection || startingMore) return;
    setStartingMore(true);
    try {
      const response = await fetch("/api/exam/practice/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: selection.subject || undefined,
          count: selection.count,
          unseenFirst: selection.unseenFirst !== false,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "문제를 불러오지 못했어요.");
      savePracticeSelection(result.attemptId, selection);
      router.push(handOffAttempt(result));
    } catch (error) {
      toast({
        type: "error",
        description:
          error instanceof Error ? error.message : "문제를 불러오지 못했어요.",
      });
    } finally {
      setStartingMore(false);
    }
  };
  const [reloadKey, setReloadKey] = useState(0);
  const [resumeStart, setResumeStart] = useState<ExamStartResponse | null>(
    null
  );
  const [resumeError, setResumeError] = useState<string | null>(null);
  useEffect(() => {
    setResumeError(null);
    // 방금 시작한 화면이 문제를 맡겨 두고 넘어왔으면 서버에 다시 묻지 않고 바로 푼다
    const handed = takeHandedAttempt(Number(id));
    if (handed) {
      setResumeStart(handed);
      setData({ status: "in_progress" } as AttemptResult);
      setLoading(false);
      return;
    }
    setLoading(true);
    setData(null); // 제출 직후 다시 불러올 때 예전 "진행 중" 상태로 이어 풀기를 또 부르지 않게
    setResumeStart(null);
    // 없는 응시나 남의 응시면 data가 null로 남아 "찾을 수 없습니다"가 보인다(예전엔 {error}가 들어가 화면이 깨졌다).
    loadJson(`/api/exam/attempts/${id}`, setData, { quiet: true }).finally(() =>
      setLoading(false)
    );
  }, [id, reloadKey]);

  // 진행 중인 응시(새로고침, 다른 화면에 갔다 옴, 홈의 "이어서 풀기")면 고른 답 그대로 이어서 연다.
  // 예전엔 "문제 화면은 다시 불러올 수 없어 처음부터 다시 시작해야 해요"였다.
  useEffect(() => {
    if (data?.status !== "in_progress" || resumeStart) {
      return;
    }
    let cancelled = false;
    fetch(`/api/exam/attempts/${id}/resume`, { method: "POST" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (r.ok) setResumeStart(body);
        else setResumeError(body.error ?? "이어서 열 수 없어요.");
      })
      .catch(() => !cancelled && setResumeError("이어서 열 수 없어요."));
    return () => {
      cancelled = true;
    };
  }, [data?.status, id, resumeStart]);
  if (loading) return <PageLoading />;
  if (!data)
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12">
        <PageNotice title="응시 기록을 찾을 수 없어요" />
      </div>
    );

  if (data.status === "in_progress") {
    if (resumeStart)
      return (
        <ExamRunner
          key={resumeStart.attemptId}
          onSubmitted={() => setReloadKey((k) => k + 1)}
          proctored={data.setKind === "mock"}
          start={resumeStart}
        />
      );
    if (!resumeError) return <PageLoading />;
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12">
        <PageNotice
          description={resumeError}
          icon={ClockIcon}
          title="아직 진행 중인 응시예요"
        >
          <Button asChild variant="outline">
            <Link href="/my-exams">내 응시 기록으로 이동</Link>
          </Button>
        </PageNotice>
      </div>
    );
  }

  const gradedCount = data.items.filter((i) => i.isCorrect !== null).length;
  const correctCount = data.items.filter((i) => i.isCorrect).length;
  const wrongItems = data.items.filter((i) => i.isCorrect === false);
  // 문제 1개짜리 응시(문제은행 개별 풀이, 채팅 연습문제)는 "0점"보다 정답/오답으로 보여주는 게 자연스럽다.
  const isSingleQuestion = data.total === 1;

  // MAX_BULK_EXPLAIN개 넘게 틀렸으면 그만큼씩 나눠서, 새 채팅에서 앞 묶음 답변이 끝날 때마다 다음
  // 묶음을 자동으로 이어 보낸다(use-active-chat.tsx 큐 참고) — 넘는 문제를 버리지 않고 전부 설명받는다.
  const askWrongInChat = () => {
    if (wrongItems.length === 0) return;
    const chunks = chunkItems(wrongItems, MAX_BULK_EXPLAIN);
    // 청크가 1개뿐이어도 URL 쿼리 파라미터(router.push("/?query=..."))로는 절대 안 보낸다 — 문제
    // 지문+보기가 길면 nginx 요청 URI 길이 제한(414 Request-URI Too Large)에 걸릴 수 있다(실사용 중
    // 확인된 버그: 기출 회차 전체 풀이 후 종합 분석 요청이 이 경로로 414를 냈다). sessionStorage 큐는
    // 길이 제한이 없으니 항상 이걸로 넘긴다.
    const queries = chunks.map((c, i) =>
      composeWrongAnswersPrompt(c, i, chunks.length)
    );
    sessionStorage.setItem(
      "classnet:phase2:queuedQueries",
      JSON.stringify(queries)
    );
    if (chunks.length > 1) {
      toast({
        type: "success",
        description: `${wrongItems.length}개 문제를 ${MAX_BULK_EXPLAIN}개씩 ${chunks.length}번에 나눠 순서대로 해설해드릴게요.`,
      });
    }
    router.push("/");
  };

  const askAnalysisInChat = () => {
    // askWrongInChat과 동일한 이유로 URL 쿼리 파라미터 대신 sessionStorage 큐를 쓴다 — 기출문제
    // 회차 전체(최대 50문제)를 풀고 틀린 문제가 많으면 지문 목록이 길어져 URL 길이 제한을 넘길 수
    // 있다(실사용 중 확인된 버그: 414 Request-URI Too Large).
    sessionStorage.setItem(
      "classnet:phase2:queuedQueries",
      JSON.stringify([composeAnalysisPrompt(data, data.items)])
    );
    router.push("/");
  };

  // 서버 점수는 이미 100점 만점 환산값이다(examService.buildResultItems).
  const pct = Math.max(0, Math.min(100, data.score ?? 0));
  const passed = (data.score ?? 0) >= 60;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-8 sm:py-12">
      <div className="surface relative overflow-hidden p-6 text-center sm:p-8">
        <div className="pointer-events-none absolute inset-0 bg-brand-soft opacity-70" />
        <div className="pointer-events-none absolute inset-0 bg-dots opacity-50 [mask-image:radial-gradient(closest-side,black,transparent)]" />
        <div className="relative flex flex-col items-center">
          <span className="rounded-full bg-white/80 px-3 py-1 font-semibold text-[12px] text-muted-foreground shadow-[var(--shadow-card)]">
            {data.status === "auto_submitted"
              ? "시간 초과로 자동 제출됨"
              : "제출 완료"}
          </span>
          {isSingleQuestion && gradedCount === 1 ? (
            <div className="mt-4 flex flex-col items-center gap-2">
              <span
                className={`flex size-14 items-center justify-center rounded-full text-white ${correctCount === 1 ? "bg-emerald-500" : "bg-destructive"}`}
              >
                {correctCount === 1 ? (
                  <CheckIcon className="size-7" strokeWidth={3} />
                ) : (
                  <XIcon className="size-7" strokeWidth={3} />
                )}
              </span>
              <p
                className={`font-extrabold text-[28px] tracking-tight ${correctCount === 1 ? "text-emerald-600" : "text-destructive"}`}
              >
                {correctCount === 1 ? "정답입니다" : "오답입니다"}
              </p>
            </div>
          ) : (
            <>
              <div
                className="mt-5 flex size-36 items-center justify-center rounded-full"
                style={{
                  background: `conic-gradient(var(--primary) ${pct * 3.6}deg, oklch(0.92 0.02 277) 0deg)`,
                }}
              >
                <div className="flex size-[124px] flex-col items-center justify-center rounded-full bg-card">
                  <span className="font-extrabold text-[40px] text-foreground tabular-nums leading-none tracking-tight">
                    {data.score}
                  </span>
                  <span className="mt-1 text-[12px] text-muted-foreground">
                    점
                  </span>
                </div>
              </div>
              <p className="mt-4 text-[14px] text-muted-foreground">
                <b className="font-bold text-foreground">{correctCount}</b> /{" "}
                {gradedCount} 정답
                {gradedCount < data.total ? " (자동채점 대상만)" : ""}
              </p>
              {!data.gradingPending && (
                <p
                  className={`mt-1 font-semibold text-[13px] ${passed ? "text-primary" : "text-amber-600"}`}
                >
                  {passed
                    ? "합격선(60점)을 넘었어요 🎉"
                    : "합격선(60점)까지 조금만 더!"}
                </p>
              )}
            </>
          )}
          {data.gradingPending && (
            <p className="mt-3 rounded-xl bg-warning/15 px-3.5 py-2 text-[12.5px] text-amber-700">
              주관식·서술형 일부가 아직 채점 전이에요 — 교사 채점이 끝나면
              점수가 반영돼요.
            </p>
          )}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {selection ? (
              <Button
                className="rounded-xl bg-brand"
                disabled={startingMore}
                onClick={morePractice}
              >
                {startingMore
                  ? "문제를 고르는 중…"
                  : `${selection.subject ? subjectLabel(selection.subject) : "전체 과목"} ${selection.count}문제 더 풀기`}
              </Button>
            ) : (
              <Button asChild className="rounded-xl" variant="outline">
                <Link href="/practice">과목별 문제 더 풀기</Link>
              </Button>
            )}
            {!isSingleQuestion && (
              <Button
                className="rounded-xl bg-brand"
                onClick={askAnalysisInChat}
              >
                <SparklesIcon className="size-4" />
                이번 시험 종합 분석 받기
              </Button>
            )}
            {wrongItems.length > 1 && (
              <Button
                className="rounded-xl"
                onClick={askWrongInChat}
                variant="outline"
              >
                틀린 문제 {wrongItems.length}개 한 번에 해설받기
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="font-bold text-[17px] text-foreground tracking-tight">
          문제별 해설
        </h2>
        {wrongItems.length > 0 && wrongItems.length < data.items.length && (
          <div className="flex gap-1 rounded-full bg-muted p-1">
            {(
              [
                [false, `전체 ${data.items.length}`],
                [true, `틀린 문제 ${wrongItems.length}`],
              ] as const
            ).map(([value, label]) => (
              <button
                className={`rounded-full px-3 py-1 font-medium text-[12.5px] transition-colors ${onlyWrong === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                key={label}
                onClick={() => setOnlyWrong(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {data.items.map((item, i) =>
        onlyWrong && item.isCorrect !== false ? null : (
          <div className="surface p-5 sm:p-6" key={item.questionId}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1 font-bold text-[12px] ${
                  item.isCorrect === true
                    ? "bg-emerald-500/12 text-emerald-700"
                    : item.isCorrect === false
                      ? "bg-destructive/10 text-destructive"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {item.isCorrect === true ? (
                  <CheckIcon className="size-3.5" strokeWidth={3} />
                ) : item.isCorrect === false ? (
                  <XIcon className="size-3.5" strokeWidth={3} />
                ) : null}
                Q{i + 1}
              </span>
              {item.questionType !== "multiple_choice" && (
                <Badge variant="secondary">
                  {QUESTION_TYPE_LABEL[item.questionType]}
                </Badge>
              )}
              <span className="text-muted-foreground text-xs">
                {item.score !== null
                  ? `${item.score} / ${item.maxScore}점`
                  : `채점 대기 (${item.maxScore}점 만점)`}
              </span>
            </div>
            <p className="mb-4 whitespace-pre-wrap font-semibold text-[14.5px] text-foreground leading-relaxed">
              {item.stem}
            </p>
            {item.stemImageUrl ? (
              // biome-ignore lint/performance/noImgElement: 문제 지문 이미지는 public/exam-images의 고정 자산
              <img
                src={item.stemImageUrl}
                alt="문제 지문 이미지"
                className="mb-4 max-h-80 w-fit max-w-full rounded-xl border"
              />
            ) : null}

            {item.questionType === "multiple_choice" ? (
              <div className="flex flex-col gap-1.5">
                {item.choices.map((choice, ci) => {
                  let stateClass = "border-border/70 text-muted-foreground";
                  let mark: string | null = null;
                  if (ci === item.correctIndex) {
                    stateClass =
                      "border-emerald-500/50 bg-emerald-500/8 font-medium text-emerald-900";
                    mark = ci === item.selectedIndex ? "정답 · 내 답" : "정답";
                  } else if (ci === item.selectedIndex) {
                    stateClass =
                      "border-destructive/40 bg-destructive/6 text-destructive";
                    mark = "내 답";
                  }
                  return (
                    <div
                      className={`flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-[13.5px] ${stateClass}`}
                      key={ci}
                    >
                      <span>
                        {String.fromCharCode(9312 + ci)} {choice}
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
              <div
                className={`whitespace-pre-wrap rounded-xl border px-3.5 py-2.5 text-[13.5px] ${
                  item.isCorrect === true
                    ? "border-emerald-500/50 bg-emerald-500/8"
                    : item.isCorrect === false
                      ? "border-destructive/40 bg-destructive/6"
                      : "border-border"
                }`}
              >
                {item.answerText || (
                  <span className="text-muted-foreground">(미응답)</span>
                )}
              </div>
            )}

            {item.graderFeedback && (
              <p className="mt-3 whitespace-pre-wrap rounded-xl border border-primary/15 bg-accent/60 p-3 text-[12.5px] text-foreground/80">
                <span className="font-semibold text-primary">
                  교사 피드백 ·{" "}
                </span>
                {item.graderFeedback}
              </p>
            )}

            <div className="mt-4 rounded-xl bg-muted/70 p-3.5">
              <p className="mb-1 font-semibold text-[12px] text-foreground">
                해설
              </p>
              {/* 해설은 마크다운(**굵게**, 목록)으로 저장돼 있다 — 예전엔 기호가 그대로 보였다 */}
              <MessageResponse className="text-[13px] text-muted-foreground leading-relaxed">
                {item.explanation}
              </MessageResponse>
            </div>
            <Button
              className="mt-3"
              onClick={() => {
                sessionStorage.setItem(
                  "classnet:phase2:queuedQueries",
                  JSON.stringify([composeQuestionPrompt(item, i)])
                );
                router.push("/");
              }}
              size="sm"
              variant="ghost"
            >
              <MessageCircleQuestionIcon className="size-4" />
              채팅에서 더 물어보기
            </Button>
          </div>
        )
      )}
    </div>
  );
}
