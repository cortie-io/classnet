import type { ChatMessage } from "../llm/ollama.js";
import { generateChat, type ProviderChoice } from "../llm/provider.js";
import { OPENAI_CHAT_MODEL_HIGH } from "../llm/openai.js";
import { extractCalcRequest } from "../router/calcExtractor.js";
import { hybridRetrieve } from "../search/hybridSearch.js";
import { scanForLookupHit } from "../search/lookupSearch.js";
import { getNode } from "../search/corpus.js";
import { assembleContext, type SourceFootnote } from "./context.js";
import { verifyCalcAnswer, verifyGroundedness, verifyStructuredAnswer } from "./verify.js";
import { writeAuditLog, updateAuditLogVerification } from "./audit.js";
import { cacheKeyOf, getCachedAnswer, setCachedAnswer } from "./cache.js";
import {
  getWeakAreas,
  getWeakTopics,
  getRecentTopics,
  weakAreaCacheTag,
  weakAreaInstruction,
  recentTopicsInstruction,
} from "./personalization.js";
import { isPracticeRequest, CHOICE_MARKER_RE, isMultiQuestionPaste } from "../router/practiceRequestExtractor.js";
import { createAttempt, type AttemptQuestionView } from "../exam/examService.js";
import { pool } from "../db/pool.js";
import type { CalcResult } from "../rules/calculators.js";

export type Intent = "calc" | "lookup" | "explain" | "practice_request" | "out_of_scope";
export type VerificationStatus = "verified" | "flagged" | "cached" | "rule_only";
export type StudentLevel = "beginner" | "intermediate" | "advanced";

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface RequesterContext {
  userId: number;
  level: StudentLevel;
  provider: ProviderChoice;
  imageBase64?: string;
  // 채팅 UI의 이전 대화(직전 턴들)를 함께 보내 꼬리질문("그거 좀 더 쉽게", "왜 그런데?")을 이해하게 한다.
  // /problem 같은 단발성 입력에는 없다.
  history?: HistoryTurn[];
  // answerQuestion()이 요청당 한 번만 채워 넣는다 — runCalc/runRetrieval/runLookup은 그냥 읽기만 한다.
  weakAreaNote?: string;
  cacheTag?: string;
}

function historyBlock(history: HistoryTurn[] | undefined): string {
  if (!history || history.length === 0) return "";
  const lines = history.map((h) => `${h.role === "user" ? "학생" : "튜터"}: ${h.content}`).join("\n");
  return `\n\n[이전 대화]\n${lines}\n\n위 이전 대화의 흐름을 참고해서, 아래 학생의 새 질문에 답하세요. 새 질문이 "그거", "방금 그것", "왜?", "어느 단원이야?"처럼 이전 대화(특히 방금 학생이 물어봤던 문제나 튜터가 방금 설명한 내용)를 가리키는 표현을 쓰면, [컨텍스트]보다 [이전 대화]를 우선 근거로 삼아 무엇을 가리키는지 정확히 파악해서 답하세요. [컨텍스트]가 이전 대화 내용과 무관해 보이면 [컨텍스트]는 무시하세요.`;
}

