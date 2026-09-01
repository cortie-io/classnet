"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type QuestionType = "multiple_choice" | "short_answer" | "subjective" | "essay";

interface PracticeQuestion {
  questionId: number;
  stem: string;
  questionType: QuestionType;
  choices: string[];
  maxScore: number;
  stemImageUrl: string | null;
}

export interface PracticeAttempt {
  attemptId: number;
  questions: PracticeQuestion[];
}

function OneQuestion({ attemptId, question, index }: { attemptId: number; question: PracticeQuestion; index: number }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ isCorrect: boolean; correctIndex: number; explanation: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 보기 클릭은 로컬 선택만 바꾸고, 실제 채점(정오답 공개)은 "정답 확인"을 눌러야 일어난다 —
  // 선택하자마자 정오답이 바로 뜨는 걸 원치 않는다는 실사용 피드백 반영.
  const handleChoose = (choiceIdx: number) => {
    if (feedback || submitting) return;
    setSelected(choiceIdx);
  };

  const confirmAnswer = async () => {
    if (selected === null || feedback || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/exam/attempts/${attemptId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.questionId, selectedIndex: selected }),
      });
      const data = await res.json();
      if (res.ok && data.instantFeedback) {
        setFeedback({ isCorrect: data.isCorrect, correctIndex: data.correctIndex, explanation: data.explanation });
      }
    } catch {
      // 네트워크 오류는 조용히 무시 — 채팅 안 미니 카드라 실패해도 대화 자체는 계속 이어가야 한다.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/60 bg-background/60 p-3.5">
      <p className="mb-2.5 whitespace-pre-wrap font-medium text-[13px] leading-relaxed">
        {index + 1}. {question.stem}
      </p>
      {question.stemImageUrl ? (
        // biome-ignore lint/performance/noImgElement: 문제 지문 이미지는 public/exam-images의 고정 자산
        <img alt="문제 지문 이미지" className="mb-2.5 max-h-56 w-fit max-w-full rounded-lg border" src={question.stemImageUrl} />
      ) : null}
      <div className="flex flex-col gap-1.5">
        {question.choices.map((choice, i) => {
          const isSelected = selected === i;
          const showFeedback = !!feedback;
          const isCorrectChoice = feedback?.correctIndex === i;
          let stateClass = "border-border hover:border-ring";
          if (showFeedback && isCorrectChoice) stateClass = "border-emerald-500 bg-emerald-500/10";
          else if (showFeedback && isSelected && !feedback.isCorrect) stateClass = "border-destructive bg-destructive/10";
          else if (isSelected) stateClass = "border-ring bg-accent";
          return (
            <button
              className={`rounded-lg border px-3 py-2 text-left text-[12.5px] transition-colors ${stateClass}`}
              disabled={!!feedback || submitting}
              key={i}
              onClick={() => handleChoose(i)}
              type="button"
            >
              {String.fromCharCode(9312 + i)} {choice}
            </button>
          );
        })}
        {!feedback && (
          <Button
            className="mt-1 self-end"
            disabled={selected === null || submitting}
            onClick={confirmAnswer}
            size="sm"
            type="button"
            variant="outline"
          >
            정답 확인
          </Button>
        )}
      </div>
      {feedback && (
        <div className="mt-2.5 rounded-lg bg-muted/50 p-2.5 text-[12px] leading-relaxed">
          <p className="mb-1 font-semibold">{feedback.isCorrect ? "정답입니다" : "오답입니다"}</p>
          <p className="whitespace-pre-wrap text-muted-foreground">{feedback.explanation}</p>
        </div>
      )}
    </div>
  );
}

export function InlinePracticeQuestions({ attempt }: { attempt: PracticeAttempt }) {
  if (!attempt.questions || attempt.questions.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-3">
      <Badge className="w-fit" variant="secondary">
        문제은행에서 찾은 문제 · 바로 풀어보기
      </Badge>
      {attempt.questions.map((q, i) => (
        <OneQuestion attemptId={attempt.attemptId} index={i} key={q.questionId} question={q} />
      ))}
    </div>
  );
}
