import { describeLlmError } from "../../../infrastructure/llm/http.js";
import { type SourceFootnote } from "./context.js";
import { writeAuditLog } from "./audit.js";
import { ASK_ERROR_MESSAGES, askErrorCode } from "./askError.js";
import type { Intent, RequesterContext, AnswerResponse } from "./contracts.js";

export async function failedAnswer(params: {
  question: string;
  ctx: RequesterContext;
  intent: Intent;
  err: unknown;
  sources?: SourceFootnote[];
  ontologyPath?: string[];
  detail?: Record<string, unknown>;
}): Promise<AnswerResponse> {
  const { question, ctx, intent, err } = params;
  const errorCode = askErrorCode(err);
  const sources = params.sources ?? [];
  const finalAnswer = `${ASK_ERROR_MESSAGES[errorCode]} (이 오류는 자동으로 교사에게 기록됩니다.)`;
  console.warn(`[answer] ${intent} 답변 실패(${errorCode}) user=${ctx.userId}:`, err);
  const auditLogId = await writeAuditLog({
    userId: ctx.userId,
    question,
    intent,
    retrievedNodeIds: sources.map((s) => s.nodeId),
    ruleEngineTrace: null,
    llmRawAnswer: null,
    verificationStatus: "flagged",
    verificationDetail: { error: describeLlmError(err), errorCode, ...params.detail },
    finalAnswer,
    confidence: 0,
  });
  return {
    question,
    intent,
    answer: finalAnswer,
    sources,
    ontologyPath: params.ontologyPath ?? [],
    calcTrace: null,
    confidence: 0,
    verificationStatus: "flagged",
    cached: false,
    auditLogId,
    providerUsed: null,
    errorCode,
  };
}