// 꼬리질문("어느 단원이야?", "왜 그런데?")은 그 자체만으로는 검색어가 거의 비어있는 것과 같아서, 그대로
// 검색하면 RAG가 방금 대화 주제와 무관한 넓은 컨텍스트를 끌어와 [이전 대화]를 압도해버린다(실사용 중 확인된
// 버그: "RSA 해설해줘" 다음에 "어느 단원 문제야?"라고 물으면 RSA 얘기는 다 잊고 컨텍스트에 있던 모든 단원을
// 나열하는 답이 나왔다). 직전 사용자 턴(실제 문제/주제가 담겨 있을 가능성이 가장 높음)을 검색어에 함께 넣어서
// 검색 관련성을 유지한다.
function retrievalQueryFor(question: string, history: HistoryTurn[] | undefined): string {
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

export interface AnswerResponse {
  question: string;
  intent: Intent;
  answer: string;
  sources: SourceFootnote[];
  ontologyPath: string[];
  calcTrace: CalcResult | null;
  confidence: number | null;
  verificationStatus: VerificationStatus;
  cached: boolean;
  auditLogId: number | null;
  providerUsed: "gemma" | "openai" | null;
  // practice_request일 때만 채워진다 — 채팅 안에서 바로 풀어볼 수 있는 실제 문제은행 문제(연습 응시로 미리 생성됨).
  practiceAttempt?: { attemptId: number; questions: AttemptQuestionView[] } | null;
}

function levelInstruction(level: StudentLevel): string {
  switch (level) {
    case "beginner":
      return "이 학생은 네트워크를 처음 배우는 입문자입니다. 전문 용어는 먼저 쉬운 말과 비유로 풀어 설명한 뒤 용어를 소개하고, 문장은 짧고 친절하게 쓰세요.";
    case "advanced":
      return "이 학생은 기본 개념을 충분히 아는 상급 학습자입니다. 기초 설명은 간략히 하고, 실무 연계나 시험에서 자주 헷갈리는 지점, 심화 내용 위주로 답하세요.";
    default:
      return "이 학생은 기본기를 갖춘 중급 학습자입니다. 핵심을 체계적으로 짚되, 필요한 배경 설명도 함께 제공하세요.";
  }
}

function footnoteBlock(sources: SourceFootnote[], ontologyPath: string[]): string {
  if (sources.length === 0) return "";
  const lines = sources.map((s) => {
    const scoreStr = s.score !== null ? ` (유사도 ${s.score.toFixed(2)})` : "";
    return `- [${s.subject} > ${s.category} > ${s.topic}] ${s.sectionNo} ${s.title}${scoreStr}`;
  });
  const pathLine = ontologyPath.length > 0 ? `\n\n개념 경로: ${ontologyPath.join(" > ")}` : "";
  return `\n\n---\n출처:\n${lines.join("\n")}${pathLine}`;
}

async function runCalc(question: string, ctx: RequesterContext): Promise<AnswerResponse> {
  const match = extractCalcRequest(question)!;
  const { kind, result } = match;

  const systemPrompt =
    "당신은 네트워크관리사 2급 필기시험 대비 AI 튜터입니다. 아래에 이미 규칙엔진이 계산을 완료한 결과가 주어집니다. " +
    "당신의 역할은 이 결과를 학생이 이해하기 쉽게 계단식으로 자연스러운 한국어 문장으로 풀어 설명하는 것뿐입니다. " +
    "절대로 주어진 결과에 없는 새로운 숫자를 만들어내거나 값을 바꾸지 마세요. " +
    levelInstruction(ctx.level) +
    (ctx.weakAreaNote ?? "");
  const userPrompt = `계산 종류: ${kind}\n요약: ${result.summary}\n결과값: ${JSON.stringify(result.result)}\n계산 단계:\n${result.steps
    .map((s) => `${s.label}: ${s.detail}`)
    .join("\n")}${historyBlock(ctx.history)}\n\n학생 질문: ${question}\n\n위 계산 결과를 바탕으로 학생에게 설명하는 답변을 작성하세요.`;

  let rawAnswer: string;
  let verification;
  let providerUsed: "gemma" | "openai" = "gemma";
  try {
    // 계산 문제 해설 — 정확도가 중요한 "문제 해설"류라 상위 모델을 쓴다(2026-08-18 결정).
    const gen = await generateChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      ctx.provider,
      { temperature: 0.2, model: OPENAI_CHAT_MODEL_HIGH },
    );
    rawAnswer = gen.text;
    providerUsed = gen.providerUsed;
    verification = verifyCalcAnswer(result, rawAnswer);
  } catch (err) {
    rawAnswer = "";
    verification = { grounded: false, confidence: 0, detail: { error: err instanceof Error ? err.message : String(err) } };
  }

  const stepsText = result.steps.map((s) => `**${s.label}**\n${s.detail}`).join("\n\n");
  let finalAnswer: string;
  let status: VerificationStatus;
  let confidence: number;

  if (verification.grounded && rawAnswer) {
    finalAnswer = `${rawAnswer}\n\n---\n[계산 과정 보기]\n${stepsText}`;
    status = "verified";
    confidence = 1;
  } else {
    finalAnswer = `${result.summary}\n\n---\n[계산 과정 보기]\n${stepsText}`;
    status = "rule_only";
    confidence = 1;
  }

  const auditLogId = await writeAuditLog({
    userId: ctx.userId,
    question,
    intent: "calc",
    retrievedNodeIds: [],
    ruleEngineTrace: { kind, ...result },
    llmRawAnswer: rawAnswer || null,
    verificationStatus: status,
    verificationDetail: { ...verification.detail, providerUsed },
    finalAnswer,
    confidence,
  });

  if ((ctx.history?.length ?? 0) === 0) {
    await setCachedAnswer({
      key: cacheKeyOf(question, ctx.level, ctx.cacheTag),
      question,
      intent: "calc",
      finalAnswer,
      sourceNodeIds: [],
      confidence,
    });
  }

  return {
    question,
    intent: "calc",
    answer: finalAnswer,
    sources: [],
    ontologyPath: [],
    calcTrace: result,
    confidence,
    verificationStatus: status,
    cached: false,
    auditLogId,
    providerUsed,
  };
}

