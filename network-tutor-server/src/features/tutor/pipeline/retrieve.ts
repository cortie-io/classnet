import { describeLlmError } from "../../../infrastructure/llm/http.js";
import { generateChat } from "../../../infrastructure/llm/provider.js";
import {
	normalizeImage,
	type ChatMessage,
	type ChatProviderName,
} from "../../../infrastructure/llm/types.js";
import {
	hybridRetrieve,
	type HybridRetrieveResult,
} from "../../../infrastructure/search/hybridSearch.js";
import { scanForLookupHit } from "../../../infrastructure/search/lookupSearch.js";
import { getNode } from "../../../infrastructure/search/corpus.js";
import { assembleContext, type SourceFootnote } from "./context.js";
import { verifyGroundedness } from "./verify.js";
import { writeAuditLog, updateAuditLogVerification } from "./audit.js";
import { cacheKeyOf, setCachedAnswer } from "./cache.js";
import { confidentTopic } from "./topicGate.js";
import {
	CHOICE_MARKER_RE,
	isMultiQuestionPaste,
} from "../parsing/practiceRequestExtractor.js";
import type { Intent, RequesterContext, AnswerResponse } from "./contracts.js";
import {
	historyBlock,
	retrievalQueryFor,
	levelInstruction,
	footnoteBlock,
} from "./prompt.js";
import { retrievalDetail, retrievalCacheable } from "./retrievalPolicy.js";
import { failedAnswer } from "./failure.js";

const MAX_CONTEXT_NODES = 4;
const VECTOR_SCORE_WINDOW = 0.15;
// BM25 점수가 1위의 이 비율도 안 되는 노드는 질문 단어 한두 개가 우연히 겹친 것뿐이다(실측: "포트 443"
// 질문에 "번호"·"서비스" 같은 말 때문에 RAID 노드가 끼었다).
const BM25_RELATIVE_FLOOR = 0.35;

function selectContextNodes(
	r: HybridRetrieveResult,
): HybridRetrieveResult["primary"] {
	const bestBm25 = Math.max(0, ...r.primary.map((p) => p.bm25Score ?? 0));
	const bm25Ok = (p: HybridRetrieveResult["primary"][number]) =>
		bestBm25 === 0 || (p.bm25Score ?? 0) >= bestBm25 * BM25_RELATIVE_FLOOR;
	if (r.mode !== "hybrid")
		return r.primary.filter((p, i) => i === 0 || bm25Ok(p)).slice(0, 3);
	const bestVector = Math.max(0, ...r.primary.map((p) => p.vectorScore ?? 0));
	return r.primary
		.filter(
			(p, i) =>
				i === 0 ||
				(p.vectorScore !== null
					? p.vectorScore >= bestVector - VECTOR_SCORE_WINDOW
					: bm25Ok(p)),
		)
		.slice(0, MAX_CONTEXT_NODES);
}

