"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/chat/toast";

export type QuestionType = "multiple_choice" | "short_answer" | "subjective" | "essay";

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
  error?: string;
}

const PROCTORED_EVENTS_HELP =
  "이 응시는 감독 대상입니다: 화면 이탈(3초 이상)·전체화면 해제·복사/붙여넣기·우클릭·개발자도구·다중 탭이 기록되며, 반복되면 교사 검토 대상으로 표시되고 심하면 자동 제출됩니다.";

// 문제 연습·모의고사·기출 회차·문제은행 개별풀이 모두 이 컴포넌트를 공유한다. 예전엔 보기를 고르거나
// "정답 확인"을 누르는 즉시 정오답을 공개했는데, 실사용 피드백은 그 반대였다 — 부정행위 방지를 위해
// 모든 문제를 다 풀고 제출해야만 한번에 채점되길 원했다("문제 연습도 다 풀고 제출해야하고 확인 가능하게
// 하고 모의고사도 다 풀고 제출하고 나서 확인 가능하게 해줘"). 그래서 여기서는 정답 여부를 절대 보여주지
// 않고 그냥 답만 저장한다 — 채점 결과는 전부 제출 후 /exam/[id] 결과 화면에서만 확인할 수 있다.
export function ExamRunner({ start, proctored }: { start: ExamStartResponse; proctored: boolean }) {
  const router = useRouter();
  const { attemptId, questions, timeLimitMinutes } = start;
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [answerTexts, setAnswerTexts] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState<Record<number, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [remainingSec, setRemainingSec] = useState<number | null>(timeLimitMinutes ? timeLimitMinutes * 60 : null);
  const deadlineRef = useRef<number | null>(timeLimitMinutes ? Date.now() + timeLimitMinutes * 60_000 : null);
  const submittedRef = useRef(false);

  const current = questions[index];
  const isMC = current?.questionType === "multiple_choice";

  const finalize = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/exam/attempts/${attemptId}/submit`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "제출 실패");
      router.push(`/exam/${attemptId}`);
    } catch (err) {
      toast({ type: "error", description: err instanceof Error ? err.message : "제출 중 오류가 발생했습니다." });
      setSubmitting(false);
      submittedRef.current = false;
    }
  }, [attemptId, router]);

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
            toast({ type: "error", description: "이상 행동이 반복 감지되어 시험이 자동 제출되었습니다." });
            finalize();
          } else if (d?.flagged) {
            toast({ type: "error", description: "이상 행동이 반복 감지되어 검토 대상으로 표시되었습니다." });
          }
        })
        .catch(() => undefined);
    },
    [attemptId, proctored, finalize],
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
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      postProctorEvent("right_click");
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
        if (e.data?.type === "ping" || e.data?.type === "pong") postProctorEvent("multiple_tabs");
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

  // 서버가 응시 시작 시점을 기준으로 판단하는 마감시각을 그대로 카운트다운으로 표시(클라이언트 시계 조작 방지는
  // 서버가 각 답변 제출 시점마다 만료 여부를 재확인하는 것으로 담보한다).
  useEffect(() => {
    if (!deadlineRef.current) return;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.round((deadlineRef.current! - Date.now()) / 1000));
      setRemainingSec(left);
      if (left <= 0) {
        clearInterval(timer);
        toast({ type: "error", description: "제한 시간이 종료되어 자동 제출됩니다." });
        finalize();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [finalize]);

  // 보기를 고르면 로컬 선택 표시만 바꾸고 조용히 서버에 저장한다 — 정오답은 절대 알려주지 않는다.
  // 제출 전까지는 몇 번이든 다른 보기로 바꿔서 다시 저장할 수 있다.
  const handleSelect = async (choiceIdx: number) => {
    setSelected((prev) => ({ ...prev, [current.questionId]: choiceIdx }));
    try {
      const res = await fetch(`/api/exam/attempts/${attemptId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: current.questionId, selectedIndex: choiceIdx }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "답변 저장 실패");
      setSaved((prev) => ({ ...prev, [current.questionId]: true }));
    } catch (err) {
      toast({ type: "error", description: err instanceof Error ? err.message : "오류가 발생했습니다." });
    }
  };

  const submitTextAnswer = async (): Promise<boolean> => {
    const text = (answerTexts[current.questionId] ?? "").trim();
    if (!text) return false;
    try {
      const res = await fetch(`/api/exam/attempts/${attemptId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: current.questionId, answerText: text }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "답변 저장 실패");
      setSaved((prev) => ({ ...prev, [current.questionId]: true }));
      return true;
    } catch (err) {
      toast({ type: "error", description: err instanceof Error ? err.message : "오류가 발생했습니다." });
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
      finalize();
    }
  };

  if (!current) return null;

  const minutes = remainingSec !== null ? Math.floor(remainingSec / 60) : null;
  const seconds = remainingSec !== null ? remainingSec % 60 : null;
  const answered = isMC ? selected[current.questionId] !== undefined : !!saved[current.questionId];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-3 py-6 sm:px-4 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-sm">
        <span>
          {index + 1} / {questions.length}
        </span>
        {remainingSec !== null && (
          <span className={remainingSec < 60 ? "font-semibold text-destructive" : ""}>
            남은 시간 {minutes}:{String(seconds).padStart(2, "0")}
          </span>
        )}
      </div>
      {proctored && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-muted-foreground text-xs">
          {PROCTORED_EVENTS_HELP}
        </p>
      )}
      <div
        className={`rounded-2xl border border-border/50 bg-card p-4 shadow-[var(--shadow-card)] sm:p-5 ${proctored ? "select-none" : ""}`}
      >
        {!isMC && (
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="secondary">{QUESTION_TYPE_LABEL[current.questionType]}</Badge>
            <span className="text-muted-foreground text-xs">배점 {current.maxScore}점</span>
          </div>
        )}
        <p className="whitespace-pre-wrap font-medium text-[15px] leading-relaxed">{current.stem}</p>
        {current.stemImageUrl ? (
          // biome-ignore lint/performance/noImgElement: 문제 지문 이미지는 public/exam-images의 고정 자산
          <img
            src={current.stemImageUrl}
            alt="문제 지문 이미지"
            className="mt-3 max-h-80 w-fit max-w-full rounded-lg border"
          />
        ) : null}

        {isMC && (
          <div className="mt-4 flex flex-col gap-2">
            {current.choices.map((choice, i) => {
              const isSelected = selected[current.questionId] === i;
              const stateClass = isSelected
                ? "border-ring bg-accent shadow-[var(--shadow-card)]"
                : "border-border/60 hover:border-ring hover:shadow-[var(--shadow-card)]";
              return (
                <button
                  className={`rounded-xl border px-4 py-3 text-left text-[14px] transition-all duration-150 ${stateClass}`}
                  key={i}
                  onClick={() => handleSelect(i)}
                  type="button"
                >
                  {String.fromCharCode(9312 + i)} {choice}
                </button>
              );
            })}
          </div>
        )}

        {!isMC && current.questionType === "short_answer" && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              onChange={(e) => {
                setAnswerTexts((p) => ({ ...p, [current.questionId]: e.target.value }));
                setSaved((p) => ({ ...p, [current.questionId]: false }));
              }}
              placeholder="답을 입력하세요"
              value={answerTexts[current.questionId] ?? ""}
            />
            <Button onClick={() => submitTextAnswer()} type="button" variant="outline">
              저장
            </Button>
            {saved[current.questionId] && (
              <span className="shrink-0 text-emerald-600 text-xs dark:text-emerald-400">저장됨</span>
            )}
          </div>
        )}

        {!isMC && (current.questionType === "subjective" || current.questionType === "essay") && (
          <div className="mt-4 flex flex-col gap-2">
            <Textarea
              onChange={(e) => {
                setAnswerTexts((p) => ({ ...p, [current.questionId]: e.target.value }));
                setSaved((p) => ({ ...p, [current.questionId]: false }));
              }}
              placeholder="답안을 작성하세요"
              rows={current.questionType === "essay" ? 8 : 3}
              value={answerTexts[current.questionId] ?? ""}
            />
            <div className="flex items-center justify-end gap-2">
              {saved[current.questionId] && (
                <span className="text-emerald-600 text-xs dark:text-emerald-400">저장됨</span>
              )}
              <Button onClick={() => submitTextAnswer()} type="button" variant="outline">
                저장
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2">
        {!answered && !proctored && (
          <span className="self-center text-muted-foreground text-xs">
            {isMC ? "보기를 선택하세요" : "답을 입력하고 저장하세요"}
          </span>
        )}
        <Button disabled={submitting || !answered} onClick={goNext}>
          {index < questions.length - 1 ? "다음 문제" : "제출하기"}
        </Button>
      </div>
    </div>
  );
}