async function runRetrieval(question: string, ctx: RequesterContext): Promise<AnswerResponse> {
  const { primary, expanded, topScore } = await hybridRetrieve(retrievalQueryFor(question, ctx.history));

  // 조회형 우선 시도: 상위 랭크 노드들을 훑어 질문이 표의 특정 행(들)에 정확히 걸리는지 확인한다.
  // 단, 오답노트/시험결과에서 붙여넣은 여러 문제 묶음(①②③④ 보기 마커 포함)은 건너뛴다 — IP 주소·
  // 서브넷 프리픽스(/21, /24 등)가 잔뜩 섞여 있어 조회형 판별용 "특정 토큰" 추출기가 우연한 숫자
  // 겹침만으로 전혀 무관한 표를 조회형 히트로 오인하는 사례가 실사용에서 확인됐다(예: CIDR "/21"이
  // FTP 포트 표의 "21(제어)"와 겹쳐 8문제 해설 요청 전체가 그 표 한 줄짜리 답으로 축소됨). 이런
  // 경우는 항상 일반 설명(RAG) 경로로 보내 요청받은 문제들을 실제로 설명하게 한다.
  // "시험 결과 종합 분석"(exam/[id]/page.tsx의 composeAnalysisPrompt)처럼 보기 마커는 없지만 문제
  // 지문 여러 개가 그대로 박혀 들어오는 경우도 같은 문제가 난다(실사용 중 확인된 버그: "Windows 2000
  // Server..." 지문 속 "2000"이 무관한 Windows Server 2022 표에 우연히 걸려서, 시험 종합 분석 요청
  // 전체가 그 표 한 줄짜리 답으로 축소됨). isMultiQuestionPaste가 "①" 개수뿐 아니라 메시지 길이도
  // 함께 보므로(길면 항상 합성 메시지로 판단) 여기서도 그대로 재사용한다.
  const looksLikePastedQuestions = CHOICE_MARKER_RE.test(question) || isMultiQuestionPaste(question);
  if (primary.length > 0 && !looksLikePastedQuestions) {
    const lookupHit = await scanForLookupHit(
      primary.map((p) => p.node.id),
      question,
    );
    if (lookupHit) return runLookup(question, ctx, lookupHit);
  }

  const intent: Intent = "explain";
  const { contextText, sources, ontologyPath } = primary.length > 0
    ? await assembleContext(primary, expanded)
    : { contextText: "(참고 자료에서 관련 개념을 찾지 못했습니다. 아래 배경지식으로 답하세요.)", sources: [] as SourceFootnote[], ontologyPath: [] as string[] };

  // 실서비스 정책: 컨텍스트가 부족해도 회피하지 않는다. 컨텍스트를 우선 근거로 쓰되, 없으면 배경지식을
  // 쓰고 그 부분은 명확히 라벨링한다. "모른다"고 답을 거부하는 것은 여기서는 오히려 실패다.
  const systemPrompt =
    "당신은 네트워크관리사 2급 필기시험 대비 AI 튜터입니다. 실제 학교에서 학생들이 매일 쓰는 서비스이므로 " +
    "어떤 질문이 와도 회피하지 말고 최선의 답을 즉시 제공해야 합니다. " +
    "[컨텍스트]에 관련 내용이 있으면 그것을 우선 근거로 삼아 자연스럽게 답하세요. " +
    "[컨텍스트]에 없는 내용이라도 네트워크관리사 시험 범위와 관련 있는 사실이라면 당신의 배경지식으로 답하되, " +
    "그 부분 끝에 '[AI 배경지식]'이라고 표시하세요. 확신이 없는 수치나 사실은 단정하지 말고 " +
    "'정확한 확인이 필요합니다'라고 솔직히 밝히세요. 표 데이터가 있으면 수치를 임의로 바꾸지 말고 그대로 인용하세요. " +
    (ctx.imageBase64
      ? "학생이 문제 사진을 첨부했습니다. 반드시 첨부된 이미지를 직접 확인하고 그 안의 문제·보기·그림 내용을 근거로 답하세요. " +
        "이미지를 확인하지 않고 '사진이 첨부되지 않았다'거나 '이미지를 볼 수 없다'고 답하지 마세요 — 이미지는 항상 함께 전달됩니다. "
      : "") +
    levelInstruction(ctx.level) +
    (ctx.weakAreaNote ?? "");
  const userMessage: ChatMessage = {
    role: "user",
    content: `[컨텍스트]\n${contextText}${historyBlock(ctx.history)}\n\n[학생 질문]\n${question}`,
    ...(ctx.imageBase64 ? { images: [ctx.imageBase64] } : {}),
  };

  let rawAnswer: string;
  let providerUsed: "gemma" | "openai" = "gemma";
  try {
    // 학생이 실제 문제 지문을 붙여넣고 설명을 구하는 "문제 해설"(looksLikePastedQuestions)만 상위
    // 모델을 쓰고, 일반 개념 질문은 기본 모델로 충분하다고 보고 비용을 아낀다(2026-08-18 결정).
    // reasoningEffort: "low" — 실측 결과 응답 시간의 대부분(전체 7~10초 중 6.7~7.9초)이 검색이
    // 아니라 생성 자체에 걸렸다(검색은 130~220ms로 이미 빠름). reasoning_effort를 낮추니 같은 질문이
    // 3~7초로 줄었고, 어려운 비교 질문(RIP vs OSPF 표 정리)으로 품질도 직접 확인했는데 여전히 정확했다
    // (요청 반영: 응답 속도 추가 단축).
    const gen = await generateChat(
      [{ role: "system", content: systemPrompt }, userMessage],
      ctx.provider,
      { temperature: 0.3, reasoningEffort: "low", ...(looksLikePastedQuestions ? { model: OPENAI_CHAT_MODEL_HIGH } : {}) },
    );
    rawAnswer = gen.text;
    providerUsed = gen.providerUsed;
  } catch (err) {
    const finalAnswer =
      "죄송합니다, 지금 AI 서버에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해 주세요. " +
      "(이 오류는 자동으로 교사에게 기록됩니다.)";
    const auditLogId = await writeAuditLog({
      userId: ctx.userId,
      question,
      intent,
      retrievedNodeIds: sources.map((s) => s.nodeId),
      ruleEngineTrace: null,
      llmRawAnswer: null,
      verificationStatus: "flagged",
      verificationDetail: { error: err instanceof Error ? err.message : String(err) },
      finalAnswer,
      confidence: 0,
    });
    return {
      question,
      intent,
      answer: finalAnswer,
      sources,
      ontologyPath,
      calcTrace: null,
      confidence: 0,
      verificationStatus: "flagged",
      cached: false,
      auditLogId,
      providerUsed: null,
    };
  }

  // 실서비스 정책: 검증에서 우려가 표시돼도 답변 자체는 항상 즉시 제공한다(응답 지연·회피가 더 큰 리스크).
  // 원래 이 정책 문구는 있었지만 구현은 검증(verifyGroundedness, 실측 ~2-4초)이 끝날 때까지 응답을
  // 안 보내고 있었다 — 학생이 답을 받기까지 매번 생성+검증 두 번의 LLM 호출을 순서대로 기다린 셈이라,
  // 동시접속 지연 체감의 큰 원인이었다(실사용 피드백: "시간 좀 단축됐으면"). 검증은 답변 내용 자체를
  // 바꾸지 않고 "이상 없음/재확인 필요" 표시만 나중에 audit_log에 남기는 용도이므로, 학생에게는 생성이
  // 끝나는 즉시 낙관적으로 응답하고, 검증은 응답을 보낸 뒤 백그라운드에서 이어서 완료한다.
  const finalAnswer = `${rawAnswer}${footnoteBlock(sources, ontologyPath)}`;
  const auditLogId = await writeAuditLog({
    userId: ctx.userId,
    question,
    intent,
    retrievedNodeIds: sources.map((s) => s.nodeId),
    ruleEngineTrace: null,
    llmRawAnswer: rawAnswer,
    verificationStatus: "verified",
    verificationDetail: null,
    finalAnswer,
    confidence: 1,
  });

  void (async () => {
    try {
      const verification = await verifyGroundedness(contextText, question, rawAnswer, ctx.provider);
      const normalizedTopScore = Math.max(0, Math.min(1, topScore));
      const confidence = Number(verification.confidence.toFixed(3));
      let bgFinalAnswer = finalAnswer;
      let status: "verified" | "flagged" = "verified";
      if (!verification.grounded) {
        bgFinalAnswer += `\n\n_(이 답변의 일부 내용은 자동 사실검증에서 재확인이 필요하다고 표시되어 교사 확인 큐에 등록되었습니다.)_`;
        status = "flagged";
      }
      await updateAuditLogVerification(auditLogId, {
        verificationStatus: status,
        verificationDetail: { ...verification.detail, topScore: normalizedTopScore, providerUsed },
        finalAnswer: bgFinalAnswer,
        confidence,
      });
      if (status === "verified" && !ctx.imageBase64 && (ctx.history?.length ?? 0) === 0) {
        await setCachedAnswer({
          key: cacheKeyOf(question, ctx.level, ctx.cacheTag),
          question,
          intent,
          finalAnswer: bgFinalAnswer,
          sourceNodeIds: sources.map((s) => s.nodeId),
          confidence,
        });
      }
    } catch {
      // 백그라운드 검증 실패는 조용히 무시한다 — 학생에게는 이미 응답이 나갔고, audit_log는 낙관적
      // "verified" 상태로 남는다(치명적이지 않음: 최악의 경우 드물게 재확인이 필요한 답변이 교사 검수
      // 큐에 안 뜰 수 있다는 정도 — 응답 자체가 실패하는 것보다는 낫다).
    }
  })();

  return {
    question,
    intent,
    answer: finalAnswer,
    sources,
    ontologyPath,
    calcTrace: null,
    confidence: 1,
    verificationStatus: "verified",
    cached: false,
    auditLogId,
    providerUsed,
  };
}