function explainSystemPrompt(
	ctx: RequesterContext,
	opts: { pastedProblem: boolean },
): string {
	return [
		"당신은 'classnet'의 네트워크관리사 2급 필기시험 대비 AI 튜터입니다. 실제 학교에서 학생들이 매일 쓰는 서비스이므로 어떤 질문이 와도 회피하지 말고 바로 도움이 되는 답을 주세요.",
		"",
		"[답변 방식]",
		"- 첫 문장에서 질문의 핵심 답을 바로 말하세요(두괄식). 질문을 되풀이하거나 인사말로 시작하지 마세요.",
		"- 이어서 이해에 필요한 설명을 짧은 단락이나 목록으로 정리하세요. 둘 이상을 비교하는 질문이면 마크다운 표로 정리하세요.",
		"- 시험에 자주 나오는 포인트나 헷갈리기 쉬운 함정이 있으면 마지막에 '**시험 포인트**'로 1~3줄 덧붙이세요.",
		...(opts.pastedProblem
			? [
					"- 학생이 붙여넣은 문제를 해설할 때는 먼저 '정답: ②'처럼 정답을 밝히고, 각 보기가 왜 맞고 틀린지 짧게 짚으세요. 여러 문제면 번호별로 나눠 쓰세요.",
				]
			: []),
		"",
		"[근거 원칙]",
		"- [컨텍스트]에 관련 내용이 있으면 그것을 우선 근거로 삼으세요. [정확한 표 데이터]가 있으면 그 값은 절대 바꾸지 말고 그대로 인용하세요.",
		"- [컨텍스트]에 없는 내용이라도 시험 범위의 사실이라면 배경지식으로 답하되, 그 부분 끝에 '[AI 배경지식]'이라고 표시하세요. 확신이 없는 수치나 사실은 단정하지 말고 '정확한 확인이 필요합니다'라고 솔직히 밝히세요.",
		"- 자료나 표에 없다는 이유로 답을 거절하지 마세요. '제공된 자료에는 없습니다' 같은 말로 답을 끝내는 것은 실패입니다.",
		"",
		"[그 밖에]",
		"- 보기와 정답이 달린 연습 문제를 직접 지어내지 마세요(검증되지 않은 문제는 틀린 정보를 퍼뜨릴 수 있습니다). 학생이 문제를 원하면 '관련 문제 내줘'라고 말하면 문제은행의 실제 기출 문제를 찾아 준다고 안내하세요.",
		"- 인사·감사·시험 후기처럼 학습 질문이 아닌 말에는 짧고 따뜻하게 반응하세요.",
		...(ctx.imageBase64
			? [
					"- 학생이 문제 사진을 첨부했습니다. 반드시 첨부된 이미지를 직접 확인하고 그 안의 문제·보기·그림 내용을 근거로 답하세요. 이미지를 확인하지 않고 '사진이 첨부되지 않았다'거나 '이미지를 볼 수 없다'고 답하지 마세요 — 이미지는 항상 함께 전달됩니다.",
				]
			: []),
		"",
		levelInstruction(ctx.level) + (ctx.weakAreaNote ?? ""),
	].join("\n");
}

