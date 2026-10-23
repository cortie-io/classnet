"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  SendIcon,
  ShieldAlertIcon,
  TimerIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/chat/toast";

export type QuestionType =
  | "multiple_choice"
  | "short_answer"
  | "subjective"
  | "essay";

const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  multiple_choice: "객관식",
  short_answer: "단답식",
  subjective: "주관식",
  essay: "서술형",
};

export interface AttemptQuestionView {
  questionId: number;
  stem: string;
  questionType: QuestionType;
  choices: string[];
  maxScore: number;
  stemImageUrl: string | null;
}

export interface ExamStartResponse {
  attemptId: number;
  questions: AttemptQuestionView[];
  timeLimitMinutes: number | null;
  /** 진행 중이던 응시를 이어서 열 때(지정 시험 새로고침 등) 이미 저장해 둔 답 — 화면 기준 보기 번호. */
  savedAnswers?: Record<
    number,
    { selectedIndex?: number; answerText?: string }
  >;
  error?: string;
  /** 풀다 만 응시를 이어서 열었을 때 true */
  resumed?: boolean;
}

const PROCTORED_EVENTS_HELP =
  "이 응시는 감독 대상입니다: 화면 이탈(3초 이상)·전체화면 해제·복사/붙여넣기·우클릭·개발자도구·다중 탭이 기록되며, 반복되면 교사 검토 대상으로 표시되고 심하면 자동 제출됩니다.";

