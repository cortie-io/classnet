import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startTestDb, type TestDb } from "../../../test/pgTestDb.js";

// 2026-10-14 기출문제 과목 값 바로잡기(schema.sql 끝부분)가 기출만, 딱 한 번만 바꾸는지 고정한다.
const testDb: TestDb = await startTestDb();
const { pool } = await import("../../../infrastructure/db/pool.js");
const { MOCK_EXAM_DURATION_MINUTES, MOCK_EXAM_SUBJECT_DISTRIBUTION } =
	await import("./examService.js");

after(async () => {
	await pool.end();
	await testDb.stop();
});

const migrate = () =>
	pool.query(
		readFileSync(
			new URL("../../../infrastructure/db/schema.sql", import.meta.url),
			"utf8",
		),
	);

async function subjectsByStem() {
	const { rows } = await pool.query<{ stem: string; subject: string }>(
		"SELECT stem, subject FROM exam_questions",
	);
	return Object.fromEntries(rows.map((r) => [r.stem, r.subject]));
}

test("기출의 두 과목 값만 한 번 맞바꾸고, 마이그레이션을 다시 돌려도 되돌아가지 않는다", async () => {
	await testDb.reset(); // 예전 DB처럼 바로잡기 기록이 없는 상태
	const insert = (source: string, subject: string, stem: string) =>
		pool.query(
			`INSERT INTO exam_questions (source, subject, stem, question_type, choices, correct_index, max_score, explanation, status)
       VALUES ($1, $2, $3, 'multiple_choice', '["A","B","C","D"]', 0, 1, '해설', 'approved')`,
			[source, subject, stem],
		);
	await insert("past_exam", "1과목_네트워크_일반", "UDP 헤더의 크기는?");
	await insert("past_exam", "2과목_TCP_IP", "PCM의 과정은?");
	await insert("past_exam", "3과목_NOS", "chmod 755의 뜻은?");
	await insert(
		"ai_generated",
		"1과목_네트워크_일반",
		"섀넌 정리의 채널 용량은?",
	);
	await insert("ai_generated", "2과목_TCP_IP", "TCP 헤더의 플래그는?");

	await migrate();
	const once = await subjectsByStem();
	assert.equal(once["UDP 헤더의 크기는?"], "2과목_TCP_IP");
	assert.equal(once["PCM의 과정은?"], "1과목_네트워크_일반");
	assert.equal(once["chmod 755의 뜻은?"], "3과목_NOS");
	assert.equal(once["섀넌 정리의 채널 용량은?"], "1과목_네트워크_일반");
	assert.equal(once["TCP 헤더의 플래그는?"], "2과목_TCP_IP");

	await migrate();
	assert.deepEqual(await subjectsByStem(), once);
});

test("모의고사는 시행처 기준 50문항·50분", () => {
	assert.equal(MOCK_EXAM_DURATION_MINUTES, 50);
	assert.equal(
		Object.values(MOCK_EXAM_SUBJECT_DISTRIBUTION).reduce((a, b) => a + b, 0),
		50,
	);
	assert.equal(MOCK_EXAM_SUBJECT_DISTRIBUTION["2과목_TCP_IP"], 10);
	assert.equal(MOCK_EXAM_SUBJECT_DISTRIBUTION["1과목_네트워크_일반"], 17);
});
