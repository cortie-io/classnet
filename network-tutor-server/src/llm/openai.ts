import type { ChatMessage } from "./ollama.js";

// 일반 답변 생성 기본 모델. 팩트체크 검증/문제 해설처럼 정확도가 특히 중요한 호출은 opts.model로
// GPT_CHAT_MODEL_HIGH(더 비싸지만 더 똑똑한 모델)를 명시적으로 넘긴다 — 예산(주당 약 20만원) 안에서
// 정확도가 제일 중요한 곳에만 집중 투자하기로 한 결정(2026-08-18).
const OPENAI_CHAT_MODEL = "gpt-5.6-luna";
export const OPENAI_CHAT_MODEL_HIGH = "gpt-5.6-terra";

export async function chatWithOpenAI(
  messages: ChatMessage[],
  apiKey: string,
  opts: { temperature?: number; model?: string; reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" } = {},
): Promise<string> {
  const wireMessages = messages.map((m) => {
    if (!m.images || m.images.length === 0) return { role: m.role, content: m.content };
    return {
      role: m.role,
      content: [
        { type: "text", text: m.content },
        ...m.images.map((b64) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } })),
      ],
    };
  });

  // gpt-5.6 계열은 temperature를 기본값(1) 외 다른 값으로 보내면 400 에러를 낸다(실측 확인됨:
  // "Unsupported value: 'temperature' does not support 0.3 with this model. Only the default (1)
  // value is supported.") — reasoning 계열 모델이라 그런 듯하다. opts.temperature는 그냥 무시하고
  // 아예 필드를 안 보낸다(기본값 사용).
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: opts.model ?? OPENAI_CHAT_MODEL,
      messages: wireMessages,
      ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
    }),
  });
  if (!res.ok) throw new Error(`openai chat failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content;
}
