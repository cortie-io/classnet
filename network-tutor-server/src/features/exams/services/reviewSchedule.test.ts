import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startTestDb, type TestDb } from "../../../test/pgTestDb.js";

// 오답 복습 일정(reviewSchedule.ts): 틀림 → 다음 날, 틀린 뒤 1번 맞힘 → 3일 뒤, 2번 → 극복.
const testDb: TestDb = await startTestDb();
const { pool } = await import("../../../infrastructure/db/pool.js");
const {
	countStreak,
	getReviewEntries,
	getStudySummary,
	kstDate,
	pickDueQuestions,
	scheduleFor,
} = await import("./reviewSchedule.js");
const { getWrongAnswers } = await import("./studentReport.js");

after(async () => {
	await pool.end();
	await testDb.stop();
});

// 2026-10-23 15:00 KST
const NOW = new Date("2026-10-23T06:00:00Z");
const kst = (s: string) => new Date(`${s}+09:00`);

test("틀린 날 다음 날 0시(한국 시간)부터 복습 대상", () => {
	const lateWrong = kst("2026-10-22T23:30:00");
	const r = scheduleFor(
		{ lastWrongAt: lateWrong, lastAnsweredAt: lateWrong, correctAfterWrong: 0 },
		NOW,
	);
	assert.equal(r.state, "due");
	assert.equal(r.dueAt?.toISOString(), kst("2026-10-23T00:00:00").toISOString());

	const todayWrong = kst("2026-10-23T09:00:00");
	assert.equal(
		scheduleFor(
			{ lastWrongAt: todayWrong, lastAnsweredAt: todayWrong, correctAfterWrong: 0 },
			NOW,
		).state,
		"waiting",
	);
});

test("틀린 뒤 한 번 맞히면 3일 뒤 다시, 두 번이면 극복", () => {
	const wrong = kst("2026-10-18T10:00:00");
	const once = scheduleFor(
		{ lastWrongAt: wrong, lastAnsweredAt: kst("2026-10-21T10:00:00"), correctAfterWrong: 1 },
		NOW,
	);
	assert.equal(once.state, "waiting");
	assert.equal(once.dueAt?.toISOString(), kst("2026-10-24T00:00:00").toISOString());
	assert.equal(
		scheduleFor(
			{ lastWrongAt: wrong, lastAnsweredAt: kst("2026-10-20T10:00:00"), correctAfterWrong: 1 },
			NOW,
		).state,
		"due",
	);
	assert.deepEqual(
		scheduleFor(
			{ lastWrongAt: wrong, lastAnsweredAt: wrong, correctAfterWrong: 2 },
			NOW,
		),
		{ state: "mastered", dueAt: null },
	);
});

test("연속 학습일은 오늘(아직 안 했으면 어제)부터 거꾸로 센다", () => {
	const days = (...d: string[]) => new Set(d);
	assert.equal(countStreak(days("2026-10-23", "2026-10-22", "2026-10-21", "2026-10-19"), NOW), 3);
	assert.equal(countStreak(days("2026-10-22", "2026-10-21"), NOW), 2);
	assert.equal(countStreak(days("2026-10-21"), NOW), 0);
	assert.equal(kstDate(kst("2026-10-23T00:10:00")), "2026-10-23");
});

let student = 0;
let q: number[] = [];

