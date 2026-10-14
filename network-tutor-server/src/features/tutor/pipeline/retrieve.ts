import { generateChat } from "../../../infrastructure/llm/provider.js";
import { normalizeImage, type ChatMessage, type ChatProviderName } from "../../../infrastructure/llm/types.js";
import { hybridRetrieve, type HybridRetrieveResult } from "../../../infrastructure/search/hybridSearch.js";
import { scanForLookupHit } from "../../../infrastructure/search/lookupSearch.js";
import { assembleContext, type SourceFootnote } from "./context.js";
import { verifyGroundedness } from "./verify.js";
import { writeAuditLog, updateAuditLogVerification } from "./audit.js";
import { cacheKeyOf, setCachedAnswer } from "./cache.js";
import { CHOICE_MARKER_RE, isMultiQuestionPaste } from "../parsing/practiceRequestExtractor.js";
import type { Intent, RequesterContext, AnswerResponse } from "./contracts.js";
import { historyBlock, retrievalQueryFor, levelInstruction, footnoteBlock } from "./prompt.js";
import { retrievalDetail, retrievalCacheable } from "./retrievalPolicy.js";
import { failedAnswer } from "./failure.js";
import { runLookup } from "./lookup.js";

export async function runRetrieval(question: string, ctx: RequesterContext): Promise<AnswerResponse> {
  // 임베딩 장애는 hybridRetrieve 안에서 BM25로 넘어가므로 여기까지 오는 예외는 드물지만(DB·버그),
  // 와도 500 대신 안내 문구 + 감사 로그로 끝낸다.
  let retrieval: HybridRetrieveResult;
  try {
    retrieval = await hybridRetrieve(retrievalQueryFor(question, ctx.history));
  } catch (err) {
    return failedAnswer({ question, ctx, intent: "explain", err, detail: { stage: "retrieval" } });
  }
  const { primary, expanded } = retrieval;

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
    ...(ctx.imageBase64 ? { images: [normalizeImage(ctx.imageBase64, ctx.imageMime)] } : {}),
  };

  let rawAnswer: string;
  let providerUsed: ChatProviderName;
  let fallbackUsed: boolean;
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
      { temperature: 0.3, reasoningEffort: "low", tier: looksLikePastedQuestions ? "accurate" : "fast" },
    );
    rawAnswer = gen.text;
    providerUsed = gen.providerUsed;
    fallbackUsed = gen.fallbackUsed;
  } catch (err) {
    return failedAnswer({
      question,
      ctx,
      intent,
      err,
      sources,
      ontologyPath,
      detail: { stage: "generation", ...retrievalDetail(retrieval) },
    });
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
    verificationStatus: "pending",
    verificationDetail: { ...retrievalDetail(retrieval), providerUsed },
    finalAnswer,
    confidence: null,
  });

  void (async () => {
    try {
      const verification = await verifyGroundedness(contextText, question, rawAnswer, ctx.provider);
      const confidence = Number(verification.confidence.toFixed(3));
      let bgFinalAnswer = finalAnswer;
      let status: "verified" | "flagged" = "verified";
      if (!verification.grounded) {
        bgFinalAnswer += `\n\n_(이 답변의 일부 내용은 자동 사실검증에서 재확인이 필요하다고 표시되어 교사 확인 큐에 등록되었습니다.)_`;
        status = "flagged";
      }
      await updateAuditLogVerification(auditLogId, {
        verificationStatus: status,
        verificationDetail: { ...verification.detail, ...retrievalDetail(retrieval), providerUsed },
        finalAnswer: bgFinalAnswer,
        confidence,
      });
      // 1순위 공급자가 아닌 대체 공급자가 만든 답(fallbackUsed)도 캐시하지 않는다 — 캐시 키의 모델 표시와 다르다.
      if (
        status === "verified" &&
        !ctx.imageBase64 &&
        (ctx.history?.length ?? 0) === 0 &&
        retrievalCacheable(retrieval) &&
        !fallbackUsed
      ) {
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
      await updateAuditLogVerification(auditLogId, {
        verificationStatus: "flagged",
        verificationDetail: { method: "verification_unavailable" },
        finalAnswer,
        confidence: 0,
      });
    }
  })();

  return {
    question,
    intent,
    answer: finalAnswer,
    sources,
    ontologyPath,
    calcTrace: null,
    confidence: null,
    verificationStatus: "pending",
    cached: false,
    auditLogId,
    providerUsed,
  };
}

