import { config } from "../config.js";
import { chat as chatOllama, type ChatMessage } from "./ollama.js";
import { chatWithOpenAI } from "./openai.js";

export interface ProviderChoice {
  /** 'openai'는 사용자가 등록한 본인 키로 ChatGPT를 쓰겠다는 명시적 선택. 기본은 학교 공용 OpenAI
   * 키(config.openaiApiKey)가 설정돼 있으면 그걸, 없으면 자체 호스팅 Gemma(Ollama)를 쓴다. */
  provider: "default" | "openai";
  openaiApiKey?: string;
}

export async function generateChat(
  messages: ChatMessage[],
  choice: ProviderChoice,
  // model: 검증/문제 해설처럼 정확도가 특히 중요한 호출만 명시적으로 상위 모델(OPENAI_CHAT_MODEL_HIGH)을
  // 넘긴다. Ollama(Gemma)는 모델을 하나만 쓰므로 이 값은 OpenAI 경로에서만 의미가 있다.
  opts: { temperature?: number; model?: string; reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" } = {},
): Promise<{ text: string; providerUsed: "gemma" | "openai" }> {
  if (choice.provider === "openai" && choice.openaiApiKey) {
    const text = await chatWithOpenAI(messages, choice.openaiApiKey, opts);
    return { text, providerUsed: "openai" };
  }
  if (config.openaiApiKey) {
    const text = await chatWithOpenAI(messages, config.openaiApiKey, opts);
    return { text, providerUsed: "openai" };
  }
  const text = await chatOllama(messages, opts);
  return { text, providerUsed: "gemma" };
}
