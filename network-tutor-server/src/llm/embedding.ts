import { config, type EmbedProvider } from "../config.js";
import { LlmError, describeLlmError } from "./http.js";
import { embedWithOllama } from "./ollama.js";
import { embedWithOpenAI, openaiDefaultEmbedDimensions, openaiEmbedDimensions } from "./openai.js";

// 질문 ↔ 개념 노드 검색용 임베딩. 공급자는 EMBED_PROVIDER(openai|ollama|none)로 고르고, 비어 있으면
// 학교 공용 OpenAI 키가 있을 때 openai, 없으면 none(BM25만으로 검색)이다.
// 2026-10-14: kbu-gpuserver의 Ollama가 tailnet에서 사라져 embed가 타임아웃 → /api/ask가 전부 실패했다.
// 그래서 (1) 임베딩이 없거나 실패해도 검색은 BM25로 계속 돌고(hybridSearch.ts), (2) 모델마다 벡터를
// 따로 저장한다(concept_embeddings, PK (node_id, model)). 두 모델은 벡터 차원이 달라(bge-m3 1024,
// text-embedding-3-small 1536) 서로 비교할 수 없으므로, 검색 때는 지금 모델로 만든 벡터만 쓴다(corpus.ts).
// 공급자나 모델을 바꾸면 `npm run embed:nodes`로 개념 노드를 다시 임베딩한 뒤 서버를 재시작해야 한다.

/** 검색 질의 임베딩 입력 상한. 붙여넣은 시험 분석처럼 수천 자짜리 질문도 있는데, OpenAI는 8191토큰을
 * 넘으면 400을 내고 앞부분만으로도 주제는 충분히 잡힌다. */
export const EMBED_QUERY_MAX_CHARS = 2000;
/** 재임베딩 때 한 번에 보내는 개념 노드 수. 재임베딩 스크립트는 이 단위로 저장해서 중간에 끊겨도 이어 간다. */
export const EMBED_DOCUMENT_BATCH_SIZE = 64;
// 문서 묶음(최대 64개 × 6000자)은 질의 하나보다 훨씬 오래 걸린다 — 재임베딩 스크립트 전용 예산.
const DOCUMENT_BATCH_TIMEOUT_MS = 60_000;

export function activeEmbeddingProvider(): EmbedProvider {
  const wanted = config.embedProvider ?? (config.openaiApiKey ? "openai" : "none");
  if (wanted === "openai" && !config.openaiApiKey) return "none";
  if (wanted === "ollama" && !config.ollamaBaseUrl) return "none";
  return wanted;
}

/** concept_embeddings.model에 저장하는 식별자. 모델과 차원까지 넣어 서로 다른 벡터가 섞이지 않게 한다
 * (예: openai:text-embedding-3-small:1536). 임베딩을 쓰지 않으면 null. */
export function activeEmbeddingModelId(): string | null {
  switch (activeEmbeddingProvider()) {
    case "openai":
      return `openai:${config.openaiEmbedModel}:${openaiEmbedDimensions() ?? "default"}`;
    case "ollama":
      return `ollama:${config.ollamaEmbedModel}`;
    default:
      return null;
  }
}

/**
 * 예전 node_embeddings 테이블(노드당 벡터 1개, model 열은 모델 이름만)에서 지금 모델과 같은 벡터를
 * 찾을 때 쓰는 이름. concept_embeddings로 재임베딩하기 전까지는 여기 남은 벡터를 그대로 쓴다:
 * bge-m3 행(Ollama를 다시 켰을 때)과, 39eef2d의 embed:nodes가 기본 차원으로 덮어쓴 text-embedding-3-small
 * 행. 차원을 바꿔 쓰는 설정(OPENAI_EMBED_DIMENSIONS)이면 예전 벡터와 비교할 수 없으므로 null.
 */
export function legacyEmbeddingModelName(): string | null {
  switch (activeEmbeddingProvider()) {
    case "openai": {
      const dims = openaiEmbedDimensions();
      return dims === undefined || dims === openaiDefaultEmbedDimensions() ? config.openaiEmbedModel : null;
    }
    case "ollama":
      return config.ollamaEmbedModel;
    default:
      return null;
  }
}

