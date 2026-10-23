// npm test가 모든 테스트 파일보다 먼저 불러오는 환경 설정(node --import). 테스트가 실수로라도 운영 DB나
// 실제 OpenAI를 건드리지 못하게, 설정 모듈(config.ts)이 읽히기 전에 위험한 값을 전부 걷어낸다.
//   - DATABASE_URL이 RDS를 가리키면 그 자리에서 중단한다(운영 DB는 managed RDS 하나뿐이다).
//   - OPENAI_API_KEY·OLLAMA_BASE_URL은 지운다. 키가 필요한 테스트는 가짜 값을 config에 직접 넣는다.
//   - fetch는 기본으로 막아 둔다. 바깥 호출이 필요한 테스트는 test/fetchStub.ts로 응답을 꾸며 끼운다.
//   - DB가 필요한 테스트는 test/pgTestDb.ts가 PGlite를 띄워 DATABASE_URL을 바꾼다. 그 전에는 아무 데도
//     연결되지 않는 주소를 넣어 두어, 로컬 Postgres(config의 기본값)에 우연히 붙는 일도 없게 한다.

if ((process.env.DATABASE_URL ?? "").includes("rds.amazonaws.com")) {
  throw new Error("[test] DATABASE_URL이 운영 RDS를 가리키고 있어 테스트를 중단합니다.");
}

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgres://no-test-db@127.0.0.1:9/not_started";
delete process.env.OPENAI_API_KEY;
delete process.env.OLLAMA_BASE_URL;
delete process.env.EMBED_PROVIDER;
process.env.ENCRYPTION_KEY ??= "0".repeat(64);
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.INTERNAL_API_SECRET = "test-internal-secret";

globalThis.fetch = (async (input: unknown) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : String((input as Request).url);
  throw new Error(`[test] 테스트에서 실제 네트워크 호출은 막혀 있습니다: ${url} — test/fetchStub.ts로 응답을 꾸며 주세요.`);
}) as typeof fetch;