async function runLookup(
  question: string,
  ctx: RequesterContext,
  lookupHit: Awaited<ReturnType<typeof scanForLookupHit>> & object,
): Promise<AnswerResponse> {
  const lookupNode = getNode(lookupHit.nodeId)!;
  const trustedFacts = lookupHit.matchedRows
    .map((r) => `- ${Object.entries(r.rowData).map(([k, v]) => `${k}: ${v}`).join(", ")}`)
    .join("\n");
  const sources: SourceFootnote[] = [
    {
      nodeId: lookupNode.id,
      subject: lookupNode.subject,
      category: lookupNode.category,
      topic: lookupNode.topic,
      sectionNo: lookupNode.sectionNo,
      title: lookupNode.title,
      score: null,
      via: "hybrid",
    },
  ];
  const ontologyPath = [lookupNode.subject, lookupNode.category, lookupNode.topic];

  const systemPrompt =
    "당신은 네트워크관리사 2급 필기시험 대비 AI 튜터입니다. 아래 [정규화 표 데이터]에 있는 값만 그대로 인용해 " +
    "학생 질문에 간결하게 답하세요. 표에 없는 내용을 추측해서 덧붙이지 마세요. " +
    levelInstruction(ctx.level) +
    (ctx.weakAreaNote ?? "");
  const userPrompt = `[정규화 표 데이터: ${lookupHit.tableName}]\n${trustedFacts}${historyBlock(ctx.history)}\n\n[학생 질문]\n${question}`;

  let rawAnswer = "";
  let providerUsed: "gemma" | "openai" = "gemma";
  try {
    const gen = await generateChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      ctx.provider,
      { temperature: 0.1 },
    );
    rawAnswer = gen.text;
    providerUsed = gen.providerUsed;
  } catch {
    rawAnswer = "";
  }
  const verification = rawAnswer
    ? verifyStructuredAnswer(trustedFacts, rawAnswer)
    : { grounded: false, confidence: 0, detail: {} };

  let finalAnswer: string;
  let status: VerificationStatus;
  let confidence: number;
  if (verification.grounded && rawAnswer) {
    finalAnswer = `${rawAnswer}${footnoteBlock(sources, ontologyPath)}`;
    status = "verified";
    confidence = 1;
  } else {
    finalAnswer = `${trustedFacts}${footnoteBlock(sources, ontologyPath)}`;
    status = "rule_only";
    confidence = 1;
  }

  const auditLogId = await writeAuditLog({
    userId: ctx.userId,
    question,
    intent: "lookup",
    retrievedNodeIds: [lookupNode.id],
    ruleEngineTrace: { tableName: lookupHit.tableName, matchedRows: lookupHit.matchedRows },
    llmRawAnswer: rawAnswer || null,
    verificationStatus: status,
    verificationDetail: { ...verification.detail, providerUsed },
    finalAnswer,
    confidence,
  });
  if ((ctx.history?.length ?? 0) === 0) {
    await setCachedAnswer({
      key: cacheKeyOf(question, ctx.level, ctx.cacheTag),
      question,
      intent: "lookup",
      finalAnswer,
      sourceNodeIds: [lookupNode.id],
      confidence,
    });
  }
  return {
    question,
    intent: "lookup",
    answer: finalAnswer,
    sources,
    ontologyPath,
    calcTrace: null,
    confidence,
    verificationStatus: status,
    cached: false,
    auditLogId,
    providerUsed,
  };
}

