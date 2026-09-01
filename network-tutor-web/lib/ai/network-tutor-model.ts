import type { LanguageModel } from "ai";

// AI SDK의 언어모델 인터페이스를 흉내내는 어댑터일 뿐, 실제로는 자체 모델을 서빙하지 않는다.
// 진짜 작업(규칙엔진 + 하이브리드 RAG + 자기검증)은 network-tutor-server(Express 백엔드)가 전담하고,
// 여기서는 그 결과를 AI SDK가 기대하는 스트림 프로토콜로 그대로 감싸 돌려줄 뿐이다 — 이렇게 하면
// streamText/toUIMessageStream/useChat 등 템플릿의 나머지 배관(채팅 저장, 사이드바 기록 등)을
// 그대로 재사용할 수 있다.

export interface NetworkTutorProviderOptions {
  userId: number;
  level: "beginner" | "intermediate" | "advanced";
  useOwnKey: boolean;
}

interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

interface BackendAskResponse {
  answer: string;
  intent: string;
  verificationStatus: string;
  confidence: number | null;
  practiceAttempt?: { attemptId: number; questions: unknown[] } | null;
}

const BACKEND_URL = process.env.BACKEND_API_URL ?? "http://127.0.0.1:3300";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "";

// UI Message Stream에 별도 데이터 파트를 얹는 배관을 새로 만드는 대신, 이미 텍스트로 흐르고 있는
// 스트림에 HTML 주석으로 감춘 마커를 붙이고 프런트(message.tsx)에서 그걸 파싱해 카드로 렌더링한다 —
// footnoteBlock의 "출처:" 폴딩과 동일한 패턴이라 배관을 하나만 유지하면 된다.
function appendPracticeMarker(text: string, practiceAttempt: BackendAskResponse["practiceAttempt"]): string {
  if (!practiceAttempt) return text;
  return `${text}\n\n<!--PRACTICE_ATTEMPT:${JSON.stringify(practiceAttempt)}-->`;
}

async function callBackend(
  question: string,
  imageBase64: string | undefined,
  history: HistoryTurn[] | undefined,
  opts: NetworkTutorProviderOptions
): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/api/ask`, {
    body: JSON.stringify({
      history,
      imageBase64,
      question,
      useOwnKey: opts.useOwnKey,
      userId: opts.userId,
    }),
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": INTERNAL_SECRET,
    },
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`network-tutor-server 응답 오류 (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as BackendAskResponse;
  return appendPracticeMarker(data.answer, data.practiceAttempt);
}

type PromptMessage = {
  role: string;
  content: string | Array<{ type: string; text?: string; data?: unknown; url?: string; mediaType?: string }>;
};

// data: URI("data:image/png;base64,AAAA...")에서 base64 부분만 뽑는다. 첨부파일 업로드
// (app/(chat)/api/files/upload)가 별도 오브젝트 스토리지 없이 data URI를 그대로 파일 URL로 쓰기
// 때문에, 채팅으로 실제 올라오는 이미지는 항상 이 형태로 온다.
function base64FromDataUrl(url: string): string | undefined {
  const match = url.match(/^data:[^;]+;base64,(.+)$/s);
  return match ? match[1] : undefined;
}

