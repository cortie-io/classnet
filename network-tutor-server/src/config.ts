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
loadDotenv(envPath);

// ENCRYPTION_KEY(OpenAI 키 등 민감정보 암호화용)가 없으면 최초 1회 생성해 .env에 저장한다.
// 이후 재기동 시에도 동일 키가 유지되어야 이미 암호화된 값을 복호화할 수 있다.
if (!process.env.ENCRYPTION_KEY) {
  const generated = randomBytes(32).toString("hex");
  process.env.ENCRYPTION_KEY = generated;
  try {
    appendFileSync(envPath, `\nENCRYPTION_KEY=${generated}\n`);
    console.warn("[config] ENCRYPTION_KEY가 없어 새로 생성해 .env에 저장했습니다.");
  } catch {
    console.warn("[config] ENCRYPTION_KEY를 .env에 저장하지 못했습니다 — 재기동 시 값이 바뀝니다.");
  }
}

if (!process.env.SESSION_SECRET) {
  const generated = randomBytes(32).toString("hex");
  process.env.SESSION_SECRET = generated;
  try {
    appendFileSync(envPath, `SESSION_SECRET=${generated}\n`);
  } catch {
    /* ignore */
  }
}

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://ubuntu@localhost:5432/network_tutor",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://100.79.44.109:11434",
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
  // 학교 공용 OpenAI 키 — 설정돼 있으면 기본 답변 생성이 자체 호스팅 Gemma 대신 이걸 쓴다
  // (동시 3개로 막혀 있는 Ollama보다 동시접속 수십 명을 감당하기 위함). 학생이 개인 키를
  // 등록해 명시적으로 "openai"를 선택한 경우는 항상 그 개인 키가 우선한다.
  openaiApiKey: process.env.OPENAI_API_KEY || undefined,
  port: Number(process.env.PORT ?? 3300),
  encryptionKey: process.env.ENCRYPTION_KEY!,
  sessionSecret: process.env.SESSION_SECRET!,
  cookieSecure: process.env.COOKIE_SECURE === "true",
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  // network-tutor-web(Next.js)이 서버 간 호출로 /api/ask 등을 부를 때 쓰는 공유 비밀.
  // 브라우저에는 절대 노출되지 않고, 두 백엔드 프로세스만 알고 있다.
  internalApiSecret: process.env.INTERNAL_API_SECRET ?? "",
};