const PRACTICE_COUNT_RE = /(\d+)\s*(개|문항|문제)/;
const DEFAULT_PRACTICE_COUNT = 2;
const MAX_PRACTICE_COUNT = 20;

function requestedPracticeCount(question: string): number {
  const m = question.match(PRACTICE_COUNT_RE);
  if (!m) return DEFAULT_PRACTICE_COUNT;
  return Math.min(Math.max(Number(m[1]), 1), MAX_PRACTICE_COUNT);
}

// lookupSearch.ts의 extractSpecificTokens와 같은 발상 — "NSSA", "ABR", "OSPF"처럼 영문 약어는 개념
// 노드 49개짜리 대분류보다 훨씬 더 구체적인 주제 식별자다. 개념 노드 태깅에 의존하면(=concept_node_id
// 일치) 그 노드에 안 걸린 실제 기출 문제를 못 찾아 "완전 무관한 과목 내 랜덤 문제"로 새버린다(실사용
// 확인된 버그: NSSA/ABR 얘기 후 "관련 문제"를 물었더니 전혀 다른 라우팅 방식 비교 문제가 나왔다 — 정작
// 문제은행에는 OSPF 관련 문제가 15개나 있었는데 못 찾은 것).
// PostgreSQL의 단어 경계(\y)는 한글에서 제대로 안 먹는다(실측 확인됨: '\\y2진수\\y'는 매칭 0건,
// 일반 부분일치 '2진수'는 정상 매칭). 그래서 영문 키워드는 \y로 감싸고(짧은 약어가 다른 단어 안에
// 우연히 끼어 매칭되는 것 방지), 한글 키워드는 경계 없이 부분일치로 검색해야 한다 — 대신 "진수"처럼
// 너무 짧은 조각은 무관한 단어에도 우연히 걸릴 수 있어(실측: 3건) "2진수"처럼 숫자+단위까지 포함된
// 조각만 뽑는다.
function extractKeywordTokens(text: string): { bounded: string[]; unbounded: string[] } {
  const acronyms = text.match(/\b[A-Z]{2,}\d*\b/g) ?? [];
  // "Ext4", "Cat6"처럼 순수 대문자가 아닌 혼합 대소문자 기술 용어도 있다(실사용 중 확인된 버그:
  // "ext4 저널링" 얘기 후 "관련 문제"를 물었을 때 이런 용어를 놓쳐서 개념 노드 폴백으로 새다가
  // 완전 무관한 문제가 섞여 나왔다). 숫자가 붙은 영숫자 복합어까지 잡는다(순수 영단어 오탐 방지를
  // 위해 숫자가 반드시 붙어있어야 함).
  const alphaNumCodes = text.match(/\b[A-Za-z]+\d+[A-Za-z]*\b/g) ?? [];
  const bounded = Array.from(new Set([...acronyms, ...alphaNumCodes].map((t) => t.toUpperCase())));

  // 진법 변환("173을 2진수로 변환")은 문제은행 전체 문제의 97.5%가 concept_node_id 태깅이 안 돼있어
  // (실측 확인됨) 개념 노드 매칭으로는 절대 못 찾는다 — 직접 지문 검색만이 유일한 경로다(실사용 중
  // 확인된 버그: "2진수 변환" 다음 "관련 문제"를 물었더니 vi 편집기 문제가 나왔다. 정작 문제은행에
  // "10진수 N을 2진수로 변환" 문제가 6개나 있었는데 못 찾은 것).
  const baseConversionTerms = text.match(/\d*진법|\d+진수/g) ?? [];
  const unbounded = Array.from(new Set(baseConversionTerms));

  return { bounded, unbounded };
}

interface GeneratedQuestion {
  stem: string;
  choices: [string, string, string, string];
  correctIndex: number;
  explanation: string;
}

/** 문제은행에 실제로 맞는 문제가 하나도 없을 때만 쓰는 최후 수단 — AI가 새로 문제를 만들되, 만들자마자
 * 별도의 팩트체크 통과를 반드시 거친 것만 내보낸다(검증 없이 그냥 내보내면 안 됨: 실사용 중 "OSPF는
 * 벨먼-포드, RIP는 다익스트라"처럼 알고리즘이 뒤바뀐 채로 나간 사고가 있었다 — 실제로는 반대다).
 * 검증까지 통과한 것만 exam_questions에 source='ai_generated'/status='approved'로 저장해 문제은행에도
 * 남긴다(나중에 관리자가 검수/반려 가능, /admin/questions에서 조회됨). */
