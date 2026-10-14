import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "../../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// cortie-db(RDS)는 Amazon 자체 CA로 서명돼 있어 Node 기본 신뢰 체인에 없다 — 이 번들로 명시 검증한다.
const rdsCaPath = path.join(__dirname, "../../../certs/rds-global-bundle.pem");
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
export type ServicePeriod = "1" | "2";
export const periodContext = new AsyncLocalStorage<ServicePeriod>();
export const activePool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, ssl });
// The archive URL must use a SELECT-only role. The session default is an additional guard.
export const archivePool = config.phase1DatabaseUrl
  ? new pg.Pool({ connectionString: config.phase1DatabaseUrl, max: 5, ssl, options: "-c default_transaction_read_only=on" })
  : undefined;
export function isArchivePeriod(): boolean {
  return config.activePeriod === "2" && periodContext.getStore() === "1";
}
// Async request context keeps concurrent period selections independent. Authentication runs
// before selecting a period and always checks the active database.
export const pool: pg.Pool = new Proxy(activePool, {
  get(_target, property) {
    const selected = isArchivePeriod() ? archivePool : activePool;
    if (!selected) throw new Error("1차 조회용 데이터베이스가 설정되지 않았습니다.");
    const value = Reflect.get(selected, property);
    return typeof value === "function" ? value.bind(selected) : value;
  },
});
