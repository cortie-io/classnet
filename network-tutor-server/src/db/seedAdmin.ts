import { pool } from "./pool.js";
import { hashPassword } from "../auth/password.js";

// 회원가입이 없는 시스템이므로 최초 관리자 계정은 이 스크립트로 부트스트랩한다.
// 사용법: ADMIN_EMAIL=... ADMIN_PASSWORD=... ADMIN_NAME=... npx tsx src/db/seedAdmin.ts
async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@classnet.chat";
  const password = process.env.ADMIN_PASSWORD ?? "changeme123!";
  const name = process.env.ADMIN_NAME ?? "관리자";

  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) {
    console.log(`이미 존재하는 계정입니다: ${email}`);
    await pool.end();
    return;
  }
  const passwordHash = await hashPassword(password);
  await pool.query(
    "INSERT INTO users (role, name, email, password_hash, level) VALUES ('admin', $1, $2, $3, 'advanced')",
    [name, email, passwordHash],
  );
  console.log(`관리자 계정 생성 완료: ${email} / ${password} (반드시 로그인 후 비밀번호를 변경하세요)`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
