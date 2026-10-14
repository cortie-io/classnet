import { readFileSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

function loadDotenv(path: string) {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // no .env file, rely on real env vars
  }
}

const envPath = new URL("../.env", import.meta.url).pathname;

// 테스트(npm test → src/test/setupEnv.ts가 NODE_ENV=test로 둔다)에서는 .env를 아예 읽지 않는다 —
// 로컬 .env에는 운영 RDS 주소와 학교 OpenAI 키가 들어 있던 적이 있어서, 테스트가 그걸 주워 쓰면
// 운영 DB를 건드리거나 실제 API를 부르게 된다. 같은 이유로 테스트에서는 키를 .env에 써넣지도 않는다.
const isTest = process.env.NODE_ENV === "test";
if (!isTest) loadDotenv(envPath);
if (isTest && (process.env.DATABASE_URL ?? "").includes("rds.amazonaws.com")) {
  throw new Error("[config] 테스트가 운영 RDS(DATABASE_URL)를 가리키고 있어 중단합니다.");
}

// ENCRYPTION_KEY(OpenAI 키 등 민감정보 암호화용)가 없으면 최초 1회 생성해 .env에 저장한다.
// 이후 재기동 시에도 동일 키가 유지되어야 이미 암호화된 값을 복호화할 수 있다.
if (!process.env.ENCRYPTION_KEY && process.env.NODE_ENV !== "production") {
  const generated = randomBytes(32).toString("hex");
  process.env.ENCRYPTION_KEY = generated;
  if (!isTest) {
    try {
      appendFileSync(envPath, `\nENCRYPTION_KEY=${generated}\n`);
      console.warn("[config] ENCRYPTION_KEY가 없어 새로 생성해 .env에 저장했습니다.");
    } catch {
      console.warn("[config] ENCRYPTION_KEY를 .env에 저장하지 못했습니다 — 재기동 시 값이 바뀝니다.");
    }
  }
}

if (process.env.NODE_ENV === "production") {
  if (!/^[a-f0-9]{64}$/i.test(process.env.ENCRYPTION_KEY ?? "")) {
    throw new Error("운영 ENCRYPTION_KEY는 고정된 32바이트 16진수 값으로 설정해야 합니다.");
  }
  if (!process.env.INTERNAL_API_SECRET) throw new Error("운영 INTERNAL_API_SECRET을 설정해야 합니다.");
}

function optionalNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export type EmbedProvider = "openai" | "ollama" | "none";

function parseEmbedProvider(raw: string | undefined): EmbedProvider | undefined {
  const v = raw?.trim().toLowerCase();
  if (v === "openai" || v === "ollama" || v === "none") return v;
  if (v) console.warn(`[config] EMBED_PROVIDER=${raw}는 알 수 없는 값이라 무시합니다(openai|ollama|none).`);
  return undefined;
}

