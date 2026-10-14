import { pool } from "../db/pool.js";
import {
	activeEmbeddingModelId,
	legacyEmbeddingModelName,
} from "../llm/embedding.js";

export interface ConceptNode {
	id: number;
	subject: string;
	category: string;
	topic: string;
	tagPath: string;
	sectionNo: string;
	title: string;
	bodyMd: string;
	bodyText: string;
	orderIndex: number;
	embedding: number[];
}

let corpus: ConceptNode[] = [];
let byId = new Map<number, ConceptNode>();

export interface CorpusEmbeddingInfo {
	/** 이 corpus의 벡터를 만든 모델(activeEmbeddingModelId) — 임베딩을 안 쓰면 null */
	modelId: string | null;
	/** 벡터가 있는 노드 수. 0이면 검색은 BM25만으로 돈다. */
	vectorsLoaded: number;
	dims: number | null;
}
let embeddingInfo: CorpusEmbeddingInfo = {
	modelId: null,
	vectorsLoaded: 0,
	dims: null,
};

type CorpusRow = {
	id: number;
	subject: string;
	category: string;
	topic: string;
	tag_path: string;
	section_no: string;
	title: string;
	body_md: string;
	body_text: string;
	order_index: number;
	embedding: number[] | null;
};

const NODE_COLUMNS = `n.id, n.subject, n.category, n.topic, n.tag_path, n.section_no, n.title,
            n.body_md, n.body_text, n.order_index`;

async function fetchCorpusRows(
	modelId: string | null,
	legacyModel: string | null,
): Promise<CorpusRow[]> {
	if (!modelId) {
		const { rows } = await pool.query<CorpusRow>(
			`SELECT ${NODE_COLUMNS}, NULL::jsonb AS embedding FROM concept_nodes n ORDER BY n.order_index`,
		);
		return rows;
	}
	try {
		// 지금 임베딩 모델로 만든 벡터만 쓴다(차원이 다른 모델 벡터와 섞이면 코사인 유사도가 엉터리가 됨).
		// concept_embeddings(모델별 저장)가 우선이고, 재임베딩 전에는 예전 node_embeddings에 같은 모델로
		// 남아 있는 벡터를 쓴다.
		const { rows } = await pool.query<CorpusRow>(
			`SELECT ${NODE_COLUMNS}, COALESCE(ce.embedding, ne.embedding) AS embedding
       FROM concept_nodes n
       LEFT JOIN concept_embeddings ce ON ce.node_id = n.id AND ce.model = $1
       LEFT JOIN node_embeddings ne ON ne.node_id = n.id AND ne.model = $2
       ORDER BY n.order_index`,
			[modelId, legacyModel],
		);
		return rows;
	} catch (err) {
		// 새 코드가 마이그레이션(npm run migrate)보다 먼저 배포돼도 서버는 떠야 한다 — 그동안은 예전 테이블만 본다.
		if ((err as { code?: string }).code !== "42P01") throw err;
		console.warn(
			"[corpus] concept_embeddings 테이블이 아직 없습니다(npm run migrate 전) — node_embeddings만 읽습니다.",
		);
		const { rows } = await pool.query<CorpusRow>(
			`SELECT ${NODE_COLUMNS}, ne.embedding AS embedding
       FROM concept_nodes n
       LEFT JOIN node_embeddings ne ON ne.node_id = n.id AND ne.model = $1
       ORDER BY n.order_index`,
			[legacyModel],
		);
		return rows;
	}
}

export async function loadCorpus(): Promise<void> {
	const modelId = activeEmbeddingModelId();
	const rows = await fetchCorpusRows(modelId, legacyEmbeddingModelName());
	replaceCorpus(
		rows.map((r) => ({
			id: r.id,
			subject: r.subject,
			category: r.category,
			topic: r.topic,
			tagPath: r.tag_path,
			sectionNo: r.section_no,
			title: r.title,
			bodyMd: r.body_md,
			bodyText: r.body_text,
			orderIndex: r.order_index,
			embedding: Array.isArray(r.embedding) ? r.embedding : [],
		})),
		modelId,
	);
	console.log(
		`[corpus] loaded ${corpus.length} concept nodes into memory ` +
			`(vectors: ${embeddingInfo.vectorsLoaded}${embeddingInfo.dims ? `×${embeddingInfo.dims}` : ""}, model: ${modelId ?? "none"})`,
	);
}

/** corpus를 통째로 바꾼다(loadCorpus와 테스트가 쓴다). 벡터는 가장 많은 노드가 가진 차원 하나로만
 * 맞춘다 — 차원이 다른 벡터가 섞여 있으면(부분 재임베딩 등) 그 노드는 벡터 없이 BM25로만 찾힌다. */
export function replaceCorpus(
	nodes: ConceptNode[],
	modelId: string | null,
): void {
	const dimCounts = new Map<number, number>();
	for (const n of nodes)
		if (n.embedding.length > 0)
			dimCounts.set(
				n.embedding.length,
				(dimCounts.get(n.embedding.length) ?? 0) + 1,
			);
	const dims =
		[...dimCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
	let dropped = 0;
	corpus = nodes.map((n) => {
		if (n.embedding.length > 0 && n.embedding.length !== dims) {
			dropped++;
			return { ...n, embedding: [] };
		}
		return n;
	});
	if (dropped > 0)
		console.warn(
			`[corpus] 차원이 다른 벡터 ${dropped}개를 제외했습니다(기준 ${dims}차원).`,
		);
	byId = new Map(corpus.map((n) => [n.id, n]));
	embeddingInfo = {
		modelId,
		vectorsLoaded: corpus.filter((n) => n.embedding.length > 0).length,
		dims,
	};
}

export function corpusEmbeddingInfo(): CorpusEmbeddingInfo {
	return embeddingInfo;
}

export function getCorpus(): ConceptNode[] {
	return corpus;
}

export function getNode(id: number): ConceptNode | undefined {
	return byId.get(id);
}

export function getSiblings(
	node: ConceptNode,
	excludeIds: Set<number>,
	limit = 2,
): ConceptNode[] {
	return corpus
		.filter(
			(n) =>
				n.id !== node.id &&
				n.subject === node.subject &&
				n.category === node.category &&
				!excludeIds.has(n.id),
		)
		.slice(0, limit);
}