function textOf(message: PromptMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

// 히스토리로 백엔드에 보내는 이전 대화 텍스트에서, 프런트 전용 마커(출처 폴딩, 인라인 연습문제 카드)를
// 그대로 남겨두면 안 된다 — 특히 <!--PRACTICE_ATTEMPT:{...}-->의 원시 JSON은 사람이 읽는 문장이 아니라서
// 로컬 LLM이 "1번 문제 해설해줘" 같은 꼬리질문에서 그 안의 실제 문제 지문을 못 찾아낸다(실사용 중 확인된 버그).
// 마커를 사람이 읽을 수 있는 문제 지문 텍스트로 풀어써서 히스토리에 넣어준다.
const PRACTICE_ATTEMPT_MARKER_RE = /\n\n<!--PRACTICE_ATTEMPT:([\s\S]*?)-->$/;
const SOURCE_FOOTNOTE_RE = /\n\n---\n출처:\n[\s\S]*$/;

function humanizeHistoryText(text: string): string {
  const match = text.match(PRACTICE_ATTEMPT_MARKER_RE);
  if (!match) return text.replace(SOURCE_FOOTNOTE_RE, "");
  const before = text.slice(0, match.index).replace(SOURCE_FOOTNOTE_RE, "");
  try {
    const attempt = JSON.parse(match[1]) as {
      questions?: Array<{ stem?: string; choices?: string[] }>;
    };
    const listed = (attempt.questions ?? [])
      .map((q, i) => {
        const choicesText = q.choices?.length
          ? `\n${q.choices.map((c, ci) => `${String.fromCharCode(9312 + ci)} ${c}`).join(" ")}`
          : "";
        return `${i + 1}번 문제: ${q.stem ?? ""}${choicesText}`;
      })
      .join("\n\n");
    return listed ? `${before}\n\n[문제은행에서 찾아준 문제 목록]\n${listed}` : before;
  } catch {
    return before;
  }
}

// 마지막 사용자 메시지는 question/imageBase64로 뽑고, 그 앞의 모든 턴은 history로 뽑는다 — 꼬리질문
// ("그거 좀 더 쉽게", "왜 그런데?")이 이전 맥락을 가리킬 때 백엔드가 그 맥락을 볼 수 있게 하기 위함이다.
function extractRequest(prompt: PromptMessage[]): {
  question: string;
  imageBase64?: string;
  history?: HistoryTurn[];
} {
  const lastUserIdx = [...prompt].map((m) => m.role).lastIndexOf("user");
  if (lastUserIdx === -1) return { question: "" };
  const lastUser = prompt[lastUserIdx];

  let question = "";
  let imageBase64: string | undefined;
  if (typeof lastUser.content === "string") {
    question = lastUser.content;
  } else {
    for (const part of lastUser.content) {
      if (part.type === "text" && typeof part.text === "string") {
        question += (question ? "\n" : "") + part.text;
      } else if (part.type === "file" && part.mediaType?.startsWith("image/")) {
        if (typeof part.url === "string" && part.url.startsWith("data:")) {
          imageBase64 = base64FromDataUrl(part.url);
        } else if (typeof part.data === "string") {
          imageBase64 = part.data;
        } else if (part.data instanceof Uint8Array) {
          imageBase64 = Buffer.from(part.data).toString("base64");
        }
      }
    }
  }

  const history: HistoryTurn[] = prompt
    .slice(0, lastUserIdx)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: humanizeHistoryText(textOf(m)) }))
    .filter((h) => h.content.trim().length > 0);

  return { question, imageBase64, history: history.length > 0 ? history : undefined };
}

const USAGE_PLACEHOLDER = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 0, total: 0 },
  outputTokens: { reasoning: 0, text: 0, total: 0 },
};

type CallOptions = {
  prompt: PromptMessage[];
  providerOptions?: { networkTutor?: NetworkTutorProviderOptions };
};

function requireOptions(providerOptions: CallOptions["providerOptions"]): NetworkTutorProviderOptions {
  const opts = providerOptions?.networkTutor;
  if (!opts) throw new Error("networkTutor providerOptions가 전달되지 않았습니다.");
  return opts;
}

// 세션마다 다른 값(userId/level/useOwnKey)은 streamText()의 providerOptions.networkTutor로
// 매 호출마다 전달된다 — 모델 인스턴스 자체는 상태 없는 싱글턴이다.
export const networkTutorModel: LanguageModel = {
  defaultObjectGenerationMode: undefined,
  async doGenerate({ prompt, providerOptions }: CallOptions) {
    const opts = requireOptions(providerOptions);
    const { question, imageBase64, history } = extractRequest(prompt);
    const text = await callBackend(question, imageBase64, history, opts);
    return {
      content: [{ text, type: "text" }],
      finishReason: "stop",
      usage: USAGE_PLACEHOLDER,
      warnings: [],
    };
  },
  doStream({ prompt, providerOptions }: CallOptions) {
    return {
      stream: new ReadableStream({
        async start(controller) {
          controller.enqueue({ id: "t1", type: "text-start" });
          try {
            const opts = requireOptions(providerOptions);
            const { question, imageBase64, history } = extractRequest(prompt);
            const text = await callBackend(question, imageBase64, history, opts);
            controller.enqueue({ delta: text, id: "t1", type: "text-delta" });
          } catch (err) {
            controller.enqueue({
              delta: `죄송합니다, 답변을 생성하는 중 오류가 발생했습니다: ${
                err instanceof Error ? err.message : String(err)
              }`,
              id: "t1",
              type: "text-delta",
            });
          }
          controller.enqueue({ id: "t1", type: "text-end" });
          controller.enqueue({
            finishReason: "stop",
            type: "finish",
            usage: USAGE_PLACEHOLDER,
          });
          controller.close();
        },
      }),
    };
  },
  modelId: "network-tutor",
  provider: "network-tutor",
  specificationVersion: "v3",
  supportedUrls: {},
} as unknown as LanguageModel;
