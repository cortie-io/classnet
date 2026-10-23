// LLM 계층 공통 타입. 예전에는 ChatMessage가 ollama.ts에 있어서 OpenAI 경로·파이프라인까지 전부
// ollama.ts를 import했다 — Ollama가 선택 사항이 된 지금은 공급자와 무관한 여기로 옮겨 둔다.

/** 첨부 이미지. mime을 같이 들고 다녀야 OpenAI에 실제 형식(png/webp 등)으로 보낼 수 있다 — 예전에는
 * 모든 이미지를 image/jpeg로 표시해 보냈다. base64는 data URI 접두어 없이 순수 base64만. */
export interface ImageInput {
  mime: string;
  base64: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** vision 지원 모델에서만 사용 */
  images?: ImageInput[];
}

/** fast: 일반 답변. accurate: 문제 해설·팩트체크·문제 생성처럼 정확도가 특히 중요한 호출(2026-08-18 결정).
 * 실제 모델 이름은 config(OPENAI_CHAT_MODEL / OPENAI_CHAT_MODEL_HIGH)가 정하고, Ollama는 tier와
 * 상관없이 자기 모델 하나만 쓴다. */
export type ChatTier = "fast" | "accurate";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

/** JSON 출력 강제. true면 아무 JSON 객체, schema를 주면 그 스키마에 맞춘 출력(OpenAI structured outputs). */
export type JsonOutput = true | { name: string; schema: Record<string, unknown> };

export interface ChatOptions {
  tier?: ChatTier;
  reasoningEffort?: ReasoningEffort;
  json?: JsonOutput;
  /** 학생이 요청을 취소했을 때 같이 끊기 위한 신호 — 타임아웃은 llm/http.ts가 tier별로 따로 건다. */
  signal?: AbortSignal;
  maxCompletionTokens?: number;
  /** Ollama에만 전달된다(gpt-5.6 계열은 기본값 외 temperature를 거부한다 — openai.ts 참고). */
  temperature?: number;
}

export type ChatProviderName = "openai" | "ollama";

export interface ChatResult {
  text: string;
  providerUsed: ChatProviderName;
  model: string;
  /** 1순위 공급자가 가용성 오류로 실패해 다음 공급자가 대신 답했는지 — 캐시 여부 판단에 쓴다. */
  fallbackUsed: boolean;
}

const ALLOWED_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** base64 앞부분(파일 시그니처)으로 형식을 추정한다 — mime 없이 base64만 보내는 예전 클라이언트용. */
export function sniffImageMime(base64: string): string {
  if (base64.startsWith("iVBORw0KGgo")) return "image/png";
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("UklGR")) return "image/webp";
  if (base64.startsWith("R0lGOD")) return "image/gif";
  return "image/jpeg";
}

/** 클라이언트가 보낸 mime은 허용 목록에 있을 때만 믿고, 아니면 시그니처로 추정한다. */
export function normalizeImage(base64: string, mime?: string): ImageInput {
  const m = mime?.trim().toLowerCase();
  return { base64, mime: m && ALLOWED_IMAGE_MIME.has(m) ? m : sniffImageMime(base64) };
}
