import { config } from "../../config.js";
import { Semaphore } from "./concurrencyLimiter.js";
import { LLM_TIMEOUT_MS, LlmError, llmFetchJson } from "./http.js";
import type { ChatMessage, ChatOptions } from "./types.js";

// 자체 호스팅 Ollama — OLLAMA_BASE_URL을 설정했을 때만 쓰는 선택 경로다(2026-10-14 kbu-gpuserver가
// 사라진 뒤 기본 경로는 OpenAI). 이 파일은 llm/ 안에서만 import한다: 바깥 코드는 provider.ts의
// generateChat과 embedding.ts만 쓰고, 어떤 공급자가 실제로 불렸는지는 몰라도 되게 한다.

// 전체 서비스가 공유하는 단일 Ollama 인스턴스를 여러 학생이 동시에 쓰므로, 동시 요청 수를 제한해서
// 몰릴 때 다 같이 느려지는 대신 순서대로 안정적으로 완료되게 한다.
const chatLimiter = new Semaphore(config.ollamaMaxConcurrentChat);
const embedLimiter = new Semaphore(config.ollamaMaxConcurrentEmbed);

export function ollamaConfigured(): boolean {
  return !!config.ollamaBaseUrl;
}

function baseUrl(): string {
  if (!config.ollamaBaseUrl) throw new LlmError("not_configured", "ollama", "OLLAMA_BASE_URL is not set");
  return config.ollamaBaseUrl.replace(/\/+$/, "");
}

export async function embedWithOllama(
  texts: string[],
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<number[][]> {
  const url = `${baseUrl()}/api/embeddings`;
  const out: number[][] = [];
  for (const text of texts) {
    const release = await embedLimiter.acquire();
    try {
      const data = await llmFetchJson<{ embedding: number[] }>(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: config.ollamaEmbedModel, prompt: text }),
        },
        { provider: "ollama", label: "embed", timeoutMs: opts.timeoutMs ?? LLM_TIMEOUT_MS.embed, signal: opts.signal },
      );
      out.push(data.embedding);
    } finally {
      release();
    }
  }
  return out;
}

export async function chatWithOllama(messages: ChatMessage[], opts: ChatOptions = {}): Promise<{ text: string; model: string }> {
  const url = `${baseUrl()}/api/chat`;
  // Ollama는 모델을 하나만 쓴다 — tier(fast/accurate)와 상관없이 OLLAMA_CHAT_MODEL. 예전에는 상위 모델
  // 이름(gpt-5.6-terra)이 그대로 Ollama로 넘어가 404가 났다(계산 해설·검증·문제 생성이 전부 실패).
  const model = config.ollamaChatModel;
  const waitStart = Date.now();
  const release = await chatLimiter.acquire();
  // 대기 시간이 눈에 띄면(=한도에 자주 걸리고 있으면) 운영 중 튜닝 근거로 남긴다. 매 호출마다 찍으면
  // 로그가 시끄러워지니 실제로 줄을 선 경우에만 남긴다.
  const waitedMs = Date.now() - waitStart;
  if (waitedMs > 1000) {
    console.log(`[ollama] chat 요청이 동시 실행 한도(${config.ollamaMaxConcurrentChat}) 때문에 ${waitedMs}ms 대기함`);
  }
  try {
    const data = await llmFetchJson<{ message: { content: string } }>(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
            ...(m.images?.length ? { images: m.images.map((img) => img.base64) } : {}),
          })),
          stream: false,
          ...(opts.json ? { format: "json" } : {}),
          options: { temperature: opts.temperature ?? 0.2 },
        }),
      },
      { provider: "ollama", label: "chat", timeoutMs: LLM_TIMEOUT_MS[opts.tier ?? "fast"], signal: opts.signal },
    );
    return { text: data.message.content, model };
  } finally {
    release();
  }
}
