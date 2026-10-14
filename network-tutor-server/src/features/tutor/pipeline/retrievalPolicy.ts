import { type HybridRetrieveResult } from "../../../infrastructure/search/hybridSearch.js";

export function retrievalDetail(
	r: HybridRetrieveResult,
): Record<string, unknown> {
	return {
		retrievalMode: r.mode,
		...(r.degradedReason ? { degradedReason: r.degradedReason } : {}),
		topVectorScore:
			r.topVectorScore === null ? null : Number(r.topVectorScore.toFixed(3)),
		topBm25: r.topBm25 === null ? null : Number(r.topBm25.toFixed(3)),
	};
}

// 임베딩 모델이 설정돼 있는데 BM25만으로 찾은 답(임베딩 장애 중이거나 재임베딩 전)은 캐시하지 않는다.
// 캐시 키에는 임베딩 모델이 들어가므로(cache.ts), 여기서 캐시하면 벡터 검색이 돌아온 뒤에도 같은
// 질문마다 이 답이 계속 나간다. 임베딩을 아예 안 쓰는 설정(embeddings_disabled)은 그 자체가 정상 상태다.
export function retrievalCacheable(r: HybridRetrieveResult): boolean {
	return r.mode === "hybrid" || r.degradedReason === "embeddings_disabled";
}

/**
 * 검색이나 생성 중 예외로 답을 만들지 못했을 때의 공통 처리 — 정해진 안내 문구로 답하고, 교사 확인 큐에
 * 올라가도록 flagged 감사 로그를 남긴다. 예전에는 검색(hybridRetrieve)이 try 밖에 있어서 임베딩 장애가
 * 그대로 500으로 올라갔고, 감사 로그도 안 남아 교사는 장애를 전혀 볼 수 없었다.
 * 오류 원문은 학생에게 보내지 않는다(describeLlmError가 키·응답 본문을 걸러 요약만 남긴다).
 */