export async function runRetrieval(
	question: string,
	ctx: RequesterContext,
): Promise<AnswerResponse> {
	// 붙여넣은 문제 묶음(①②③④ 보기, 긴 합성 메시지)은 조회형 지름길을 타면 안 된다 — IP·프리픽스 숫자가
	// 무관한 표 행에 우연히 걸려 요청 전체가 표 한 줄짜리 답으로 축소되던 사례들(isMultiQuestionPaste 주석).
	const looksLikePastedQuestions =
		CHOICE_MARKER_RE.test(question) || isMultiQuestionPaste(question);

	// 검색어: 이번 메시지에 자기 주제가 있으면 그 메시지만으로 찾는다. 없을 때("왜 그런데?", "30 맞아?")만
	// 직전 대화를 섞는다 — 대화 앞쪽 주제가 새 질문을 누르거나, 거꾸로 꼬리질문이 엉뚱한 개념을 끌어오지 않게.
	// 임베딩 장애는 hybridRetrieve 안에서 BM25로 넘어가므로 여기까지 오는 예외는 드물지만(DB·버그), 와도 500
	// 대신 안내 문구 + 감사 로그로 끝낸다.
	let retrieval: HybridRetrieveResult;
	let ownTopic: ReturnType<typeof confidentTopic>;
	let topicIsConfident: boolean;
	try {
		const own = await hybridRetrieve(question);
		ownTopic = confidentTopic(own, question);
		if (ownTopic.node || !ctx.history?.length) {
			retrieval = own;
			topicIsConfident = ownTopic.node !== null;
		} else {
			const blendedQuery = retrievalQueryFor(question, ctx.history);
			retrieval = await hybridRetrieve(blendedQuery);
			topicIsConfident = confidentTopic(retrieval, blendedQuery).node !== null;
		}
	} catch (err) {
		return failedAnswer({
			question,
			ctx,
			intent: "explain",
			err,
			detail: { stage: "retrieval" },
		});
	}

	// 조회형: 질문이 자기 주제를 갖고 있고 표의 특정 행(포트 번호·규격 코드 등)을 정확히 가리킬 때만, 그 행을
	// [정확한 표 데이터]로 컨텍스트 맨 앞에 둔다. 예전에는 이 경우 "표 값만 써라, 표에 없으면 추측하지 마라"는
	// 별도 경로로 보내서 "2진수를 10진수로 변환하려면?", "chmod 755랑 644 차이"에도 "제공된 표에는 없어서 답변할
	// 수 없습니다"로 끝나는 답이 실제로 나갔다 — 이제는 표 값은 그대로 인용하되 답 자체는 일반 설명으로 쓴다.
	const lookupHit =
		!looksLikePastedQuestions && ownTopic.node
			? await scanForLookupHit(
					retrieval.primary.slice(0, MAX_CONTEXT_NODES).map((p) => p.node.id),
					question,
				)
			: null;
	const trustedFacts = lookupHit
		? lookupHit.matchedRows
				.map(
					(r) =>
						`- ${Object.entries(r.rowData)
							.map(([k, v]) => `${k}: ${v}`)
							.join(", ")}`,
				)
				.join("\n")
		: "";
	const intent: Intent = lookupHit ? "lookup" : "explain";

	const contextNodes = selectContextNodes(retrieval);
	const assembled =
		contextNodes.length > 0
			? await assembleContext(
					contextNodes,
					topicIsConfident ? retrieval.expanded : [],
				)
			: {
					contextText: "",
					sources: [] as SourceFootnote[],
					ontologyPath: [] as string[],
				};
	// 주제를 확신할 수 없는 질문(인사·잡담·참고 자료 밖 주제)에는 무관한 개념이 출처로 붙지 않게 한다.
	const sources = topicIsConfident
		? assembled.sources.filter((s) => s.via === "hybrid")
		: [];
	const ontologyPath = topicIsConfident ? assembled.ontologyPath : [];
	const contextBody = assembled.contextText
		? topicIsConfident
			? assembled.contextText
			: `(아래 참고 자료는 질문과 관련성이 낮을 수 있습니다. 무관하면 무시하고 배경지식으로 답하세요.)\n\n${assembled.contextText}`
		: "(참고 자료에서 관련 개념을 찾지 못했습니다. 배경지식으로 답하세요.)";
	const contextText = trustedFacts
		? `[정확한 표 데이터: ${lookupHit!.tableName} — 이 값은 바꾸지 말고 그대로 인용]\n${trustedFacts}\n\n${contextBody}`
		: contextBody;

	const userMessage: ChatMessage = {
		role: "user",
		content: `[컨텍스트]\n${contextText}${historyBlock(ctx.history)}\n\n[학생 질문]\n${question}`,
		...(ctx.imageBase64
			? { images: [normalizeImage(ctx.imageBase64, ctx.imageMime)] }
			: {}),
	};

	let rawAnswer: string;
	let providerUsed: ChatProviderName;
	let fallbackUsed: boolean;
	try {
		// 학생이 실제 문제 지문을 붙여넣고 설명을 구하는 "문제 해설"(looksLikePastedQuestions)과 사진 문제만
		// 상위 모델을 쓰고, 일반 개념 질문은 기본 모델로 충분하다고 보고 비용을 아낀다(2026-08-18 결정).
		// reasoningEffort: "low" — 실측 결과 응답 시간의 대부분(전체 7~10초 중 6.7~7.9초)이 검색이 아니라
		// 생성 자체에 걸렸고, low로도 어려운 비교 질문(RIP vs OSPF 표 정리)의 품질은 유지됐다.
		const gen = await generateChat(
			[
				{
					role: "system",
					content: explainSystemPrompt(ctx, {
						pastedProblem: looksLikePastedQuestions,
					}),
				},
				userMessage,
			],
			ctx.provider,
			{
				temperature: 0.3,
				reasoningEffort: "low",
				tier: looksLikePastedQuestions || ctx.imageBase64 ? "accurate" : "fast",
			},
		);
		rawAnswer = gen.text;
		providerUsed = gen.providerUsed;
		fallbackUsed = gen.fallbackUsed;
	} catch (err) {
		// 표 행을 정확히 찾은 조회형 질문이면, LLM이 죽어도 그 행을 그대로 보여 주는 편이 안내 문구보다 낫다.
		if (lookupHit) {
			const lookupNode = getNode(lookupHit.nodeId);
			const lookupSources: SourceFootnote[] = lookupNode
				? [
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
					]
				: [];
			const finalAnswer = `${trustedFacts}${footnoteBlock(lookupSources, ontologyPath)}`;
			const auditLogId = await writeAuditLog({
				userId: ctx.userId,
				question,
				intent: "lookup",
				retrievedNodeIds: [lookupHit.nodeId],
				ruleEngineTrace: {
					tableName: lookupHit.tableName,
					matchedRows: lookupHit.matchedRows,
				},
				llmRawAnswer: null,
				verificationStatus: "rule_only",
				verificationDetail: {
					error: describeLlmError(err),
					...retrievalDetail(retrieval),
				},
				finalAnswer,
				confidence: 1,
			});
			return {
				question,
				intent: "lookup",
				answer: finalAnswer,
				sources: lookupSources,
				ontologyPath,
				calcTrace: null,
				confidence: 1,
				verificationStatus: "rule_only",
				cached: false,
				auditLogId,
				providerUsed: null,
			};
		}
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
	// 검증(verifyGroundedness, 실측 ~2-4초)은 답변 내용을 바꾸지 않고 "이상 없음/재확인 필요" 표시만 나중에
	// audit_log에 남기는 용도이므로, 학생에게는 생성이 끝나는 즉시 응답하고 검증은 백그라운드에서 이어 간다.
	const finalAnswer = `${rawAnswer}${footnoteBlock(sources, ontologyPath)}`;
	const baseDetail = {
		...retrievalDetail(retrieval),
		providerUsed,
		topicConfident: topicIsConfident,
		contextNodeIds: contextNodes.map((n) => n.node.id),
		...(lookupHit ? { lookupTable: lookupHit.tableName } : {}),
	};
	const auditLogId = await writeAuditLog({
		userId: ctx.userId,
		question,
		intent,
		retrievedNodeIds: contextNodes.map((n) => n.node.id),
		ruleEngineTrace: lookupHit
			? { tableName: lookupHit.tableName, matchedRows: lookupHit.matchedRows }
			: null,
		llmRawAnswer: rawAnswer,
		verificationStatus: "verified",
		verificationDetail: baseDetail,
		finalAnswer,
		confidence: 1,
	});

	void (async () => {
		try {
			const verification = await verifyGroundedness(
				contextText,
				question,
				rawAnswer,
				ctx.provider,
			);
			const confidence = Number(verification.confidence.toFixed(3));
			let bgFinalAnswer = finalAnswer;
			let status: "verified" | "flagged" = "verified";
			if (!verification.grounded) {
				bgFinalAnswer += `\n\n_(이 답변의 일부 내용은 자동 사실검증에서 재확인이 필요하다고 표시되어 교사 확인 큐에 등록되었습니다.)_`;
				status = "flagged";
			}
			await updateAuditLogVerification(auditLogId, {
				verificationStatus: status,
				verificationDetail: { ...verification.detail, ...baseDetail },
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
			// 백그라운드 검증 실패는 조용히 무시한다 — 학생에게는 이미 응답이 나갔고, audit_log는 낙관적
			// "verified" 상태로 남는다(최악의 경우 드물게 재확인이 필요한 답변이 교사 검수 큐에 안 뜰 수 있다).
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
