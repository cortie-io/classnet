import { config } from "../config.js";
import { embed as embedOllama } from "./ollama.js";

// 질문 ↔ 개념 노드 검색용 임베딩. 학교 공용 OpenAI 키가 있으면 OpenAI, 없으면 자체 호스팅 bge-m3(Ollama).
// 2026-10-14: kbu-gpuserver의 Ollama가 tailnet에서 사라져 embed가 타임아웃 → /api/ask가 전부 실패했고,
// 그래서 OpenAI를 기본으로 바꿨다. 두 모델은 벡터 차원이 달라(bge-m3 1024, text-embedding-3-small 1536)
// 서로 비교할 수 없으므로, node_embeddings.model에 만든 모델을 남기고 검색 때는 지금 모델로 만든
// 벡터만 쓴다(corpus.ts). 공급자를 바꾸면 `npm run embed:nodes`로 개념 노드를 다시 임베딩해야 한다.
const OPENAI_EMBED_MODEL = "text-embedding-3-small";

export const embedModelId = config.openaiApiKey ? OPENAI_EMBED_MODEL : config.ollamaEmbedModel;

export async function embed(text: string): Promise<number[]> {
  if (!config.openaiApiKey) return embedOllama(text);
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.openaiApiKey}` },
    body: JSON.stringify({ model: OPENAI_EMBED_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`openai embed failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data[0].embedding;
}

/** 개념 노드 하나를 임베딩할 때 넣는 텍스트 — ingest와 재임베딩 스크립트가 같은 형식을 쓰도록 한곳에 둔다. */
export function nodeEmbedInput(row: { subject: string; topic: string; title: string; body_text: string }): string {
  return `${row.subject} > ${row.topic} > ${row.title}\n${row.body_text}`.slice(0, 6000);
}
