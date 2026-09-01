import type { ConceptNode } from "./corpus.js";

// 형태소 분석기 없이 한글 텍스트를 다루기 위한 경량 토크나이저:
// 영숫자는 단어 단위로, 한글은 2-gram으로 쪼개 부분 일치를 잡아낸다.
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const alnumMatches = text.match(/[A-Za-z0-9]+/g) ?? [];
  for (const t of alnumMatches) tokens.push(t.toLowerCase());

  const hangulRuns = text.match(/[가-힣]+/g) ?? [];
  for (const run of hangulRuns) {
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i++) {
      tokens.push(run.slice(i, i + 2));
    }
  }
  return tokens;
}

interface IndexedDoc {
  nodeId: number;
  termFreq: Map<string, number>;
  length: number;
}

export class BM25Index {
  private docs: IndexedDoc[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;
  private N = 0;
  private k1 = 1.5;
  private b = 0.75;

  build(nodes: ConceptNode[]) {
    this.docs = [];
    this.df.clear();
    let totalLen = 0;
    for (const node of nodes) {
      const text = `${node.subject} ${node.category} ${node.topic} ${node.title} ${node.bodyText}`;
      const tokens = tokenize(text);
      const tf = new Map<string, number>();
      for (const tok of tokens) tf.set(tok, (tf.get(tok) ?? 0) + 1);
      for (const tok of tf.keys()) this.df.set(tok, (this.df.get(tok) ?? 0) + 1);
      this.docs.push({ nodeId: node.id, termFreq: tf, length: tokens.length });
      totalLen += tokens.length;
    }
    this.N = this.docs.length;
    this.avgLen = this.N > 0 ? totalLen / this.N : 0;
  }

  search(query: string, topK = 10): { nodeId: number; score: number }[] {
    const qTokens = Array.from(new Set(tokenize(query)));
    const scores: { nodeId: number; score: number }[] = [];
    for (const doc of this.docs) {
      let score = 0;
      for (const term of qTokens) {
        const tf = doc.termFreq.get(term);
        if (!tf) continue;
        const df = this.df.get(term) ?? 0;
        const idf = Math.log(1 + (this.N - df + 0.5) / (df + 0.5));
        const denom = tf + this.k1 * (1 - this.b + (this.b * doc.length) / (this.avgLen || 1));
        score += idf * ((tf * (this.k1 + 1)) / (denom || 1));
      }
      if (score > 0) scores.push({ nodeId: doc.nodeId, score });
    }
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }
}

export const bm25Index = new BM25Index();
