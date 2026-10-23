import { config } from "../config.js";
import { LLM_TIMEOUT_MS, LlmError, llmFetchJson } from "./http.js";
import type { ChatMessage, ChatOptions, ChatTier } from "./types.js";

// 일반 답변 생성 기본 모델과, 팩트체크 검증/문제 해설처럼 정확도가 특히 중요한 호출에 쓰는 상위 모델
// (더 비싸지만 더 똑똑한 모델) — 예산(주당 약 20만원) 안에서 정확도가 제일 중요한 곳에만 집중 투자하기로
// 한 결정(2026-08-18). 이름은 env(OPENAI_CHAT_MODEL / OPENAI_CHAT_MODEL_HIGH)로 바꿀 수 있다.
export function openaiChatModel(tier: ChatTier): string {
  return tier === "accurate" ? config.openaiChatModelHigh : config.openaiChatModel;
}

// 출력 상한. reasoning 계열은 이 값에 추론 토큰까지 포함되므로 너무 낮추면 본문이 비어서 돌아온다 —
// 여러 문제를 붙여넣은 해설(accurate)도 끝까지 나올 만큼 넉넉하게 두되, 무한정 길어지는 것만 막는다.
const MAX_COMPLETION_TOKENS: Record<ChatTier, number> = { fast: 8_000, accurate: 16_000 };

interface ChatCompletionResponse {
  choices: { message: { content: string | null }; finish_reason?: string }[];
}

export async function chatWithOpenAI(
  messages: ChatMessage[],
  apiKey: string,
  opts: ChatOptions = {},
): Promise<{ text: string; model: string }> {
  const tier = opts.tier ?? "fast";
  const model = openaiChatModel(tier);
  const wireMessages = messages.map((m) => {
    if (!m.images || m.images.length === 0) return { role: m.role, content: m.content };
    return {
      role: m.role,
      content: [
        { type: "text", text: m.content },
        ...m.images.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mime};base64,${img.base64}` } })),
      ],
    };
  });

  let responseFormat: unknown;
  if (opts.json === true) responseFormat = { type: "json_object" };
  else if (opts.json) responseFormat = { type: "json_schema", json_schema: { name: opts.json.name, schema: opts.json.schema, strict: true } };

  // gpt-5.6 계열은 temperature를 기본값(1) 외 다른 값으로 보내면 400 에러를 낸다(실측 확인됨:
  // "Unsupported value: 'temperature' does not support 0.3 with this model. Only the default (1)
  // value is supported.") — reasoning 계열 모델이라 그런 듯하다. opts.temperature는 그냥 무시하고
  // 아예 필드를 안 보낸다(기본값 사용).
  const data = await llmFetchJson<ChatCompletionResponse>(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: wireMessages,
        max_completion_tokens: opts.maxCompletionTokens ?? MAX_COMPLETION_TOKENS[tier],
        ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
        ...(responseFormat ? { response_format: responseFormat } : {}),
      }),
    },
    { provider: "openai", label: "chat", timeoutMs: LLM_TIMEOUT_MS[tier], signal: opts.signal },
  );
  const choice = data.choices?.[0];
  const text = choice?.message?.content ?? "";
  if (!text.trim()) {
    // 추론에 상한을 다 써버리면(finish_reason=length) 본문 없이 200이 온다 — 빈 답을 정상 답변처럼 내보내지 않는다.
    throw new LlmError("unavailable", "openai", `openai chat returned empty content (finish_reason=${choice?.finish_reason ?? "?"})`);
  }
  return { text, model };
}

// text-embedding-3-* 만 dimensions 파라미터를 받는다(ada-002는 400).
const DEFAULT_EMBED_DIMS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
};

/** 이 모델의 기본 차원(dimensions를 안 보냈을 때 나오는 길이). 모르는 모델이면 undefined. */
export function openaiDefaultEmbedDimensions(): number | undefined {
  return DEFAULT_EMBED_DIMS[config.openaiEmbedModel];
}

export function openaiEmbedDimensions(): number | undefined {
  return config.openaiEmbedDimensions ?? openaiDefaultEmbedDimensions();
}

interface EmbeddingResponse {
  data: { index: number; embedding: number[] }[];
}

/** 여러 텍스트를 한 번에 임베딩한다. 검색 질의는 늘 학교 공용 키로만 부른다(학생 개인 키로 벡터를 만들 이유가 없다). */
export async function embedWithOpenAI(
  texts: string[],
  apiKey: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<number[][]> {
  const dims = openaiEmbedDimensions();
  const sendDims = config.openaiEmbedModel.startsWith("text-embedding-3") && dims !== undefined;
  const data = await llmFetchJson<EmbeddingResponse>(
    "https://api.openai.com/v1/embeddings",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: config.openaiEmbedModel, input: texts, ...(sendDims ? { dimensions: dims } : {}) }),
    },
    { provider: "openai", label: "embed", timeoutMs: opts.timeoutMs ?? LLM_TIMEOUT_MS.embed, signal: opts.signal },
  );
  // 응답 순서는 보통 입력 순서와 같지만 index로 맞춰 둔다.
  const out: number[][] = new Array(texts.length);
  for (const item of data.data) out[item.index] = item.embedding;
  return out;
}
