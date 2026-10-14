import { LlmError } from "../llm/http.js";
import { bm25Index } from "./textIndex.js";
import { vectorSearch, type QueryEmbedder } from "./vectorIndex.js";
import { getCorpus, getNode, getSiblings, type ConceptNode } from "./corpus.js";

export interface RetrievedNode {
	node: ConceptNode;
	rrfScore: number;
	bm25Score: number | null;
	vectorScore: number | null;
	via: "hybrid" | "graph_expansion";
}

/** hybrid: BM25 + 벡터를 RRF로 합침. bm25_only: 벡터 검색을 못 했거나 안 한 경우(임베딩 없음·장애). */
export type RetrievalMode = "hybrid" | "bm25_only";

export interface HybridRetrieveResult {
	primary: RetrievedNode[];
	expanded: RetrievedNode[];
	mode: RetrievalMode;
	/** bm25_only가 된 이유(embeddings_disabled, no_vectors_for_model, dimension_mismatch, embed_timeout,
	 * embed_auth, circuit_open 등). 감사 로그와 /ready에서 원인을 바로 보이게 남긴다. */
	degradedReason?: string;
	/** 1순위 노드의 벡터 유사도. 벡터 검색을 안 했으면 null — 모델마다 척도가 달라 임계값은 config에 둔다. */
	topVectorScore: number | null;
	/** BM25 1위 점수와, 2위 대비 1위가 앞선 비율((1위-2위)/1위). 임베딩과 무관하게 늘 채워진다. */
	topBm25: number | null;
	bm25Margin: number | null;
}

const RRF_K = 60;

function toRankMap(
	results: { nodeId: number; score: number }[],
): Map<number, number> {
	const m = new Map<number, number>();
	results.forEach((r, i) => m.set(r.nodeId, i + 1));
	return m;
}

// 임베딩 공급자가 죽었을 때 질문마다 4초(embed 예산)씩 기다리지 않도록 하는 차단기. 연속 3번 실패하면
// 60초 동안은 벡터 검색을 아예 건너뛰고 BM25만 쓴다. 60초가 지나면 다음 질문 하나로 다시 시도해 보고,
// 또 실패하면 곧바로 다시 60초를 막는다(실패 횟수는 성공해야 0으로 돌아간다).
// 2026-10-14 장애 때는 이게 없어서 모든 질문이 매번 죽은 Ollama 주소에 10초씩 붙잡혀 있었다.
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;
let consecutiveFailures = 0;
let openUntil = 0;

export function vectorBreakerStatus(): {
	open: boolean;
	consecutiveFailures: number;
	openUntil: string | null;
} {
	const open = Date.now() < openUntil;
	return {
		open,
		consecutiveFailures,
		openUntil: open ? new Date(openUntil).toISOString() : null,
	};
}

export function resetVectorBreakerForTests(): void {
	consecutiveFailures = 0;
	openUntil = 0;
}

function recordVectorFailure(): void {
	consecutiveFailures++;
	if (consecutiveFailures >= BREAKER_THRESHOLD) {
		openUntil = Date.now() + BREAKER_COOLDOWN_MS;
		if (consecutiveFailures === BREAKER_THRESHOLD) {
			console.warn(
				`[search] 임베딩이 ${BREAKER_THRESHOLD}번 연속 실패 — ${BREAKER_COOLDOWN_MS / 1000}초 동안 BM25만으로 검색합니다.`,
			);
		}
	}
}

function recordVectorSuccess(): void {
	consecutiveFailures = 0;
	openUntil = 0;
}

type VectorPart =
	| { ok: true; results: { nodeId: number; score: number }[] }
	| { ok: false; reason: string };

