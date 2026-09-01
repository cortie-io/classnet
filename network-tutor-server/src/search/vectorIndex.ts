import { embed } from "../llm/ollama.js";
import { getCorpus } from "./corpus.js";

function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function vectorSearch(query: string, topK = 10): Promise<{ nodeId: number; score: number }[]> {
  const queryVec = await embed(query);
  const corpus = getCorpus();
  const scores = corpus
    .filter((n) => n.embedding.length > 0)
    .map((n) => ({ nodeId: n.id, score: cosineSim(queryVec, n.embedding) }))
    .sort((a, b) => b.score - a.score);
  return scores.slice(0, topK);
}