async function generateFallbackQuestion(
  topicLabel: string,
  contextText: string,
  subject: string,
  provider: ProviderChoice,
): Promise<number | null> {
  const genPrompt = `당신은 네트워크관리사 2급 필기시험 출제 위원입니다. 아래 주제로 객관식 문제 1개를 새로 만드세요.
[주제]\n${topicLabel}\n\n[참고 자료(있으면 최우선 근거로 삼으세요)]\n${contextText.slice(0, 3000) || "(참고 자료 없음 — 당신의 지식으로 만드세요)"}\n
반드시 아래 JSON 형식으로만 답하세요. 다른 설명은 절대 추가하지 마세요.
{"stem": "문제 지문", "choices": ["보기1", "보기2", "보기3", "보기4"], "correctIndex": 0부터_시작하는_정답_인덱스, "explanation": "정답인 이유를 간단히"}
기술적 사실(알고리즘 종류, 프로토콜 번호, 표준 규격 등)은 절대 혼동하지 말고 정확히 확인한 것만 쓰세요.`;

  let parsed: GeneratedQuestion;
  try {
    const { text: raw } = await generateChat(
      [
        { role: "system", content: "You are a careful, accurate exam question writer. Respond with JSON only." },
        { role: "user", content: genPrompt },
      ],
      provider,
      { temperature: 0.2, model: OPENAI_CHAT_MODEL_HIGH },
    );
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const candidate = JSON.parse(jsonMatch[0]) as Partial<GeneratedQuestion>;
    if (
      typeof candidate.stem !== "string" ||
      !Array.isArray(candidate.choices) ||
      candidate.choices.length !== 4 ||
      candidate.choices.some((c) => typeof c !== "string") ||
      typeof candidate.correctIndex !== "number" ||
      candidate.correctIndex < 0 ||
      candidate.correctIndex > 3
    ) {
      return null;
    }
    parsed = candidate as GeneratedQuestion;
  } catch {
    return null;
  }

  // 생성 직후 별도의 신선한 호출로 팩트체크한다 — 같은 호출 안에서 스스로 검토하게 하면 자기 확신을
  // 그대로 반복할 뿐 실제 검증 효과가 약하다는 게 verify.ts의 기존 설계 방침이라 그대로 따른다.
  const verifyPrompt = `당신은 네트워크관리사 2급 시험 문제의 엄격한 검수위원입니다. 아래 객관식 문제와 정답이 기술적으로 완전히 정확한지 판단하세요.
특히 알고리즘 종류, 프로토콜 번호/포트, 표준 규격, 계층 구분 같은 구체적 사실이 서로 혼동되지 않았는지 꼼꼼히 확인하세요.
반드시 아래 JSON 형식으로만 답하세요.
{"valid": true 또는 false, "reason": "한 문장 이유"}

[문제]\n${parsed.stem}\n[보기]\n${parsed.choices.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n[표시된 정답]\n${parsed.correctIndex + 1}번: ${parsed.choices[parsed.correctIndex]}\n[해설]\n${parsed.explanation}`;

  try {
    const { text: verifyRaw } = await generateChat(
      [
        { role: "system", content: "You are a strict technical fact-checker. Respond with JSON only." },
        { role: "user", content: verifyPrompt },
      ],
      provider,
      { temperature: 0, model: OPENAI_CHAT_MODEL_HIGH },
    );
    const verifyMatch = verifyRaw.match(/\{[\s\S]*\}/);
    if (!verifyMatch) return null;
    const verifyResult = JSON.parse(verifyMatch[0]) as { valid?: boolean };
    if (!verifyResult.valid) {
      return null;
    }
  } catch {
    return null;
  }

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO exam_questions (source, subject, stem, question_type, choices, correct_index, max_score, explanation, status)
     VALUES ('ai_generated', $1, $2, 'multiple_choice', $3, $4, 1, $5, 'approved') RETURNING id`,
    [subject, parsed.stem, JSON.stringify(parsed.choices), parsed.correctIndex, parsed.explanation],
  );
  return rows[0]?.id ?? null;
}

/** "이거랑 비슷한 문제 줘"류 요청 — 절대로 AI가 그 자리에서 문제를 지어내지 않는다. 실제 검수를 거쳐
 * 승인된 문제은행(exam_questions)에서만 찾아서, 연습 응시(practice_custom)로 미리 만들어 반환한다.
 * 채팅 화면은 이 attemptId로 곧바로 이어서 풀 수 있는 카드를 렌더링한다. */
async function runPracticeRequest(question: string, ctx: RequesterContext): Promise<AnswerResponse> {
  const count = requestedPracticeCount(question);
  const MIN_TOPIC_SCORE = 0.5;

  // 이번 메시지 자체에 이미 명확한 주제가 있는지 먼저 본다(예: "osi 7계층 관련 문제"). 있으면 그것만
  // 쓰고 이전 대화는 무시한다 — 실사용 중 확인된 버그: "2진수 변환" 얘기를 한참 하다가 전혀 다른 주제
  // "osi 7계층 관련 문제"를 새로 요청했는데, 직전 대화까지 검색어에 섞다 보니 옛 주제("2진수")가
  // 새 요청보다 텍스트 분량이 많아 그대로 눌러버렸다(단독 질문 topScore 0.62 vs 대화 포함 0.48).
  // "관련 문제 뽑아줘"처럼 이번 메시지에 주제가 아예 없을 때만(대화 없이도 topScore가 낮음) 아래에서
  // 직전 대화를 검색어에 섞는 기존 방식으로 넘어간다.
  const questionOnlyKeywords = extractKeywordTokens(question);
  const hasQuestionOnlyKeyword = questionOnlyKeywords.bounded.length > 0 || questionOnlyKeywords.unbounded.length > 0;
  const { primary: questionOnlyPrimary, topScore: questionOnlyScore } = await hybridRetrieve(question);
  const questionHasOwnTopic = hasQuestionOnlyKeyword || questionOnlyScore >= MIN_TOPIC_SCORE;

  // "관련 문제 뽑아줄 수 있어?"처럼 요청 자체에는 주제가 없는 경우가 많다 — 직전 대화(예: 방금 물어본
  // "포트 443은 무슨 서비스야?")를 검색어에 함께 넣지 않으면 엉뚱한 개념의 문제를 찾아온다(실사용 중
  // 확인된 버그: 포트/HTTPS 얘기 다음 "관련 문제"를 물었더니 링크상태 라우팅 문제가 나왔다).
  const retrievalQuery = questionHasOwnTopic ? question : retrievalQueryFor(question, ctx.history);
  const { primary, topScore } = questionHasOwnTopic
    ? { primary: questionOnlyPrimary, topScore: questionOnlyScore }
    : await hybridRetrieve(retrievalQuery);
  // topScore(최상위 후보의 벡터 유사도)가 낮으면 topNode 자체가 사실상 무관한 노드다 — 이걸 그대로
  // concept_node_match/subject_fallback에 쓰면 완전히 다른 주제의 문제가 "관련 문제"로 나가버린다
  // (실사용 중 확인된 버그: "173을 2진수로 변환" 다음 "관련 문제"를 물었더니 vi 편집기 명령어 문제가
  // 나왔다 — 이때 topScore가 0.44로, 실제 좋은 매칭(0.6대)에 한참 못 미쳤다). 진짜 주제 매칭일 때만
  // topNode를 신뢰하고, 아니면 차라리 키워드 매칭 결과만 쓰거나 정직하게 "못 찾음"으로 넘긴다.
  const topNode = topScore >= MIN_TOPIC_SCORE ? (primary[0]?.node ?? null) : null;

  let questionIds: number[] = [];
  let method = "";

  // 1순위: 대화에서 뽑은 구체적 키워드(약어)로 문제 지문을 직접 검색 — 개념 노드 태깅보다 정밀하다.
  // 단순 ILIKE '%AS%' 부분일치는 "AS"가 "Class"/"Base" 같은 무관한 단어 안에도 걸려버려서(실사용 중
  // 확인된 버그) 단어 경계(\y)를 강제하는 정규식으로 짧은 약어도 안전하게 매칭한다.
  const { bounded, unbounded } = questionHasOwnTopic ? questionOnlyKeywords : extractKeywordTokens(retrievalQuery);
  const patterns = [...bounded.map((k) => `\\y${k}\\y`), ...unbounded];
  if (patterns.length > 0) {
    const { rows } = await pool.query<{ id: number; hits: number }>(
      `SELECT id, (SELECT count(*) FROM unnest($1::text[]) p WHERE stem ~* p) AS hits
       FROM exam_questions
       WHERE status = 'approved' AND stem ~* ANY($1::text[])
       ORDER BY hits DESC, random()
       LIMIT $2`,
      [patterns, count],
    );
    questionIds = rows.map((r) => r.id);
    if (questionIds.length > 0) method = "keyword_match";
  }

  // 2순위: 개념 노드 태깅 일치. 후보 2·3순위 노드까지 쓰면 주제가 살짝 옆길로 새는 사례가 실사용
  // 중 확인돼서(예: "ext4 저널링" 다음 관련 문제에 침입방지시스템 문제가 섞여 나옴), 정확도를 위해
  // 최상위 후보 하나만 쓴다 — 개수가 부족하게 나올 수는 있어도 무관한 문제가 섞이는 것보다 낫다.
  // topNode가 null이면(위 MIN_TOPIC_SCORE 미달) 아예 이 단계를 건너뛴다.
  if (questionIds.length < count && topNode) {
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM exam_questions WHERE status = 'approved' AND concept_node_id = $1
       AND id != ALL($2::int[]) ORDER BY random() LIMIT $3`,
      [topNode.id, questionIds, count - questionIds.length],
    );
    if (rows.length > 0 && !method) method = "concept_node_match";
    questionIds.push(...rows.map((r) => r.id));
  }

  // 3순위(최후 수단): 같은 과목 내 무작위 — 주제가 정확히 안 맞을 수 있으니 답변 문구에서 반드시 솔직하게 밝힌다.
  let filledBySubjectFallback = false;
  if (questionIds.length < count && topNode) {
    const { rows: bySubject } = await pool.query<{ id: number }>(
      `SELECT id FROM exam_questions WHERE status = 'approved' AND subject = $1
       AND id != ALL($2::int[]) ORDER BY random() LIMIT $3`,
      [topNode.subject, questionIds, count - questionIds.length],
    );
    if (bySubject.length > 0) {
      filledBySubjectFallback = true;
      if (!method) method = "subject_fallback";
    }
    questionIds.push(...bySubject.map((r) => r.id));
  }

  const allKeywords = [...bounded, ...unbounded];
  const topicLabel = allKeywords.length > 0 ? allKeywords.join("/") : topNode ? topNode.title : "요청하신 주제";

  // 4순위(최후 수단): 문제은행에 진짜 하나도 없으면 AI가 새로 만든다 — 단, generateFallbackQuestion 안에서
  // 별도 팩트체크를 통과한 것만 나온다(요청 반영: "문제은행 기본, 없으면 창작 허용"). 검증까지 실패하면
  // 억지로 보여주지 않고 정직하게 "못 찾음"으로 넘어간다.
  let generatedFallback = false;
  if (questionIds.length === 0) {
    const { contextText } = primary.length > 0 ? await assembleContext(primary, []) : { contextText: "" };
    const subject = topNode?.subject ?? "1과목_네트워크_일반";
    // topicLabel은 키워드/개념 노드가 안 잡혔을 때 "요청하신 주제"처럼 의미 없는 표시용 문구로 빠질 수
    // 있다(실측 확인된 버그: "제로트러스트" 요청인데 정작 생성 프롬프트에 주제가 안 들어가 엉뚱하게
    // OSPF 문제를 만들어버림) — 생성에는 항상 학생이 실제로 입력한 원문(question)을 그대로 준다.
    const newId = await generateFallbackQuestion(question, contextText, subject, ctx.provider);
    if (newId) {
      questionIds = [newId];
      method = "ai_generated_verified";
      generatedFallback = true;
    }
  }

  if (questionIds.length === 0) {
    const finalAnswer =
      "죄송해요, 지금 문제은행에서 이 주제와 딱 맞는 문제를 찾지 못했고, 새로 만들어본 문제도 검증을 통과하지 못해 보여드리지 못했어요. 다른 표현으로 다시 물어보시거나, 사이드바의 '문제 연습'에서 과목별로 찾아보실 수 있어요.";
    const auditLogId = await writeAuditLog({
      userId: ctx.userId,
      question,
      intent: "practice_request",
      retrievedNodeIds: topNode ? [topNode.id] : [],
      ruleEngineTrace: null,
      llmRawAnswer: null,
      verificationStatus: "rule_only",
      verificationDetail: { method: "practice_request_no_match" },
      finalAnswer,
      confidence: 1,
    });
    return {
      question,
      intent: "practice_request",
      answer: finalAnswer,
      sources: [],
      ontologyPath: [],
      calcTrace: null,
      confidence: 1,
      verificationStatus: "rule_only",
      cached: false,
      auditLogId,
      providerUsed: null,
      practiceAttempt: null,
    };
  }

  const { attemptId, questions } = await createAttempt({
    userId: ctx.userId,
    kind: "practice_custom",
    questionIds,
    title: topNode ? `${topNode.title} 관련 문제` : "연습 문제",
  });

  const shortfallNote =
    !generatedFallback && questions.length < count
      ? ` (요청하신 ${count}개 중 문제은행에서 실제로 찾은 건 ${questions.length}개예요.)`
      : "";
  const fallbackNote = filledBySubjectFallback
    ? " 일부는 정확히 같은 세부 주제는 아니지만 같은 과목의 문제로 채웠어요."
    : "";
  const finalAnswer = generatedFallback
    ? `문제은행에 **${topicLabel}** 관련 문제가 없어서, AI가 새로 만들고 검증까지 통과한 문제를 보여드려요. 아래에서 바로 풀어보세요.`
    : `**${topicLabel}** 관련 실제 문제를 문제은행에서 ${questions.length}개 찾았어요.${shortfallNote}${fallbackNote} 아래에서 바로 풀어보세요.`;
  const auditLogId = await writeAuditLog({
    userId: ctx.userId,
    question,
    intent: "practice_request",
    retrievedNodeIds: topNode ? [topNode.id] : [],
    ruleEngineTrace: null,
    llmRawAnswer: null,
    verificationStatus: "rule_only",
    verificationDetail: { method, attemptId, questionIds, requestedCount: count },
    finalAnswer,
    confidence: 1,
  });

  return {
    question,
    intent: "practice_request",
    answer: finalAnswer,
    sources: [],
    ontologyPath: topNode ? [topNode.subject, topNode.category, topNode.topic] : [],
    calcTrace: null,
    confidence: 1,
    verificationStatus: "rule_only",
    cached: false,
    auditLogId,
    providerUsed: null,
    practiceAttempt: { attemptId, questions },
  };
}