async function answer(
	questionId: number,
	isCorrect: boolean,
	at: string,
	opts: { status?: string; official?: boolean; revealed?: boolean } = {},
) {
	const { rows } = await pool.query<{ id: number }>(
		`INSERT INTO exam_attempts (user_id, question_ids, started_at, submitted_at, status, is_official)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		[
			student,
			[questionId],
			kst(at),
			opts.status === "in_progress" ? null : kst(at),
			opts.status ?? "submitted",
			opts.official ?? false,
		],
	);
	await pool.query(
		`INSERT INTO exam_answers (attempt_id, question_id, selected_index, is_correct, answered_at, revealed_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
		[rows[0].id, questionId, isCorrect ? 0 : 1, isCorrect, kst(at), opts.revealed ? kst(at) : null],
	);
}

before(async () => {
	await testDb.reset();
	const { rows } = await pool.query<{ id: number }>(
		"INSERT INTO users (email, password_hash, name, role) VALUES ('r@t','x','r','student') RETURNING id",
	);
	student = rows[0].id;
	q = [];
	for (let i = 0; i < 6; i++) {
		const r = await pool.query<{ id: number }>(
			`INSERT INTO exam_questions (source, subject, stem, question_type, choices, correct_index, max_score, explanation, status)
       VALUES ('past_exam', '1과목_네트워크_일반', $1, 'multiple_choice', '["A","B","C","D"]', 0, 1, '해설', 'approved') RETURNING id`,
			[`문제 ${i}`],
		);
		q.push(r.rows[0].id);
	}
	await answer(q[0], false, "2026-10-20T10:00:00"); // 오래된 오답 → 복습
	await answer(q[0], false, "2026-10-21T10:00:00"); //   두 번 틀림
	await answer(q[1], false, "2026-10-19T10:00:00");
	await answer(q[1], true, "2026-10-21T10:00:00"); // 한 번 맞힘 → 10-24에 다시
	await answer(q[2], false, "2026-10-15T10:00:00");
	await answer(q[2], true, "2026-10-16T10:00:00");
	await answer(q[2], true, "2026-10-20T10:00:00"); // 극복
	await answer(q[3], false, "2026-10-23T09:00:00"); // 오늘 틀림 → 내일
	await answer(q[4], false, "2026-10-20T10:00:00", { official: true }); // 공식 시험은 세지 않음
	await answer(q[5], false, "2026-10-20T10:00:00", { status: "in_progress" }); // 공개 안 된 진행 중 답은 세지 않음
	await answer(q[5], true, "2026-10-22T10:00:00", { status: "in_progress", revealed: true });
});

test("풀이 기록으로 문제마다 복습 상태를 계산한다", async () => {
	const entries = await getReviewEntries(student, NOW);
	const by = new Map(entries.map((e) => [e.questionId, e]));
	assert.equal(entries.length, 4);
	assert.equal(by.get(q[0])?.state, "due");
	assert.equal(by.get(q[0])?.wrongCount, 2);
	assert.equal(by.get(q[1])?.state, "waiting");
	assert.equal(by.get(q[2])?.state, "mastered");
	assert.equal(by.get(q[3])?.state, "waiting");
	assert.equal(by.has(q[4]), false);
	assert.equal(by.has(q[5]), false);
	assert.deepEqual(pickDueQuestions(entries), [q[0]]);
});

test("오답노트는 문제마다 한 줄, 틀린 횟수와 복습 상태를 붙인다", async () => {
	const list = await getWrongAnswers(student);
	const ids = list.map((w) => w.questionId);
	assert.equal(new Set(ids).size, ids.length);
	const first = list.find((w) => w.questionId === q[0]);
	assert.equal(first?.wrongCount, 2);
	assert.equal(list.find((w) => w.questionId === q[2])?.reviewState, "mastered");
	assert.equal(ids[0], q[3]); // 가장 최근에 틀린 문제가 맨 위
});

test("홈 요약: 연속 학습일·오늘 푼 문제·복습 수", async () => {
	const s = await getStudySummary(student, NOW);
	assert.equal(s.studiedToday, true);
	assert.equal(s.todayAnswered, 1);
	assert.equal(s.todayCorrect, 0);
	assert.equal(s.streakDays, 5); // 10-19~23 (10-15·16은 끊겨서 안 셈)
	assert.deepEqual(
		{ due: s.review.dueCount, waiting: s.review.waitingCount, mastered: s.review.masteredCount },
		{ due: 1, waiting: 2, mastered: 1 },
	);
	assert.equal(s.review.nextDueAt?.toISOString(), kst("2026-10-24T00:00:00").toISOString());
});