interface StatusMark {
  at: string;
  message?: string;
}
let lastOk: StatusMark | null = null;
let lastErr: StatusMark | null = null;

/** /ready에 그대로 내보내는 임베딩 상태. */
export function embeddingStatus(): {
  provider: EmbedProvider;
  model: string | null;
  lastOk: StatusMark | null;
  lastErr: StatusMark | null;
} {
  return { provider: activeEmbeddingProvider(), model: activeEmbeddingModelId(), lastOk, lastErr };
}

async function embedRaw(texts: string[], opts: { signal?: AbortSignal; timeoutMs?: number }): Promise<number[][]> {
  const provider = activeEmbeddingProvider();
  // 검색 질의·노드 임베딩은 늘 학교 공용 키로만 만든다(학생 개인 키로 벡터를 만들 이유가 없다).
  if (provider === "openai") return embedWithOpenAI(texts, config.openaiApiKey!, opts);
  if (provider === "ollama") return embedWithOllama(texts, opts);
  throw new LlmError("not_configured", "none", "embeddings are disabled (EMBED_PROVIDER=none or no key)");
}

// 같은 질문(특히 수업 중 여러 학생이 같은 예시 질문을 칠 때)마다 매번 임베딩을 부르지 않도록 작은 LRU를 둔다.
const QUERY_CACHE_SIZE = 256;
const queryCache = new Map<string, number[]>();

export function clearEmbeddingStateForTests(): void {
  queryCache.clear();
  lastOk = null;
  lastErr = null;
}

/**
 * 검색 질의 하나를 임베딩한다. null은 "벡터 검색을 건너뛰라"는 뜻이다 — 임베딩을 안 쓰는 설정이거나,
 * 질의가 비었거나, 공급자가 이 입력을 거절(400)한 경우. 이런 경우는 장애가 아니므로 오류로 올리지 않는다.
 * 타임아웃·네트워크·429·5xx·401은 LlmError로 던지고, hybridSearch가 받아서 BM25만으로 이어 간다.
 */
export async function embedQuery(text: string, opts: { signal?: AbortSignal } = {}): Promise<number[] | null> {
  const modelId = activeEmbeddingModelId();
  if (!modelId) return null;
  const input = text.trim().slice(0, EMBED_QUERY_MAX_CHARS);
  if (!input) return null;

  const key = `${modelId}\u0000${input}`;
  const hit = queryCache.get(key);
  if (hit) {
    queryCache.delete(key);
    queryCache.set(key, hit);
    return hit;
  }

  try {
    const [vector] = await embedRaw([input], { signal: opts.signal });
    lastOk = { at: new Date().toISOString() };
    if (!Array.isArray(vector) || vector.length === 0) return null;
    queryCache.set(key, vector);
    if (queryCache.size > QUERY_CACHE_SIZE) queryCache.delete(queryCache.keys().next().value!);
    return vector;
  } catch (err) {
    if (err instanceof LlmError && err.kind === "aborted") throw err;
    lastErr = { at: new Date().toISOString(), message: describeLlmError(err).message };
    if (err instanceof LlmError && err.kind === "bad_request") return null;
    throw err;
  }
}

/** 개념 노드 묶음 임베딩(재임베딩 스크립트용). EMBED_DOCUMENT_BATCH_SIZE개씩 나눠 보낸다. */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_DOCUMENT_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_DOCUMENT_BATCH_SIZE);
    const vectors = await embedRaw(batch, { timeoutMs: DOCUMENT_BATCH_TIMEOUT_MS });
    if (vectors.length !== batch.length || vectors.some((v) => !Array.isArray(v) || v.length === 0)) {
      throw new Error(`embedding batch returned ${vectors.length} vectors for ${batch.length} inputs`);
    }
    out.push(...vectors);
  }
  return out;
}

/** 개념 노드 하나를 임베딩할 때 넣는 텍스트 — ingest와 재임베딩 스크립트가 같은 형식을 쓰도록 한곳에 둔다. */
export function nodeEmbedInput(row: { subject: string; topic: string; title: string; body_text: string }): string {
  return `${row.subject} > ${row.topic} > ${row.title}\n${row.body_text}`.slice(0, 6000);
}
