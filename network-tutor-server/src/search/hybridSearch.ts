import { bm25Index } from "./textIndex.js";
import { vectorSearch } from "./vectorIndex.js";
import { getCorpus, getNode, getSiblings, type ConceptNode } from "./corpus.js";

export interface RetrievedNode {
  node: ConceptNode;
  rrfScore: number;
  bm25Score: number | null;
  vectorScore: number | null;
  via: "hybrid" | "graph_expansion";
}

const RRF_K = 60;

function toRankMap(results: { nodeId: number; score: number }[]): Map<number, number> {
  const m = new Map<number, number>();
  results.forEach((r, i) => m.set(r.nodeId, i + 1));
  return m;
}

export async function hybridRetrieve(
  query: string,
  opts: { topK?: number; expandGraph?: boolean } = {},
): Promise<{ primary: RetrievedNode[]; expanded: RetrievedNode[]; topScore: number }> {
  const topK = opts.topK ?? 8;
  const expandGraph = opts.expandGraph ?? true;

  const bm25Results = bm25Index.search(query, 20);
  const vecResults = await vectorSearch(query, 20);

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
      expanded.push({ node: sib, rrfScore: 0, bm25Score: null, vectorScore: null, via: "graph_expansion" });
    }
  }

  const topScore = primary.length > 0 ? Math.max(primary[0].vectorScore ?? 0, 0) : 0;
  return { primary, expanded, topScore };
}

export function corpusSize(): number {
  return getCorpus().length;
}
