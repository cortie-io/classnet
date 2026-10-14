import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

// 예전 "토큰 소진" 스크립트(run_token_burn.ts, 삭제됨)가 남긴 흔적을 정리한다.
//   - audit_log에 intent='token_burn_test'로 들어간 가짜 질문 기록(학생 이름으로 기록돼 랭킹·리포트·
//     활동일 집계를 부풀린다)
//   - users.token_quota/token_used/token_remaining/last_token_burn_at 값
// 기본은 개수만 보여준다(dry-run). --apply 를 붙이면 지울 행을 backups/에 JSON으로 먼저 저장한 뒤 지운다.
//   npm run purge:token-burn            # 개수 확인
//   npm run purge:token-burn -- --apply # 백업 후 삭제
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes("--apply");

async function main() {
  const fakeRows = await pool.query(
    `SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.intent = 'token_burn_test' OR a.verification_detail->>'source' = 'token_burn'
      ORDER BY a.id`,
  );
  const touchedUsers = await pool.query(
    `SELECT id, name, token_quota, token_used, token_remaining, last_token_burn_at FROM users
      WHERE token_quota <> 0 OR token_used <> 0 OR token_remaining <> 0 OR last_token_burn_at IS NOT NULL
      ORDER BY id`,
  );
  const perStudent = new Map<string, number>();
  for (const r of fakeRows.rows) perStudent.set(r.user_name ?? "(없음)", (perStudent.get(r.user_name ?? "(없음)") ?? 0) + 1);

  console.log(`가짜 audit_log 행: ${fakeRows.rows.length}개 (학생 ${perStudent.size}명)`);
  console.log(`토큰 값이 남은 계정: ${touchedUsers.rows.length}개`);

  if (!apply) {
    console.log("dry-run — 실제로 지우려면 --apply");
    await pool.end();
    return;
  }

  const backupDir = path.join(__dirname, "../../backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `token-burn-purge-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify({ auditLog: fakeRows.rows, users: touchedUsers.rows }, null, 2), {
    mode: 0o600,
  });
  console.log(`백업: ${backupPath}`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const del = await client.query("DELETE FROM audit_log WHERE id = ANY($1::int[])", [
      fakeRows.rows.map((r) => r.id),
    ]);
    const upd = await client.query(
      `UPDATE users SET token_quota = 0, token_used = 0, token_remaining = 0, last_token_burn_at = NULL
        WHERE id = ANY($1::int[])`,
      [touchedUsers.rows.map((r) => r.id)],
    );
    await client.query("COMMIT");
    console.log(`삭제한 audit_log 행: ${del.rowCount}, 초기화한 계정: ${upd.rowCount}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
