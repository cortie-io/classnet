"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/chat/toast";

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
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function composeWrongAnswersPrompt(items: ResultItem[], chunkIndex: number, totalChunks: number): string {
  const body = items
    .map((item, i) => {
      const globalIndex = i; // 표시용 — 실제 문제 번호는 아래 stem에 이미 포함돼 있지 않으므로 순번만 매긴다.
      return composeQuestionPrompt(item, globalIndex).replace(/^\d+번 문제 해설해줘\.\n\n/, `${i + 1}. `);
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
function composeAnalysisPrompt(data: AttemptResult, items: ResultItem[]): string {
  const bySubject = new Map<string, { correct: number; total: number }>();
  for (const item of items) {
    const stat = bySubject.get(item.subject) ?? { correct: 0, total: 0 };
    stat.total++;
    if (item.isCorrect) stat.correct++;
    bySubject.set(item.subject, stat);
  }
  const subjectLines = [...bySubject.entries()]
    .map(([subject, s]) => `- ${subject.replace(/^\d과목_/, "")}: ${s.correct}/${s.total}`)
    .join("\n");

  const wrongItems = items.filter((i) => i.isCorrect === false);
  const wrongLines = wrongItems
    .map((i) => `- [${i.subject.replace(/^\d과목_/, "")}] ${i.stem.slice(0, 60)}${i.stem.length > 60 ? "…" : ""}`)
    .join("\n");

  return (
    `이번 시험 결과를 종합적으로 분석해줘. 개별 문제 하나하나 해설하기보다는, 과목별 정답률과 틀린 문제들 사이의 공통된 약점 패턴을 짚어주고, 무엇을 우선 복습해야 할지 학습 방향을 제안해줘.\n\n` +
    `총점: ${data.score}점 (${items.filter((i) => i.isCorrect).length}/${items.length} 정답)\n\n` +
    `과목별 정답률:\n${subjectLines}\n\n` +
    (wrongItems.length > 0 ? `틀린 문제 목록:\n${wrongLines}` : "틀린 문제가 없습니다 — 잘한 점과 더 심화로 준비하면 좋을 부분을 짚어줘.")
  );
}

export default function ExamResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<AttemptResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/exam/attempts/${id}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="px-4 py-10 text-center text-muted-foreground">불러오는 중...</div>;
  if (!data) return <div className="px-4 py-10 text-center text-muted-foreground">응시 기록을 찾을 수 없습니다.</div>;

  if (data.status === "in_progress") {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 px-4 py-16 text-center">
        <p className="font-medium">아직 진행 중인 응시입니다.</p>
        <p className="text-muted-foreground text-sm">
          연습/모의고사를 시작했던 탭에서 계속 진행해 주세요. 새로고침으로 이 화면에 왔다면, 안타깝게도 문제
          화면은 다시 불러올 수 없어 처음부터 다시 시작해야 합니다.
        </p>
        <Link href="/my-exams">
          <Button variant="outline">내 응시 기록으로 이동</Button>
        </Link>
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
    const queries = chunks.map((c, i) => composeWrongAnswersPrompt(c, i, chunks.length));
    sessionStorage.setItem("classnet:queuedQueries", JSON.stringify(queries));
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
    sessionStorage.setItem("classnet:queuedQueries", JSON.stringify([composeAnalysisPrompt(data, data.items)]));
    router.push("/");
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-3 py-6 sm:px-4 sm:py-8">
      <div className="rounded-2xl border border-border/50 bg-card p-6 text-center shadow-[var(--shadow-card)]">
        <p className="text-muted-foreground text-sm">
          {data.status === "auto_submitted" ? "시간 초과로 자동 제출됨" : "제출 완료"}
        </p>
        {isSingleQuestion && gradedCount === 1 ? (
          <p className={`mt-1 font-bold text-3xl ${correctCount === 1 ? "text-emerald-500" : "text-destructive"}`}>
            {correctCount === 1 ? "정답입니다" : "오답입니다"}
          </p>
        ) : (
          <>
            <p className="mt-1 font-bold text-3xl">{data.score}점</p>
            <p className="text-muted-foreground text-sm">
              {correctCount} / {gradedCount} 정답{gradedCount < data.total ? ` (자동채점 대상만)` : ""}
            </p>
          </>
        )}
        {data.gradingPending && (
          <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-amber-600 text-xs">
            주관식·서술형 일부가 아직 채점 전입니다 — 교사 채점이 끝나면 점수가 반영됩니다.
          </p>
        )}
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {!isSingleQuestion && (
            <Button onClick={askAnalysisInChat} size="sm" variant="outline">
              이번 시험 종합 분석 받기
            </Button>
          )}
          {wrongItems.length > 1 && (
            <Button onClick={askWrongInChat} size="sm" variant="outline">
              틀린 문제 {wrongItems.length}개 한 번에 채팅으로 해설받기
            </Button>
          )}
        </div>
      </div>

      <h2 className="mt-2 font-semibold text-lg">문제별 해설</h2>
      {data.items.map((item, i) => (
        <div
          className="rounded-2xl border border-border/50 bg-card p-4 shadow-[var(--shadow-card)] sm:p-5"
          key={item.questionId}
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {item.questionType !== "multiple_choice" && (
              <Badge variant="secondary">{QUESTION_TYPE_LABEL[item.questionType]}</Badge>
            )}
            <span className="text-muted-foreground text-xs">
              {item.score !== null ? `${item.score} / ${item.maxScore}점` : `채점 대기 (${item.maxScore}점 만점)`}
            </span>
          </div>
          <p className="mb-3 whitespace-pre-wrap font-medium text-[14px]">
            {i + 1}. {item.stem}
          </p>
          {item.stemImageUrl ? (
            // biome-ignore lint/performance/noImgElement: 문제 지문 이미지는 public/exam-images의 고정 자산
            <img
              src={item.stemImageUrl}
              alt="문제 지문 이미지"
              className="mb-3 max-h-80 w-fit max-w-full rounded-lg border"
            />
          ) : null}

          {item.questionType === "multiple_choice" ? (
            <div className="flex flex-col gap-1.5">
              {item.choices.map((choice, ci) => {
                let stateClass = "border-border text-muted-foreground";
                if (ci === item.correctIndex) stateClass = "border-emerald-500 bg-emerald-500/10";
                else if (ci === item.selectedIndex) stateClass = "border-destructive bg-destructive/10";
                return (
                  <div className={`rounded-lg border px-3 py-2 text-[13px] ${stateClass}`} key={ci}>
                    {String.fromCharCode(9312 + ci)} {choice}
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              className={`whitespace-pre-wrap rounded-lg border px-3 py-2 text-[13px] ${
                item.isCorrect === true
                  ? "border-emerald-500 bg-emerald-500/10"
                  : item.isCorrect === false
                    ? "border-destructive bg-destructive/10"
                    : "border-border"
              }`}
            >
              {item.answerText || <span className="text-muted-foreground">(미응답)</span>}
            </div>
          )}

          {item.graderFeedback && (
            <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/30 p-2 text-[12px] text-muted-foreground">
              <span className="font-medium">교사 피드백: </span>{item.graderFeedback}
            </p>
          )}

          <p className="mt-3 whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-[12px] text-muted-foreground leading-relaxed">
            {item.explanation}
          </p>
          <Button
            className="mt-2"
            onClick={() => {
              sessionStorage.setItem("classnet:queuedQueries", JSON.stringify([composeQuestionPrompt(item, i)]));
              router.push("/");
            }}
            size="sm"
            variant="outline"
          >
            채팅에서 더 물어보기
          </Button>
        </div>
      ))}
    </div>
  );
}
