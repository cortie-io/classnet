import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startTestDb, type TestDb } from "../../../test/pgTestDb.js";

// 풀다 만 응시 이어 풀기 · 기출 회차 내 기록 · "안 푼 문제 먼저" 연습 (2026-10-23)
const testDb: TestDb = await startTestDb();
const { pool } = await import("../../../infrastructure/db/pool.js");
const { createAttempt, submitAnswer, submitAttempt, resumeOwnAttempt, listPastRoundProgress } =
	await import("./examService.js");

after(async () => {
	await pool.end();
	await testDb.stop();
});

let student = 0;
let other = 0;
const round: number[] = [];
const extra: number[] = [];

before(async () => {
	await testDb.reset();
	const { rows } = await pool.query<{ id: number }>(
		"INSERT INTO users (email, password_hash, name, role) VALUES ('s@t','x','s','student'), ('o@t','x','o','student') RETURNING id",
	);
	[student, other] = rows.map((r) => r.id);
	for (let i = 1; i <= 3; i++) {
		const r = await pool.query<{ id: number }>(
			`INSERT INTO exam_questions (source, source_detail, subject, stem, question_type, choices, correct_index, max_score, explanation, status)
       VALUES ('past_exam', $1, '1과목_네트워크_일반', $2, 'multiple_choice', '["A","B","C","D"]', 0, 1, '해설', 'approved') RETURNING id`,
			[JSON.stringify({ roundLabel: "2024-05-12", year: "2024", month: "05", day: "12", qnum: i }), `기출 ${i}`],
		);
		round.push(r.rows[0].id);
	}
	for (let i = 0; i < 4; i++) {
		const r = await pool.query<{ id: number }>(
			`INSERT INTO exam_questions (source, subject, stem, question_type, choices, correct_index, max_score, explanation, status)
       VALUES ('ai_generated', '2과목_TCP_IP', $1, 'multiple_choice', '["A","B","C","D"]', 0, 1, '해설', 'approved') RETURNING id`,
			[`연습 ${i}`],
		);
		extra.push(r.rows[0].id);
	}
});

test("같은 기출 회차를 다시 열면 풀다 만 응시와 고른 답을 이어서 준다", async () => {
	const first = await createAttempt({ userId: student, kind: "past_exam_round", roundLabel: "2024-05-12" });
	assert.equal(first.resumed, undefined);
	await submitAnswer({ attemptId: first.attemptId, userId: student, questionId: round[1], selectedDisplayIndex: 2 });

	const again = await createAttempt({ userId: student, kind: "past_exam_round", roundLabel: "2024-05-12" });
	assert.equal(again.resumed, true);
	assert.equal(again.attemptId, first.attemptId);
	assert.deepEqual(Object.keys(again.savedAnswers ?? {}).map(Number), [round[1]]);

	const fresh = await createAttempt({ userId: student, kind: "past_exam_round", roundLabel: "2024-05-12", fresh: true });
	assert.notEqual(fresh.attemptId, first.attemptId);
});

test("이어 풀기는 본인의 진행 중 응시만", async () => {
	const a = await createAttempt({ userId: student, kind: "practice_custom", questionIds: [extra[0]] });
	await assert.rejects(resumeOwnAttempt(other, a.attemptId), /찾을 수 없습니다/);
	const r = await resumeOwnAttempt(student, a.attemptId);
	assert.equal(r.attemptId, a.attemptId);
	await submitAttempt(a.attemptId, student);
	await assert.rejects(resumeOwnAttempt(student, a.attemptId), /이미 제출/);
});

test("기출 회차 내 기록: 이어 풀 응시와 마지막·최고 점수", async () => {
	const p = await listPastRoundProgress(student);
	const r = p.find((x) => x.roundLabel === "2024-05-12");
	assert.ok(r?.inProgress);
	assert.equal(r.timesSubmitted, 0);
	await submitAnswer({ attemptId: r.inProgress.attemptId, userId: student, questionId: round[0], selectedDisplayIndex: 0 });
	await submitAttempt(r.inProgress.attemptId, student);
	const after = (await listPastRoundProgress(student)).find((x) => x.roundLabel === "2024-05-12");
	assert.equal(after?.timesSubmitted, 1);
	assert.equal(after?.last?.total, 3);
	assert.ok(after?.inProgress); // 처음 연 응시(첫 테스트)가 아직 진행 중
});

test("안 푼 문제 먼저: 이미 푼 문제는 안 푼 게 모자랄 때만", async () => {
	const subject = "2과목_TCP_IP";
	const a = await createAttempt({ userId: other, kind: "practice_custom", subject, count: 2 });
	for (const q of a.questions) await submitAnswer({ attemptId: a.attemptId, userId: other, questionId: q.questionId, selectedDisplayIndex: 0 });
	await submitAttempt(a.attemptId, other);
	const seen = new Set(a.questions.map((q) => q.questionId));

	const b = await createAttempt({ userId: other, kind: "practice_custom", subject, count: 2, unseenFirst: true });
	assert.ok(b.questions.every((q) => !seen.has(q.questionId)));

	const c = await createAttempt({ userId: other, kind: "practice_custom", subject, count: 4, unseenFirst: true });
	assert.equal(c.questions.length, 4); // 안 푼 게 모자라면 푼 문제로 채운다
});
