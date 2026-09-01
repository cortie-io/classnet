import { config } from "../config.js";
import { Semaphore } from "./concurrencyLimiter.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** base64 인코딩(데이터 URI 접두어 없이), vision 지원 모델에서만 사용 */
  images?: string[];
}

// 전체 서비스가 공유하는 단일 Ollama 인스턴스를 여러 학생이 동시에 쓰므로, 동시 요청 수를 제한해서
// 몰릴 때 다 같이 느려지는 대신 순서대로 안정적으로 완료되게 한다.
const chatLimiter = new Semaphore(config.ollamaMaxConcurrentChat);
const embedLimiter = new Semaphore(config.ollamaMaxConcurrentEmbed);

export async function embed(text: string): Promise<number[]> {
  const release = await embedLimiter.acquire();
  try {
    const res = await fetch(`${config.ollamaBaseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.ollamaEmbedModel, prompt: text }),
    });
    if (!res.ok) throw new Error(`ollama embed failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { embedding: number[] };
    return data.embedding;
  } finally {
    release();
  }
}

export async function chat(
  messages: ChatMessage[],
  opts: { temperature?: number; model?: string } = {},
): Promise<string> {
  const waitStart = Date.now();
  const release = await chatLimiter.acquire();
  // 대기 시간이 눈에 띄면(=한도에 자주 걸리고 있으면) 운영 중 튜닝 근거로 남긴다. 매 호출마다 찍으면
  // 로그가 시끄러워지니 실제로 줄을 선 경우에만 남긴다.
  const waitedMs = Date.now() - waitStart;
  if (waitedMs > 1000) {
    console.log(`[ollama] chat 요청이 동시 실행 한도(${config.ollamaMaxConcurrentChat}) 때문에 ${waitedMs}ms 대기함`);
  }
  try {
    const res = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model ?? config.ollamaChatModel,
        messages,
        stream: false,
        options: { temperature: opts.temperature ?? 0.2 },
      }),
    });
    if (!res.ok) throw new Error(`ollama chat failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { message: { content: string } };
    return data.message.content;
  } finally {
    release();
  }
}