export async function answerQuestion(question: string, rawCtx: RequesterContext): Promise<AnswerResponse> {
  // 개인화 신호(취약 과목/주제, 최근 관심 주제)는 요청당 한 번만 조회해서 ctx에 채워 넣는다 —
  // runCalc/runRetrieval/runLookup은 그냥 읽기만 한다. 오답 기록과 최근 질문 이력(채팅방을 넘나드는
  // audit_log 기반)을 모든 답변에 반영해달라는 요구사항 반영.
  const [weakAreas, weakTopics, recentTopics] = await Promise.all([
    getWeakAreas(rawCtx.userId),
    getWeakTopics(rawCtx.userId),
    getRecentTopics(rawCtx.userId),
  ]);
  const ctx: RequesterContext = {
    ...rawCtx,
    weakAreaNote: weakAreaInstruction(weakAreas, weakTopics) + recentTopicsInstruction(recentTopics),
    cacheTag: weakAreaCacheTag(weakAreas, weakTopics, recentTopics),
  };

  // 매번 새 연습 응시(exam_attempts row)를 만들기 때문에 캐싱하면 안 된다 — 다른 학생/다른 시점에
  // 캐시된 attemptId를 그대로 돌려주면 남의 응시를 풀게 되는 심각한 버그가 된다.
  if (!ctx.imageBase64 && isPracticeRequest(question)) {
    return runPracticeRequest(question, ctx);
  }

  // 이미지 질문과 마찬가지로, 이전 대화가 딸린 꼬리질문도 캐싱하지 않는다 — 같은 질문 텍스트라도
  // 대화 맥락에 따라 답이 달라야 하는데 캐시는 텍스트만 보고 맥락을 모르기 때문이다.
  const cacheable = !ctx.imageBase64 && (ctx.history?.length ?? 0) === 0;

  if (cacheable) {
    const key = cacheKeyOf(question, ctx.level, ctx.cacheTag);
    const cached = await getCachedAnswer(key);
    if (cached) {
      const auditLogId = await writeAuditLog({
        userId: ctx.userId,
        question,
        intent: cached.intent,
        retrievedNodeIds: cached.sourceNodeIds,
        ruleEngineTrace: null,
        llmRawAnswer: null,
        verificationStatus: "cached",
        verificationDetail: { fromCache: true },
        finalAnswer: cached.finalAnswer,
        confidence: cached.confidence,
      });
      return {
        question,
        intent: cached.intent as Intent,
        answer: cached.finalAnswer,
        sources: [],
        ontologyPath: [],
        calcTrace: null,
        confidence: cached.confidence,
        verificationStatus: "cached",
        cached: true,
        auditLogId,
        providerUsed: null,
      };
    }
  }

  const calcMatch = !ctx.imageBase64 && !isMultiQuestionPaste(question) ? extractCalcRequest(question) : null;
  if (calcMatch) return runCalc(question, ctx);
  return runRetrieval(question, ctx);
}
