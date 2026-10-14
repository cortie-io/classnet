import { describeLlmError } from "../../../infrastructure/llm/http.js";
import { generateChat } from "../../../infrastructure/llm/provider.js";
import { type ChatProviderName } from "../../../infrastructure/llm/types.js";
import { extractCalcRequest } from "../parsing/calcExtractor.js";
import { verifyCalcAnswer } from "./verify.js";
import { writeAuditLog } from "./audit.js";
import { cacheKeyOf, setCachedAnswer } from "./cache.js";
import type {
	VerificationStatus,
	RequesterContext,
	AnswerResponse,
} from "./contracts.js";
import { historyBlock, levelInstruction } from "./prompt.js";

export async function runCalc(
	question: string,
	ctx: RequesterContext,
): Promise<AnswerResponse> {
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
		.join(
			"\n",
		)}${historyBlock(ctx.history)}\n\n학생 질문: ${question}\n\n위 계산 결과를 바탕으로 학생에게 설명하는 답변을 작성하세요.`;

	let rawAnswer: string;
	let verification;
	let providerUsed: ChatProviderName | null = null;
	// 규칙엔진 결과만 보여 주는 대체 답(rule_only)이 LLM 장애 때문인지 — 그런 답은 캐시하지 않는다.
	let llmFailed = false;
	try {
		// 계산 문제 해설 — 정확도가 중요한 "문제 해설"류라 상위 모델(accurate)을 쓴다(2026-08-18 결정).
		const gen = await generateChat(
			[
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
			ctx.provider,
			{ temperature: 0.2, tier: "accurate" },
		);
		rawAnswer = gen.text;
		providerUsed = gen.providerUsed;
		verification = verifyCalcAnswer(result, rawAnswer);
	} catch (err) {
		rawAnswer = "";
		llmFailed = true;
		verification = {
			grounded: false,
			confidence: 0,
			detail: { error: describeLlmError(err) },
		};
	}

	const stepsText = result.steps
		.map((s) => `**${s.label}**\n${s.detail}`)
		.join("\n\n");
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

	// LLM 장애로 나간 대체 답은 캐시하지 않는다 — 예전에는 장애 중에 나간 "결과 요약만" 답이 같은 질문마다
	// 영구히 다시 나갔다(캐시에 만료가 없다).
	if ((ctx.history?.length ?? 0) === 0 && !llmFailed) {
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