async function tryVectorSearch(
	query: string,
	opts: { signal?: AbortSignal; embed?: QueryEmbedder },
): Promise<VectorPart> {
	if (Date.now() < openUntil) return { ok: false, reason: "circuit_open" };
	try {
		const outcome = await vectorSearch(query, 20, opts);
		if (outcome.status === "skipped")
			return { ok: false, reason: outcome.reason };
		recordVectorSuccess();
		return { ok: true, results: outcome.results };
	} catch (err) {
		// 학생이 요청을 취소한 것은 임베딩 장애가 아니다 — 차단기에 세지 않고 그대로 올려 보낸다.
		if (err instanceof LlmError && err.kind === "aborted") throw err;
		recordVectorFailure();
		const kind = err instanceof LlmError ? err.kind : "error";
		console.warn(
			`[search] 벡터 검색 실패(${kind}) — BM25만으로 이어 갑니다: ${err instanceof Error ? err.message : String(err)}`,
		);
		return { ok: false, reason: `embed_${kind}` };
	}
}

export async function hybridRetrieve(
	query: string,
	opts: {
		topK?: number;
		expandGraph?: boolean;
		signal?: AbortSignal;
		embed?: QueryEmbedder;
	} = {},
): Promise<HybridRetrieveResult> {
	const topK = opts.topK ?? 8;
	const expandGraph = opts.expandGraph ?? true;

	const bm25Results = bm25Index.search(query, 20);
	const vector = await tryVectorSearch(query, {
		signal: opts.signal,
		embed: opts.embed,
	});
	const vecResults = vector.ok ? vector.results : [];

	const bm25Rank = toRankMap(bm25Results);
	const vecRank = toRankMap(vecResults);
	const bm25ScoreMap = new Map(bm25Results.map((r) => [r.nodeId, r.score]));
	const vecScoreMap = new Map(vecResults.map((r) => [r.nodeId, r.score]));

	const allIds = new Set<number>([...bm25Rank.keys(), ...vecRank.keys()]);
	const fused: { nodeId: number; rrf: number }[] = [];
	for (const id of allIds) {
		let rrf = 0;
		const br = bm25Rank.get(id);
		const vr = vecRank.get(id);
		if (br) rrf += 1 / (RRF_K + br);
		if (vr) rrf += 1 / (RRF_K + vr);
		fused.push({ nodeId: id, rrf });
	}
	fused.sort((a, b) => b.rrf - a.rrf);

	const primary: RetrievedNode[] = fused.slice(0, topK).flatMap((f) => {
		const node = getNode(f.nodeId);
		if (!node) return [];
		return [
			{
				node,
				rrfScore: f.rrf,
				bm25Score: bm25ScoreMap.get(f.nodeId) ?? null,
				vectorScore: vecScoreMap.get(f.nodeId) ?? null,
				via: "hybrid" as const,
			},
		];
	});

	const expanded: RetrievedNode[] = [];
	if (expandGraph && primary.length > 0) {
		const seen = new Set(primary.map((p) => p.node.id));
		const top = primary[0].node;
		for (const sib of getSiblings(top, seen, 2)) {
			seen.add(sib.id);
			expanded.push({
				node: sib,
				rrfScore: 0,
				bm25Score: null,
				vectorScore: null,
				via: "graph_expansion",
			});
		}
	}

	const top1 = bm25Results[0]?.score ?? null;
	const top2 = bm25Results[1]?.score ?? 0;
	return {
		primary,
		expanded,
		mode: vector.ok ? "hybrid" : "bm25_only",
		...(vector.ok ? {} : { degradedReason: vector.reason }),
		// 예전 topScore와 같은 뜻(1순위 노드의 벡터 유사도). 1순위가 BM25로만 걸렸으면 0으로 본다.
		topVectorScore: vector.ok
			? primary.length > 0
				? Math.max(primary[0].vectorScore ?? 0, 0)
				: 0
			: null,
		topBm25: top1,
		bm25Margin: top1 && top1 > 0 ? (top1 - top2) / top1 : null,
	};
}

export function corpusSize(): number {
	return getCorpus().length;
}