export const config = {
  activePeriod: process.env.ACTIVE_SERVICE_PERIOD === "2" ? "2" as const : "1" as const,
  phase1DatabaseUrl: process.env.PHASE1_DATABASE_URL || undefined,
  databaseUrl: process.env.DATABASE_URL ?? "postgres://ubuntu@localhost:5432/network_tutor",
  // 비어 있으면 Ollama를 아예 쓰지 않는다. 예전에는 kbu-gpuserver의 tailnet IP가 기본값으로 박혀
  // 있었는데, 그 서버가 사라진 뒤(2026-10-14) 모든 embed/chat 호출이 그 주소로 10초씩 연결을 시도하다
  // 실패해 /api/ask 전체가 멈췄다. 이제는 명시적으로 설정한 경우에만 대체 경로로 쓴다.
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL?.trim() || undefined,
  ollamaChatModel: process.env.OLLAMA_CHAT_MODEL ?? "gemma4-e4b:latest",
  ollamaEmbedModel: process.env.OLLAMA_EMBED_MODEL ?? "bge-m3:latest",
  // Ollama는 이 서비스 전체가 공유하는 단일 인스턴스라, 동시 사용자가 몰리면 전부 한꺼번에 부딪혀서
  // 다 같이 느려지거나 타임아웃난다. 동시 실행 수를 제한해 대신 줄을 세우면(대기 시간은 늘어도) 각
  // 요청은 안정적으로 끝까지 완료된다.
  // 값 근거(30명 규모 배포 준비, 2026-08-08 직접 측정, 두 번 수정됨):
  // 1차 측정에서는 아주 짧은 프롬프트(수십 토큰)로 동시 요청 10개까지 던져봤는데 요청당 토큰 생성
  // 속도가 혼자 돌릴 때와 거의 동일하게 유지돼서 10으로 올렸었다. 그런데 실제 파이프라인(검색 컨텍스트
  // +대화 이력+개인화 지시문이 붙어 프롬프트가 6000~10000자에 달함)으로 다시 재보니 전혀 다른
  // 결과가 나왔다 — 동시 3개만 던져도 개별 generate 호출이 30~123초까지 벌어지고, 총 처리 시간이
  // 혼자 돌릴 때(~90초)의 최대 1.8배(~160초)까지 늘어졌다. 즉 짧은 프롬프트 벤치마크는 실제 부하를
  // 대표하지 못했다(프리필/컨텍스트 처리가 병목이지 토큰 생성 속도가 병목이 아니었음). 이 실측을
  // 근거로 훨씬 보수적인 값으로 되돌린다 — 동시 3~4개도 이미 300초 타임아웃에 근접할 수 있어서다.
  // embed(bge-m3)는 프롬프트가 훨씬 짧아(질문 텍스트 정도) 같은 병목이 덜하다고 보고 조금 더 넉넉히 둔다.
  ollamaMaxConcurrentChat: Number(process.env.OLLAMA_MAX_CONCURRENT_CHAT ?? 3),
  ollamaMaxConcurrentEmbed: Number(process.env.OLLAMA_MAX_CONCURRENT_EMBED ?? 8),
  // 학교 공용 OpenAI 키 — 답변 생성과 검색 임베딩의 주 경로다(동시 3개로 막혀 있던 Ollama보다 동시접속
  // 수십 명을 감당하기 위함). 학생이 개인 키를 등록해 명시적으로 "openai"를 선택한 경우는 그 개인 키가
  // 우선한다. 비어 있으면 답변 생성은 Ollama(설정된 경우)로만, 검색은 BM25만으로 동작한다.
  openaiApiKey: process.env.OPENAI_API_KEY || undefined,
  // 일반 답변(fast)과 정확도가 중요한 호출(accurate: 문제 해설·검증·문제 생성)에 쓰는 모델. 호출하는 쪽은
  // 모델 이름이 아니라 tier만 넘긴다(llm/provider.ts) — 모델 교체가 env 한 줄로 끝나게 하기 위함.
  openaiChatModel: process.env.OPENAI_CHAT_MODEL?.trim() || "gpt-5.6-luna",
  openaiChatModelHigh: process.env.OPENAI_CHAT_MODEL_HIGH?.trim() || "gpt-5.6-terra",
  openaiEmbedModel: process.env.OPENAI_EMBED_MODEL?.trim() || "text-embedding-3-small",
  // 비우면 모델 기본 차원(text-embedding-3-small 1536, -large 3072)을 쓴다.
  openaiEmbedDimensions: optionalNumber(process.env.OPENAI_EMBED_DIMENSIONS),
  // 비우면 OPENAI_API_KEY가 있을 때 openai, 없으면 none(BM25만으로 검색). 실제 판단은
  // llm/embedding.ts의 activeEmbeddingProvider()가 호출 시점의 값으로 한다.
  embedProvider: parseEmbedProvider(process.env.EMBED_PROVIDER),
  // "관련 문제 뽑아줘"에서 검색 1위 개념 노드를 주제로 믿어도 되는지 가르는 기준(pipeline/topicGate.ts).
  // 벡터 유사도 척도는 임베딩 모델마다 달라 모델을 바꾸면 다시 맞춰야 한다 — 재임베딩 뒤 topicGate.ts
  // 주석의 실사용 사례(2진수, OSPF/NSSA, ext4, 포트 443, 제로트러스트)로 1위 유사도를 재서 정한다.
  // 비우면 bge-m3(ollama)는 원래 실측값 0.5, OpenAI는 임시값 0.4.
  embedMinTopicScore: optionalNumber(process.env.EMBED_MIN_TOPIC_SCORE),
  // 임베딩 없이(BM25만으로) 검색할 때의 기준: 요청 문구를 뺀 주제 부분의 BM25 1위 점수와, 2위 대비
  // 1위가 앞선 비율. 참조 문서 색인으로 잰 값이다(topicGate.ts 주석).
  bm25MinTopicScore: optionalNumber(process.env.BM25_MIN_TOPIC_SCORE) ?? 3.5,
  bm25MinTopicMargin: optionalNumber(process.env.BM25_MIN_TOPIC_MARGIN) ?? 0.25,
  port: Number(process.env.PORT ?? 3300),
  encryptionKey: process.env.ENCRYPTION_KEY!,
  cookieSecure: process.env.COOKIE_SECURE === "true",
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  // network-tutor-web(Next.js)이 서버 간 호출로 /api/ask 등을 부를 때 쓰는 공유 비밀.
  // 브라우저에는 절대 노출되지 않고, 두 백엔드 프로세스만 알고 있다.
  internalApiSecret: process.env.INTERNAL_API_SECRET ?? "",
};
