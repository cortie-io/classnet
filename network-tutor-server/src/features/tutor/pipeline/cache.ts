import { createHash } from "node:crypto";
import { pool } from "../../../infrastructure/db/pool.js";
import { activeEmbeddingModelId } from "../../../infrastructure/llm/embedding.js";
import { chatModelSignature } from "../../../infrastructure/llm/provider.js";

export function normalizeQuestion(question: string): string {
	return question.trim().toLowerCase().replace(/\s+/g, " ");
}

// 프롬프트·답변 흐름을 바꿀 때마다 올리는 값. 캐시 키에 들어가므로 올리기만 하면 예전 답변은 더 이상
// 안 쓰인다(행을 지우지 않고 은퇴시킨다). 2026-10-14: Ollama(Gemma) → OpenAI 전환, 그리고 장애 중에
// 만들어진 답변(검색 실패·LLM 실패 대체문)을 한꺼번에 은퇴시키려고 처음 넣었다.
export const PIPELINE_VERSION = "2026-10-14.1";

/** 답을 만든 쪽(파이프라인 버전 + 생성 모델 + 검색 임베딩 모델). 하나라도 바뀌면 캐시 키가 달라진다. */
export function answerSourceSignature(): string {
	return `${PIPELINE_VERSION}|${chatModelSignature()}|${activeEmbeddingModelId() ?? "embed:none"}`;
}

// 답변이 학생 수준(level)·취약 영역(personalizationTag)별로 달라지므로 캐시 키에 함께 포함한다 —
// 같은 질문이라도 서로 다른 학생에게는 다른 설명이 나가야 하고, 캐시가 그걸 뒤섞으면 안 된다.
// 답을 만든 모델·버전도 넣는다: 예전에는 키에 이게 없어서 Gemma 시절 답이나 장애 중 대체문이
// 공급자를 바꾼 뒤에도 같은 질문마다 계속 나갔다.
export function cacheKeyOf(
	question: string,
	level: string,
	personalizationTag = "",
): string {
	return createHash("sha256")
		.update(
			`${normalizeQuestion(question)}::${level}::${personalizationTag}::${answerSourceSignature()}`,
		)
		.digest("hex");
}

export interface CachedAnswer {
	question: string;
	intent: string;
	finalAnswer: string;
	sourceNodeIds: number[];
	confidence: number | null;
}

export async function getCachedAnswer(
	key: string,
): Promise<CachedAnswer | null> {
	const { rows } = await pool.query(
		`SELECT question, intent, final_answer, source_node_ids, confidence FROM answer_cache WHERE cache_key = $1`,
		[key],
	);
	if (rows.length === 0) return null;
	await pool.query(
		`UPDATE answer_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = $1`,
		[key],
	);
	const r = rows[0];
	return {
		question: r.question,
		intent: r.intent,
		finalAnswer: r.final_answer,
		sourceNodeIds: r.source_node_ids ?? [],
		confidence: r.confidence !== null ? Number(r.confidence) : null,
	};
}

export async function setCachedAnswer(params: {
	key: string;
	question: string;
	intent: string;
	finalAnswer: string;
	sourceNodeIds: number[];
	confidence: number | null;
}): Promise<void> {
	await pool.query(
		`INSERT INTO answer_cache (cache_key, question, intent, final_answer, source_node_ids, confidence)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (cache_key) DO UPDATE SET
       final_answer = EXCLUDED.final_answer, confidence = EXCLUDED.confidence, last_hit_at = now()`,
		[
			params.key,
			params.question,
			params.intent,
			params.finalAnswer,
			params.sourceNodeIds,
			params.confidence,
		],
	);
}
