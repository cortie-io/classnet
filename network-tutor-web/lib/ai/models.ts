// Vercel AI Gateway 모델 카탈로그(원격 fetch로 모델 목록·헬스체크를 가져오던 부분)를 전부 걷어내고,
// 이 서비스가 실제로 제공하는 두 가지 선택지만 남긴다: 학교가 제공하는 기본 AI(OpenAI, 무료) / 학생
// 본인 OpenAI 키. id 값("network-tutor-gemma")은 route.ts 등 여러 곳에서 문자열로 비교하고 있어
// 그대로 두고(원래 자체 호스팅 Gemma를 쓰던 시절 이름의 흔적), 화면에 보이는 이름/설명만 바꾼다
// (2026-08-19: 기본 답변 엔진을 자체 호스팅 Gemma에서 OpenAI로 전환).
export const DEFAULT_CHAT_MODEL = "network-tutor-gemma";

export type ModelCapabilities = {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
};

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
};

export const chatModels: ChatModel[] = [
  {
    description: "학교가 제공하는 기본 AI (무료)",
    id: "network-tutor-gemma",
    name: "학교 제공 AI",
    provider: "network-tutor",
  },
  {
    description: "내 설정에 등록한 OpenAI API 키로 ChatGPT를 사용합니다",
    id: "network-tutor-openai",
    name: "내 OpenAI 키 사용",
    provider: "network-tutor",
  },
];

export const allowedModelIds = new Set(chatModels.map((m) => m.id));

export const modelsByProvider = chatModels.reduce(
  (acc, model) => {
    (acc[model.provider] ??= []).push(model);
    return acc;
  },
  {} as Record<string, ChatModel[]>
);

export function getActiveModels(): ChatModel[] {
  return chatModels;
}

export type ModelAvailability = "healthy" | "impacted" | "unknown";

// 백엔드는 항상 우리가 직접 운영하는 Ollama/OpenAI 호출이라 원격 헬스체크 API가 없다 — 항상 healthy로 간주한다.
export async function getModelAvailability(
  _modelId: string
): Promise<ModelAvailability> {
  return "healthy";
}

export async function getCapabilities(): Promise<
  Record<string, ModelCapabilities>
> {
  return Object.fromEntries(
    chatModels.map((m) => [m.id, { reasoning: false, tools: false, vision: true }])
  );
}
