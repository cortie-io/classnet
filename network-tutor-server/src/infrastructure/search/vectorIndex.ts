import { embedQuery } from "../llm/embedding.js";
import { corpusEmbeddingInfo, getCorpus } from "./corpus.js";

// 차원이 같다는 전제에서만 부른다(vectorSearch가 먼저 확인). 예전에는 Math.min(a.length, b.length)까지만
// 비교해서, 1536차원 질의와 1024차원 bge-m3 벡터를 비교해도 오류 없이 엉터리 점수가 나왔다.
function cosineSim(a: number[], b: number[]): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	if (normA === 0 || normB === 0) return 0;
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export type QueryEmbedder = (
	text: string,
	signal?: AbortSignal,
) => Promise<number[] | null>;

/** 벡터 검색을 하지 않은(=BM25만으로 검색해야 하는) 이유. 장애가 아니라 상태다 — 실제 장애(타임아웃 등)는 throw. */
export type VectorSkipReason =
	| "embeddings_disabled"
	| "no_vectors_for_model"
	| "empty_or_rejected_query"
	| "dimension_mismatch";

export type VectorSearchOutcome =
	| { status: "ok"; results: { nodeId: number; score: number }[] }
	| { status: "skipped"; reason: VectorSkipReason };

export async function vectorSearch(
	query: string,
	topK = 10,
	opts: { signal?: AbortSignal; embed?: QueryEmbedder } = {},
): Promise<VectorSearchOutcome> {
	const info = corpusEmbeddingInfo();
	if (!info.modelId)
		return { status: "skipped", reason: "embeddings_disabled" };
	// 재임베딩 전(지금 모델로 만든 벡터가 하나도 없음)에는 질의를 임베딩해 봐야 비교할 대상이 없다.
	if (info.vectorsLoaded === 0 || !info.dims)
		return { status: "skipped", reason: "no_vectors_for_model" };

	const embed =
		opts.embed ??
		((text: string, signal?: AbortSignal) => embedQuery(text, { signal }));
	const queryVec = await embed(query, opts.signal);
	if (!queryVec || queryVec.length === 0)
		return { status: "skipped", reason: "empty_or_rejected_query" };
	if (queryVec.length !== info.dims) {
		console.warn(
			`[vector] 질의 벡터 ${queryVec.length}차원 ≠ corpus ${info.dims}차원 — 재임베딩이 필요합니다(npm run reembed).`,
		);
		return { status: "skipped", reason: "dimension_mismatch" };
	}

	const scores = getCorpus()
		.filter((n) => n.embedding.length === queryVec.length)
		.map((n) => ({ nodeId: n.id, score: cosineSim(queryVec, n.embedding) }))
		.sort((a, b) => b.score - a.score);
	return { status: "ok", results: scores.slice(0, topK) };
}
