import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStudentCsv } from "./csv.js";
import { startTestDb } from "../../test/pgTestDb.js";

test("메일 열을 생략한 CSV와 빈 메일 값을 허용한다", () => {
  for (const csv of [
    "학번,이름,비밀번호\n1001,학생,abcdefgh",
    "학번,이름,메일,비밀번호\n1001,학생,  ,abcdefgh",
    "\uFEFFstudent_id,name,password\r\n1001,학생,abcdefgh",
  ]) {
    const result = parseStudentCsv(csv);
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].email, null);
  }
});

test("입력된 메일의 형식 검사와 소문자 변환은 유지한다", () => {
  assert.equal(parseStudentCsv("학번,이름,메일,비밀번호\n1001,학생,USER@SCHOOL.AC.KR,abcdefgh").rows[0].email, "user@school.ac.kr");
  assert.match(parseStudentCsv("학번,이름,메일,비밀번호\n1001,학생,invalid,abcdefgh").errors[0].message, /이메일 형식 오류/);
});

test("학번·이름·비밀번호 필수 검증과 비밀번호 길이를 유지한다", () => {
  assert.match(parseStudentCsv("이름,비밀번호\n학생,abcdefgh").errors[0].message, /필수 컬럼 누락/);
  assert.match(parseStudentCsv("학번,이름,비밀번호\n1001,,abcdefgh").errors[0].message, /필수 값/);
  assert.match(parseStudentCsv("학번,이름,비밀번호\n1001,학생,short").errors[0].message, /8자 이상/);
});

test("기존 DB에서 메일 필수 제약을 제거한 뒤 여러 학생을 메일 없이 저장한다", async () => {
  const db = await startTestDb();
  try {
    // 기존 운영 스키마와 동일한 NOT NULL 제약부터 시작해 전환 자체를 검증한다.
    await db.db.exec("ALTER TABLE users ALTER COLUMN email SET NOT NULL");
    const { readFileSync } = await import("node:fs");
    await db.db.exec(readFileSync(new URL("../../infrastructure/db/optionalStudentEmail.sql", import.meta.url), "utf8"));
    const parsed = parseStudentCsv("학번,이름,비밀번호\n1001,학생1,abcdefgh\n1002,학생2,abcdefgh");
    for (const row of parsed.rows) {
      await db.db.query("INSERT INTO users (student_id, name, email, password_hash) VALUES ($1,$2,$3,$4)", [row.studentId, row.name, row.email, "hash"]);
    }
    const result = await db.db.query<{ count: number }>("SELECT count(*)::int AS count FROM users WHERE email IS NULL");
    assert.equal(result.rows[0].count, 2);
    await db.db.exec("INSERT INTO users (student_id,name,email,password_hash) VALUES ('1003','학생3','same@school.ac.kr','hash')");
    await assert.rejects(db.db.exec("INSERT INTO users (student_id,name,email,password_hash) VALUES ('1004','학생4','same@school.ac.kr','hash')"), /unique/i);
  } finally {
    await db.stop();
  }
});