// 문제 연습·모의고사·기출 회차·문제은행 개별풀이 모두 이 컴포넌트를 공유한다. 예전엔 보기를 고르거나
// "정답 확인"을 누르는 즉시 정오답을 공개했는데, 실사용 피드백은 그 반대였다 — 부정행위 방지를 위해
// 모든 문제를 다 풀고 제출해야만 한번에 채점되길 원했다("문제 연습도 다 풀고 제출해야하고 확인 가능하게
// 하고 모의고사도 다 풀고 제출하고 나서 확인 가능하게 해줘"). 그래서 여기서는 정답 여부를 절대 보여주지
// 않고 그냥 답만 저장한다 — 채점 결과는 전부 제출 후 /exam/[id] 결과 화면에서만 확인할 수 있다.
export function ExamRunner({
  start,
  proctored,
  onSubmitted,
}: {
  start: ExamStartResponse;
  proctored: boolean;
  /** 제출이 끝나면 결과 화면으로 가는 대신 이걸 부른다(처음부터 배우기의 단원 확인 문제처럼 그 자리에 머물 때). */
  onSubmitted?: (attemptId: number) => void;
}) {
  const router = useRouter();
  const { attemptId, questions, timeLimitMinutes, savedAnswers } = start;
  // 이어서 열었으면 아직 안 푼 첫 문제부터
  const [index, setIndex] = useState(() => {
    if (!savedAnswers) return 0;
    const first = questions.findIndex((q) => !savedAnswers[q.questionId]);
    return first === -1 ? 0 : first;
  });
  const [selected, setSelected] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {};
    for (const [qid, a] of Object.entries(savedAnswers ?? {}))
      if (a.selectedIndex !== undefined) init[Number(qid)] = a.selectedIndex;
    return init;
  });
  const [answerTexts, setAnswerTexts] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    for (const [qid, a] of Object.entries(savedAnswers ?? {}))
      if (a.answerText !== undefined) init[Number(qid)] = a.answerText;
    return init;
  });
  const [saved, setSaved] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(
      Object.keys(savedAnswers ?? {}).map((qid) => [Number(qid), true])
    )
  );
  // 시간 만료로 자동 제출할 때 아직 "저장"을 안 누른 주관식 입력도 먼저 저장하려고 최신 값을 ref로 들고 있는다.
  const answerTextsRef = useRef(answerTexts);
  answerTextsRef.current = answerTexts;
  const savedRef = useRef(saved);
  savedRef.current = saved;
  // 객관식 저장은 문항별로 한 줄로 세운다 — 보기를 빠르게 ①→② 바꾸면 요청 도착 순서가 뒤바뀌어 서버에 ①이
  // 남을 수 있었다. 화면의 "저장됨" 표시는 그 문항의 마지막 선택이 저장됐을 때만 켠다.
  const saveChainRef = useRef<Record<number, Promise<unknown>>>({});
  const saveSeqRef = useRef<Record<number, number>>({});
  const [saveFailed, setSaveFailed] = useState<Record<number, boolean>>({});
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [remainingSec, setRemainingSec] = useState<number | null>(
    timeLimitMinutes ? timeLimitMinutes * 60 : null
  );
  const deadlineRef = useRef<number | null>(
    timeLimitMinutes ? Date.now() + timeLimitMinutes * 60_000 : null
  );
  const submittedRef = useRef(false);

  const current = questions[index];
  const isMC = current?.questionType === "multiple_choice";

  const finalize = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      await Promise.allSettled(Object.values(saveChainRef.current));
      for (const [qid, text] of Object.entries(answerTextsRef.current)) {
        if (!text.trim() || savedRef.current[Number(qid)]) continue;
        await fetch(`/api/exam/attempts/${attemptId}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId: Number(qid),
            answerText: text.trim(),
          }),
        }).catch(() => undefined);
      }
      const res = await fetch(`/api/exam/attempts/${attemptId}/submit`, {
        method: "POST",
      });
      if (!res.ok) {
        const message: string =
          (await res.json().catch(() => ({}))).error ?? "제출 실패";
        // 서버가 이미 마감 처리한 경우(시간 만료 직후 저장 등)엔 멈춰 있지 말고 결과 화면으로 간다.
        if (message.includes("이미 종료") || message.includes("자동 제출")) {
          if (onSubmitted) onSubmitted(attemptId);
          else router.push(`/exam/${attemptId}`);
          return;
        }
        throw new Error(message);
      }
      if (onSubmitted) onSubmitted(attemptId);
      else router.push(`/exam/${attemptId}`);
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "제출 중 오류가 발생했습니다.",
      });
      setSubmitting(false);
      submittedRef.current = false;
    }
  }, [attemptId, router, onSubmitted]);

  const postProctorEvent = useCallback(
    (eventType: string, detail?: Record<string, unknown>) => {
      if (!proctored) return;
      fetch(`/api/exam/attempts/${attemptId}/proctor-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType, detail: detail ?? {} }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d?.autoSubmit) {
            toast({
              type: "error",
              description:
                "이상 행동이 반복 감지되어 시험이 자동 제출되었습니다.",
            });
            finalize();
          } else if (d?.flagged) {
            toast({
              type: "error",
              description:
                "이상 행동이 반복 감지되어 검토 대상으로 표시되었습니다.",
            });
          }
        })
        .catch(() => undefined);
    },
    [attemptId, proctored, finalize]
  );

  // 감독 대상 응시: 화면 이탈/전체화면 해제/복사·붙여넣기/우클릭/개발자도구/다중 탭 감지.
  // 완벽한 감독은 불가능하다는 전제 하에, 관찰 가능한 신호를 최대한 기록해서 교사 검토에 넘긴다.
  useEffect(() => {
    if (!proctored) return;

    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null) {
        const awaySec = Math.round((Date.now() - hiddenAt) / 1000);
        hiddenAt = null;
        // 알림창 등으로 짧게 포커스가 빠지는 건 흔한 오탐 원인이라, 일정 시간 이상 자리를 비웠을 때만 기록한다.
        if (awaySec >= 3) postProctorEvent("blur", { awaySec });
      }
    };
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) postProctorEvent("fullscreen_exit");
    };
    const onCopy = () => postProctorEvent("copy");
    const onPaste = () => postProctorEvent("paste");
    // 휴대폰에서는 글자를 길게 누르기만 해도 contextmenu가 떠서 우클릭으로 잘못 쌓였다 — 터치 기기에선 막기만 하고 기록하지 않는다.
    const isTouch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (!isTouch) postProctorEvent("right_click");
    };

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onContextMenu);

    // 개발자도구 감지(완벽하지 않은 휴리스틱): 도킹된 개발자도구는 뷰포트를 눌러서 outer-inner 크기
    // 차이를 만든다. 별도 창으로 뜬 개발자도구는 이 방식으로 잡을 수 없다는 한계가 있다.
    let devtoolsOpen = false;
    const devtoolsInterval = setInterval(() => {
      const widthGap = window.outerWidth - window.innerWidth;
      const heightGap = window.outerHeight - window.innerHeight;
      const isOpen = widthGap > 160 || heightGap > 160;
      if (isOpen && !devtoolsOpen) postProctorEvent("devtools_open");
      devtoolsOpen = isOpen;
    }, 1500);

    // 같은 응시(attemptId)를 여러 탭/창에서 동시에 열었는지 감지 — 이미 열려있는 탭이 있으면 서로 응답한다.
    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel(`exam-attempt-${attemptId}`);
      bc.onmessage = (e) => {
        if (e.data?.type === "ping") bc?.postMessage({ type: "pong" });
        if (e.data?.type === "ping" || e.data?.type === "pong")
          postProctorEvent("multiple_tabs");
      };
      bc.postMessage({ type: "ping" });
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onContextMenu);
      clearInterval(devtoolsInterval);
      bc?.close();
    };
  }, [proctored, postProctorEvent, attemptId]);

  // 제출 전에 새로고침·뒤로가기·탭 닫기를 하면 브라우저 확인창을 띄운다(지정 시험은 다시 열면 이어서 풀 수 있다).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (submittedRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // 서버가 응시 시작 시점을 기준으로 판단하는 마감시각을 그대로 카운트다운으로 표시(클라이언트 시계 조작 방지는
  // 서버가 각 답변 제출 시점마다 만료 여부를 재확인하는 것으로 담보한다).
  useEffect(() => {
    if (!deadlineRef.current) return;
    const timer = setInterval(() => {
      const left = Math.max(
        0,
        Math.round((deadlineRef.current! - Date.now()) / 1000)
      );
      setRemainingSec(left);
      if (left <= 0) {
        clearInterval(timer);
        toast({
          type: "error",
          description: "제한 시간이 종료되어 자동 제출됩니다.",
        });
        finalize();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [finalize]);

  // 보기를 고르면 로컬 선택 표시만 바꾸고 조용히 서버에 저장한다 — 정오답은 절대 알려주지 않는다.
  // 제출 전까지는 몇 번이든 다른 보기로 바꿔서 다시 저장할 수 있다.
  const handleSelect = (choiceIdx: number) => {
    const qid = current.questionId;
    const seq = (saveSeqRef.current[qid] ?? 0) + 1;
    saveSeqRef.current[qid] = seq;
    setSelected((prev) => ({ ...prev, [qid]: choiceIdx }));
    setSaved((prev) => ({ ...prev, [qid]: false }));
    setSaveFailed((prev) => ({ ...prev, [qid]: false }));
    const send = async () => {
      try {
        const res = await fetch(`/api/exam/attempts/${attemptId}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: qid, selectedIndex: choiceIdx }),
        });
        if (!res.ok)
          throw new Error(
            (await res.json().catch(() => ({}))).error ?? "답변 저장 실패"
          );
        if (saveSeqRef.current[qid] === seq)
          setSaved((prev) => ({ ...prev, [qid]: true }));
      } catch (err) {
        if (saveSeqRef.current[qid] !== seq) return;
        setSaveFailed((prev) => ({ ...prev, [qid]: true }));
        toast({
          type: "error",
          description:
            err instanceof Error
              ? err.message
              : "답변 저장 중 오류가 발생했습니다.",
        });
      }
    };
    saveChainRef.current[qid] = (
      saveChainRef.current[qid] ?? Promise.resolve()
    ).then(send);
  };

  const submitTextAnswer = async (): Promise<boolean> => {
    const text = (answerTexts[current.questionId] ?? "").trim();
    if (!text) return false;
    try {
      const res = await fetch(`/api/exam/attempts/${attemptId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: current.questionId,
          answerText: text,
        }),
      });
      if (!res.ok)
        throw new Error((await res.json()).error ?? "답변 저장 실패");
      setSaved((prev) => ({ ...prev, [current.questionId]: true }));
      return true;
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "오류가 발생했습니다.",
      });
      return false;
    }
  };

  const goNext = async () => {
    // 마지막 입력이 아직 저장 안 됐을 수 있으니(예: 입력만 하고 버튼을 안 누른 채 바로 다음으로 넘어가는 경우) 한 번 더 저장한다.
    if (!isMC && (answerTexts[current.questionId] ?? "").trim()) {
      await submitTextAnswer();
    }
    if (index < questions.length - 1) {
      setIndex((i) => i + 1);
    } else {
      requestSubmit();
    }
  };

  const goTo = async (target: number) => {
    if (
      !isMC &&
      (answerTexts[current.questionId] ?? "").trim() &&
      !saved[current.questionId]
    ) {
      await submitTextAnswer();
    }
    setConfirmingSubmit(false);
    setIndex(target);
  };

  // 이어서 열었을 때(새로고침, 홈의 "이어서 풀기") 저장해 둔 답이 있으면 알려 준다
  useEffect(() => {
    const n = Object.keys(savedAnswers ?? {}).length;
    if (!start.resumed || n === 0) {
      return;
    }
    toast({
      type: "success",
      description: `풀던 문제를 이어서 열었어요 — 저장된 답 ${n}개를 불러왔어요.`,
    });
  }, [start.resumed, savedAnswers]);

  // PC 키보드: 1~9로 보기 고르기, ←/→로 문항 이동(입력창에 쓰는 중에는 무시)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (e: KeyboardEvent) => {
    if (submitting || e.altKey || e.ctrlKey || e.metaKey) return;
    const el = e.target as HTMLElement | null;
    if (
      el &&
      (el.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
    )
      return;
    if (isMC && /^[1-9]$/.test(e.key)) {
      const i = Number(e.key) - 1;
      if (i < current.choices.length) {
        e.preventDefault();
        handleSelect(i);
      }
    } else if (e.key === "ArrowRight" && index < questions.length - 1) {
      e.preventDefault();
      goTo(index + 1);
    } else if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      goTo(index - 1);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isAnswered = (q: AttemptQuestionView) =>
    q.questionType === "multiple_choice"
      ? selected[q.questionId] !== undefined
      : !!saved[q.questionId];
  const unansweredCount = questions.filter((q) => !isAnswered(q)).length;

  // 답하지 않은 문제가 있으면 바로 내지 않고 한 번 확인받는다(실제 시험처럼 건너뛰었다가 돌아올 수 있으므로).
  const requestSubmit = () => {
    if (unansweredCount > 0 && !confirmingSubmit) {
      setConfirmingSubmit(true);
      return;
    }
    finalize();
  };

  if (!current) return null;

  const minutes = remainingSec !== null ? Math.floor(remainingSec / 60) : null;
  const seconds = remainingSec !== null ? remainingSec % 60 : null;
  const answered = isAnswered(current);
  const answeredCount = questions.length - unansweredCount;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:py-10">
      <div className="surface flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <span className="font-extrabold text-[20px] text-foreground tabular-nums tracking-tight">
              {index + 1}
              <span className="font-medium text-[14px] text-muted-foreground">
                {" "}
                / {questions.length}
              </span>
            </span>
            <span className="text-[12.5px] text-muted-foreground">
              · {answeredCount}문제 답함
            </span>
          </div>
          {remainingSec !== null && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-bold text-[13px] tabular-nums ${
                remainingSec < 60
                  ? "animate-pulse bg-destructive/10 text-destructive"
                  : "bg-accent text-primary"
              }`}
            >
              <TimerIcon className="size-4" />
              {minutes}:{String(seconds).padStart(2, "0")}
            </span>
          )}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-300"
            style={{ width: `${(answeredCount / questions.length) * 100}%` }}
          />
        </div>
        <div className="flex flex-wrap gap-1.5" aria-label="문항 이동">
          {questions.map((q, i) => {
            const done = isAnswered(q);
            const failed = saveFailed[q.questionId];
            const base =
              "h-8 min-w-8 rounded-lg border px-1.5 font-medium text-[12.5px] tabular-nums transition-all duration-150";
            const tone = failed
              ? "border-destructive bg-destructive/10 text-destructive"
              : i === index
                ? "border-primary bg-primary font-bold text-primary-foreground shadow-[var(--shadow-brand)]"
                : done
                  ? "border-primary/20 bg-accent text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary";
            return (
              <button
                aria-current={i === index ? "step" : undefined}
                aria-label={`${i + 1}번${done ? " (답함)" : ""}`}
                className={`${base} ${tone}`}
                key={q.questionId}
                onClick={() => goTo(i)}
                type="button"
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>
      {proctored && (
        <p className="flex gap-2.5 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-[12.5px] text-foreground/75 leading-relaxed">
          <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
          {PROCTORED_EVENTS_HELP}
        </p>
      )}
      <div className={`surface p-5 sm:p-7 ${proctored ? "select-none" : ""}`}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-brand px-2.5 py-1 font-bold text-[12px] text-white">
            Q{index + 1}
          </span>
          {!isMC && (
            <Badge variant="secondary">
              {QUESTION_TYPE_LABEL[current.questionType]}
            </Badge>
          )}
          {!isMC && (
            <span className="text-muted-foreground text-xs">
              배점 {current.maxScore}점
            </span>
          )}
        </div>
        <p className="whitespace-pre-wrap font-semibold text-[16px] text-foreground leading-[1.7] tracking-[-0.02em]">
          {current.stem}
        </p>
        {current.stemImageUrl ? (
          // biome-ignore lint/performance/noImgElement: 문제 지문 이미지는 public/exam-images의 고정 자산
          <img
            src={current.stemImageUrl}
            alt="문제 지문 이미지"
            className="mt-4 max-h-80 w-fit max-w-full rounded-xl border"
          />
        ) : null}

        {isMC && (
          <div className="mt-5 flex flex-col gap-2.5">
            {current.choices.map((choice, i) => {
              const isSelected = selected[current.questionId] === i;
              const stateClass = isSelected
                ? "border-primary bg-accent text-foreground ring-2 ring-primary/15"
                : "border-border bg-card text-foreground/85 hover:border-primary/40 hover:bg-accent/40";
              return (
                <button
                  aria-pressed={isSelected}
                  className={`flex items-start gap-3 rounded-2xl border px-4 py-3.5 text-left text-[14.5px] leading-relaxed transition-all duration-150 active:scale-[0.995] ${stateClass}`}
                  key={i}
                  onClick={() => handleSelect(i)}
                  type="button"
                >
                  <span
                    className={`flex size-6 shrink-0 items-center justify-center rounded-full font-bold text-[12px] transition-colors ${
                      isSelected
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="pt-px">{choice}</span>
                </button>
              );
            })}
            {selected[current.questionId] !== undefined && (
              <span
                className={`self-end text-xs ${saveFailed[current.questionId] ? "text-destructive" : saved[current.questionId] ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
              >
                {saveFailed[current.questionId]
                  ? "저장 실패 — 보기를 다시 눌러 주세요"
                  : saved[current.questionId]
                    ? "저장됨"
                    : "저장 중…"}
              </span>
            )}
          </div>
        )}

        {!isMC && current.questionType === "short_answer" && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              onChange={(e) => {
                setAnswerTexts((p) => ({
                  ...p,
                  [current.questionId]: e.target.value,
                }));
                setSaved((p) => ({ ...p, [current.questionId]: false }));
              }}
              placeholder="답을 입력하세요"
              value={answerTexts[current.questionId] ?? ""}
            />
            <Button
              onClick={() => submitTextAnswer()}
              type="button"
              variant="outline"
            >
              저장
            </Button>
            {saved[current.questionId] && (
              <span className="shrink-0 text-emerald-600 text-xs dark:text-emerald-400">
                저장됨
              </span>
            )}
          </div>
        )}

        {!isMC &&
          (current.questionType === "subjective" ||
            current.questionType === "essay") && (
            <div className="mt-4 flex flex-col gap-2">
              <Textarea
                onChange={(e) => {
                  setAnswerTexts((p) => ({
                    ...p,
                    [current.questionId]: e.target.value,
                  }));
                  setSaved((p) => ({ ...p, [current.questionId]: false }));
                }}
                placeholder="답안을 작성하세요"
                rows={current.questionType === "essay" ? 8 : 3}
                value={answerTexts[current.questionId] ?? ""}
              />
              <div className="flex items-center justify-end gap-2">
                {saved[current.questionId] && (
                  <span className="text-emerald-600 text-xs dark:text-emerald-400">
                    저장됨
                  </span>
                )}
                <Button
                  onClick={() => submitTextAnswer()}
                  type="button"
                  variant="outline"
                >
                  저장
                </Button>
              </div>
            </div>
          )}
      </div>
      {confirmingSubmit && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-warning/50 bg-warning/10 px-4 py-3 font-medium text-sm">
          <span>
            답하지 않은 문제가 {unansweredCount}개 있습니다. 그대로 제출할까요?
          </span>
          <div className="flex gap-2">
            <Button
              onClick={() => setConfirmingSubmit(false)}
              size="sm"
              type="button"
              variant="outline"
            >
              계속 풀기
            </Button>
            <Button
              disabled={submitting}
              onClick={() => finalize()}
              size="sm"
              type="button"
            >
              그대로 제출
            </Button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <Button
          className="h-11 rounded-xl"
          disabled={submitting || index === 0}
          onClick={() => goTo(index - 1)}
          type="button"
          variant="outline"
        >
          <ChevronLeftIcon className="size-4" />
          이전
        </Button>
        <div className="flex items-center gap-2">
          {!answered && (
            <span className="hidden text-muted-foreground text-xs sm:inline">
              {isMC
                ? "건너뛰고 나중에 풀 수 있어요 · 키보드 1~4로 고르고 ←→로 이동"
                : "답을 입력하고 저장하세요"}
            </span>
          )}
          {index < questions.length - 1 && (
            <Button
              className="h-11 rounded-xl bg-brand px-5"
              disabled={submitting}
              onClick={goNext}
              type="button"
            >
              다음
              <ChevronRightIcon className="size-4" />
            </Button>
          )}
          <Button
            className={`h-11 rounded-xl ${index < questions.length - 1 ? "" : "bg-brand px-5"}`}
            disabled={submitting}
            onClick={async () => {
              if (
                !isMC &&
                (answerTexts[current.questionId] ?? "").trim() &&
                !saved[current.questionId]
              )
                await submitTextAnswer();
              requestSubmit();
            }}
            type="button"
            variant={index < questions.length - 1 ? "outline" : "default"}
          >
            {index < questions.length - 1 ? null : (
              <SendIcon className="size-4" />
            )}
            {submitting ? "제출 중…" : "제출하기"}
          </Button>
        </div>
      </div>
    </div>
  );
}
