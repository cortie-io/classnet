import { config } from "../config.js";
import { LlmError, isAvailabilityError } from "./http.js";
import { chatWithOllama, ollamaConfigured } from "./ollama.js";
import { chatWithOpenAI, openaiChatModel } from "./openai.js";
import type { ChatMessage, ChatOptions, ChatProviderName, ChatResult } from "./types.js";

export interface ProviderChoice {
  /** 'openai'는 사용자가 등록한 본인 키로 ChatGPT를 쓰겠다는 명시적 선택. 기본은 학교 공용 OpenAI
   * 키(config.openaiApiKey), 그다음이 (설정돼 있으면) 자체 호스팅 Ollama. */
  provider: "default" | "openai";
  openaiApiKey?: string;
}

interface Candidate {
  name: ChatProviderName;
  label: string;
  run: (messages: ChatMessage[], opts: ChatOptions) => Promise<{ text: string; model: string }>;
}

function candidatesFor(choice: ProviderChoice): Candidate[] {
  const list: Candidate[] = [];
  const studentKey = choice.provider === "openai" ? choice.openaiApiKey : undefined;
  if (studentKey) list.push({ name: "openai", label: "student-key", run: (m, o) => chatWithOpenAI(m, studentKey, o) });
  const schoolKey = config.openaiApiKey;
  if (schoolKey) list.push({ name: "openai", label: "school-key", run: (m, o) => chatWithOpenAI(m, schoolKey, o) });
  if (ollamaConfigured()) list.push({ name: "ollama", label: "ollama", run: chatWithOllama });
  return list;
}

/** 답변을 만들 수 있는 공급자가 하나라도 설정돼 있는지 — /ready가 503을 낼지 판단할 때 쓴다. */
export function chatProvidersConfigured(): ChatProviderName[] {
  const names: ChatProviderName[] = [];
  if (config.openaiApiKey) names.push("openai");
  if (ollamaConfigured()) names.push("ollama");
  return names;
}

/** 캐시 키에 넣는 "지금 답을 만드는 모델" 표시. 공급자·모델이 바뀌면 예전 답변이 자연히 안 쓰이게 한다. */
export function chatModelSignature(): string {
  if (config.openaiApiKey) return `openai:${openaiChatModel("fast")}|${openaiChatModel("accurate")}`;
  if (ollamaConfigured()) return `ollama:${config.ollamaChatModel}`;
  return "none";
}

/**
 * 학생 개인 키 → 학교 공용 키 → Ollama(설정된 경우만) 순서로 시도한다. 다음 공급자로 넘어가는 것은
 * 가용성 오류(타임아웃·429·5xx·네트워크)일 때뿐이다 — 키가 틀렸거나(401) 요청이 잘못된(400) 경우까지
 * 넘기면 진짜 원인이 가려지고, 학생이 명시적으로 고른 개인 키 대신 학교 예산을 쓰게 된다.
 * 호출하는 쪽은 모델 이름이 아니라 tier만 넘긴다(모델은 config가 정함).
 */
export async function generateChat(
  messages: ChatMessage[],
  choice: ProviderChoice,
  opts: ChatOptions = {},
): Promise<ChatResult> {
  const candidates = candidatesFor(choice);
  if (candidates.length === 0) {
    throw new LlmError("not_configured", "none", "no chat provider configured (OPENAI_API_KEY / OLLAMA_BASE_URL)");
  }
  let lastErr: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    try {
      const { text, model } = await c.run(messages, opts);
      return { text, model, providerUsed: c.name, fallbackUsed: i > 0 };
    } catch (err) {
      lastErr = err;
      if (opts.signal?.aborted || !isAvailabilityError(err) || i === candidates.length - 1) throw err;
      console.warn(`[llm] ${c.label} 실패(${err instanceof LlmError ? err.kind : "error"}) — ${candidates[i + 1].label}로 넘김`);
    }
  }
  throw lastErr;
}
