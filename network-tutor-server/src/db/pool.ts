import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// cortie-db(RDS)는 Amazon 자체 CA로 서명돼 있어 Node 기본 신뢰 체인에 없다 — 이 번들로 명시 검증한다.
const rdsCaPath = path.join(__dirname, "../../certs/rds-global-bundle.pem");
// 같은 머신의 Postgres(로컬 개발 DB, 테스트용 PGlite)는 TLS를 쓰지 않는다 — 여기에 RDS용 ssl 설정을
// 그대로 걸면 "server does not support SSL"로 연결 자체가 안 된다.
const isLoopbackDb = (() => {
  try {
    const host = new URL(config.databaseUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host === "";
  } catch {
    return false;
  }
})();
const ssl = !isLoopbackDb && existsSync(rdsCaPath)
  ? { ca: readFileSync(rdsCaPath, "utf8"), rejectUnauthorized: true }
  : undefined;

// 기본 max(10)는 여러 학생이 동시에 쓸 때(질문마다 감사로그·캐시·개인화 조회가 병렬로 여러 건 나감)
// 병목이 될 수 있어 늘려둔다 — Postgres 쪽 max_connections이 100이라 여유는 충분하다(확인 완료).
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, ssl });
