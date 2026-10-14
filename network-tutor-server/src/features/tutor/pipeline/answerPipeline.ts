import { extractCalcRequest } from "../parsing/calcExtractor.js";
import { writeAuditLog } from "./audit.js";
import { cacheKeyOf, getCachedAnswer } from "./cache.js";
import { getWeakAreas, getWeakTopics, getRecentTopics, weakAreaCacheTag, weakAreaInstruction, recentTopicsInstruction } from "./personalization.js";
import { isPracticeRequest, isMultiQuestionPaste } from "../parsing/practiceRequestExtractor.js";
import type { Intent, RequesterContext, AnswerResponse } from "./contracts.js";
import { runCalc } from "./calculate.js";
import { runRetrieval } from "./retrieve.js";
import { runPracticeRequest } from "./practice.js";

export type { Intent, VerificationStatus, StudentLevel, HistoryTurn, RequesterContext, AnswerResponse } from "./contracts.js";

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
