import { describeLlmError } from "../../../infrastructure/llm/http.js";
import { generateChat } from "../../../infrastructure/llm/provider.js";
import { type ChatProviderName } from "../../../infrastructure/llm/types.js";
import { scanForLookupHit } from "../../../infrastructure/search/lookupSearch.js";
import { getNode } from "../../../infrastructure/search/corpus.js";
import { type SourceFootnote } from "./context.js";
import { verifyStructuredAnswer } from "./verify.js";
import { writeAuditLog } from "./audit.js";
import { cacheKeyOf, setCachedAnswer } from "./cache.js";
import type { VerificationStatus, RequesterContext, AnswerResponse } from "./contracts.js";
import { historyBlock, levelInstruction, footnoteBlock } from "./prompt.js";

export async function runLookup(
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
  let providerUsed: ChatProviderName | null = null;
  // 표 데이터만 보여 주는 대체 답(rule_only)이 LLM 장애 때문인지 — 그런 답은 캐시하지 않는다.
  let llmError: unknown = null;
  try {
    const gen = await generateChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      ctx.provider,
      { temperature: 0.1, tier: "fast" },
    );
    rawAnswer = gen.text;
    providerUsed = gen.providerUsed;
  } catch (err) {
    rawAnswer = "";
    llmError = err;
  }
  const verification = rawAnswer
    ? verifyStructuredAnswer(trustedFacts, rawAnswer)
    : { grounded: false, confidence: 0, detail: llmError ? { error: describeLlmError(llmError) } : {} };

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
  if ((ctx.history?.length ?? 0) === 0 && !llmError) {
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

