import { type SourceFootnote } from "./context.js";
import type { StudentLevel, HistoryTurn } from "./contracts.js";

export function historyBlock(history: HistoryTurn[] | undefined): string {
  if (!history || history.length === 0) return "";
  const lines = history.map((h) => `${h.role === "user" ? "학생" : "튜터"}: ${h.content}`).join("\n");
  return `\n\n[이전 대화]\n${lines}\n\n위 이전 대화의 흐름을 참고해서, 아래 학생의 새 질문에 답하세요. 새 질문이 "그거", "방금 그것", "왜?", "어느 단원이야?"처럼 이전 대화(특히 방금 학생이 물어봤던 문제나 튜터가 방금 설명한 내용)를 가리키는 표현을 쓰면, [컨텍스트]보다 [이전 대화]를 우선 근거로 삼아 무엇을 가리키는지 정확히 파악해서 답하세요. [컨텍스트]가 이전 대화 내용과 무관해 보이면 [컨텍스트]는 무시하세요.`;
}

// 꼬리질문("어느 단원이야?", "왜 그런데?")은 그 자체만으로는 검색어가 거의 비어있는 것과 같아서, 그대로
// 검색하면 RAG가 방금 대화 주제와 무관한 넓은 컨텍스트를 끌어와 [이전 대화]를 압도해버린다(실사용 중 확인된
// 버그: "RSA 해설해줘" 다음에 "어느 단원 문제야?"라고 물으면 RSA 얘기는 다 잊고 컨텍스트에 있던 모든 단원을
// 나열하는 답이 나왔다). 직전 사용자 턴(실제 문제/주제가 담겨 있을 가능성이 가장 높음)을 검색어에 함께 넣어서
// 검색 관련성을 유지한다.
export function retrievalQueryFor(question: string, history: HistoryTurn[] | undefined): string {
  if (!history || history.length === 0) return question;
  const lastUserTurn = [...history].reverse().find((h) => h.role === "user");
  const lastAssistantTurn = [...history].reverse().find((h) => h.role === "assistant");
  // 어시스턴트 턴도 일부(앞부분 300자) 넣는다 — "관련 문제 뽑아줘" 다음 "1번 문제 해설해줘"처럼, 실제
  // 주제(문제 지문)가 직전 사용자 턴이 아니라 직전 튜터 응답 쪽에만 담겨 있는 경우도 실사용 중 확인됐다.
  const parts = [lastUserTurn?.content, lastAssistantTurn?.content?.slice(0, 300), question].filter(
    (s): s is string => !!s,
  );
  return parts.join("\n");
}

export function levelInstruction(level: StudentLevel): string {
  switch (level) {
    case "beginner":
      return "이 학생은 네트워크를 처음 배우는 입문자입니다. 전문 용어는 먼저 쉬운 말과 비유로 풀어 설명한 뒤 용어를 소개하고, 문장은 짧고 친절하게 쓰세요.";
    case "advanced":
      return "이 학생은 기본 개념을 충분히 아는 상급 학습자입니다. 기초 설명은 간략히 하고, 실무 연계나 시험에서 자주 헷갈리는 지점, 심화 내용 위주로 답하세요.";
    default:
      return "이 학생은 기본기를 갖춘 중급 학습자입니다. 핵심을 체계적으로 짚되, 필요한 배경 설명도 함께 제공하세요.";
  }
}

export function footnoteBlock(sources: SourceFootnote[], ontologyPath: string[]): string {
  if (sources.length === 0) return "";
  const lines = sources.map((s) => {
    const scoreStr = s.score !== null ? ` (유사도 ${s.score.toFixed(2)})` : "";
    return `- [${s.subject} > ${s.category} > ${s.topic}] ${s.sectionNo} ${s.title}${scoreStr}`;
  });
  const pathLine = ontologyPath.length > 0 ? `\n\n개념 경로: ${ontologyPath.join(" > ")}` : "";
  return `\n\n---\n출처:\n${lines.join("\n")}${pathLine}`;
}

// 검색 상태를 감사 로그(verification_detail)에 남기는 형태 — "이 답은 임베딩 없이 BM25만으로 찾은
// 근거로 만들었다"를 교사·운영자가 바로 알 수 있게 한다.
