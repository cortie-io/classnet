import { assessChatHealth, chatHealth } from "../llm/providerHealth.js";
import type { RequestHandler } from "express";
import { pool } from "../db/pool.js";
import { embeddingStatus } from "../llm/embedding.js";
import { chatModelSignature, chatProvidersConfigured } from "../llm/provider.js";
import { corpusEmbeddingInfo, getCorpus } from "../search/corpus.js";
import { vectorBreakerStatus, type RetrievalMode } from "../search/hybridSearch.js";

// /health는 "프로세스가 떠 있다"만 본다(liveness). /ready는 실제로 답을 만들 수 있는지를 본다.
// 2026-10-14 장애 때는 /health가 계속 ok였는데 /api/ask는 전부 실패하고 있었다 — 임베딩이 죽어도
// 그걸 알려주는 곳이 없었다. 503은 DB가 안 되거나 답을 만들 공급자가 하나도 없을 때만 낸다.
// 임베딩이 없거나 죽은 것은 BM25만으로 계속 답할 수 있으므로 200에 status "degraded"로 알린다.

const DB_TIMEOUT_MS = 2_000;

async function checkDb(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "TIMEOUT" })), DB_TIMEOUT_MS);
      }),
    ]);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    // 연결 문자열·호스트가 섞일 수 있는 원문 대신 오류 코드만 내보내고, 원문은 서버 로그에 남긴다.
    console.warn("[ready] DB 확인 실패:", err);
    const code = (err as { code?: string }).code;
    return { ok: false, error: code ?? "error" };
  } finally {
    clearTimeout(timer);
  }
}

/** 지금 질문이 들어오면 어떤 검색으로 답하게 되는지 — 임베딩 모델의 벡터가 메모리에 있고 차단기가 닫혀 있어야 hybrid. */
export function currentRetrievalMode(): RetrievalMode {
  const model = embeddingStatus().model;
  const info = corpusEmbeddingInfo();
  if (!model || info.modelId !== model || info.vectorsLoaded === 0) return "bm25_only";
  return vectorBreakerStatus().open ? "bm25_only" : "hybrid";
}

export const readyHandler: RequestHandler = async (_req, res) => {
  const db = await checkDb();
  const chatProviders = chatProvidersConfigured();
  const embeddings = embeddingStatus();
  const info = corpusEmbeddingInfo();
  const retrieval = currentRetrievalMode();
  const states = chatHealth(chatProviders);
  const availability = assessChatHealth(states);
  const ready = db.ok && availability.available;
  const status = !ready ? "unavailable" : availability.degraded || (embeddings.model && retrieval === "bm25_only") ? "degraded" : "ok";
  res.status(ready ? 200 : 503).json({
    status,
    db,
    corpus: { nodes: getCorpus().length },
    chat: { providers: chatProviders, models: chatModelSignature(), states },
    embeddings: {
      provider: embeddings.provider,
      model: embeddings.model,
      vectorsLoaded: info.vectorsLoaded,
      dims: info.dims,
      lastOk: embeddings.lastOk,
      lastErr: embeddings.lastErr,
      breaker: vectorBreakerStatus(),
    },
    retrieval,
  });
};
