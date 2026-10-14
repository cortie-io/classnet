import { pool } from "./pool.js";
import { hashPassword } from "../auth/password.js";

// 회원가입이 없는 시스템이므로 최초 관리자 계정은 이 스크립트로 부트스트랩한다.
// 사용법: ADMIN_EMAIL=... ADMIN_PASSWORD=... ADMIN_NAME=... npm run seed:admin
//   이미 있는 계정이면 기본은 건드리지 않는다. ADMIN_RESET=1 이면 비밀번호를 다시 설정하고
//   역할을 admin으로 되돌린다(관리자 비밀번호를 잊었거나 로그인이 안 될 때의 복구 경로).
async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "admin@classnet.chat").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? "관리자";
  const reset = process.env.ADMIN_RESET === "1";

  if (!password || password.length < 8) {
    throw new Error("ADMIN_PASSWORD(8자 이상)를 지정하세요 — 기본 비밀번호는 더 이상 쓰지 않습니다.");
  }

  const existing = await pool.query<{ id: number; role: string }>(
    "SELECT id, role FROM users WHERE lower(email) = $1",
    [email],
  );
  const passwordHash = await hashPassword(password);

  if (existing.rows.length > 0) {
    if (!reset) {
      console.log(`이미 존재하는 계정입니다: ${email} (비밀번호를 다시 설정하려면 ADMIN_RESET=1)`);
    } else {
      const { id, role } = existing.rows[0];
      await pool.query("UPDATE users SET password_hash = $1, role = 'admin', email = $2 WHERE id = $3", [
        passwordHash,
        email,
        id,
      ]);
      await pool.query("DELETE FROM sessions WHERE user_id = $1", [id]);
      console.log(`관리자 비밀번호 재설정 완료: ${email} (id ${id}, 이전 역할 ${role})`);
    }
    await pool.end();
    return;
  }

  await pool.query(
    "INSERT INTO users (role, name, email, password_hash, level) VALUES ('admin', $1, $2, $3, 'advanced')",
    [name, email, passwordHash],
  );
  console.log(`관리자 계정 생성 완료: ${email}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
