import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { startTestDb, type TestDb } from "../../../test/pgTestDb.js";

// 2026-10-14 보안 감사에서 나온 문제들이 다시 생기지 않게 고정해 두는 테스트.
const testDb: TestDb = await startTestDb();
const { pool } = await import("../../../infrastructure/db/pool.js");
const exam = await import("./examService.js");
const { getStudentReport, getWrongAnswers } = await import(
	"./studentReport.js"
);
const { createLimiter } = await import("../../auth/rateLimit.js");
const { officialExamLockdown } = await import("./officialLockdown.js");

after(async () => {
	await pool.end();
	await testDb.stop();
});

let student = 0;
let other = 0;
let qids: number[] = [];

beforeEach(async () => {
	await testDb.reset();
	const { rows } = await pool.query<{ id: number }>(
		"INSERT INTO users (email, password_hash, name, role) VALUES ('a@t','x','a','student'), ('b@t','x','b','student') RETURNING id",
	);
	[student, other] = rows.map((r) => r.id);
	qids = [];
	for (let i = 0; i < 3; i++) {
		const { rows: q } = await pool.query<{ id: number }>(
			`INSERT INTO exam_questions (source, subject, stem, question_type, choices, correct_index, max_score, explanation, status)
       VALUES ('past_exam', '2과목_TCP_IP', $1, 'multiple_choice', '["A","B","C","D"]', 0, 1, '해설', 'approved') RETURNING id`,
			[`q${i}`],
		);
		qids.push(q[0].id);
	}
});

async function timedExam(endInMinutes: number | null = 60) {
	const { rows } = await pool.query<{ id: number }>(
		`INSERT INTO exam_sets (kind, title, duration_minutes, question_ids, scheduled_start, scheduled_end, is_published)
     VALUES ('admin_timed', '지정', 30, $1, now() - interval '1 minute', $2, true) RETURNING id`,
		[
			qids,
			endInMinutes === null
				? null
				: new Date(Date.now() + endInMinutes * 60_000),
		],
	);
	return rows[0].id;
}

test("지정 시험을 동시에 두 번 시작해도 응시는 하나만 생긴다", async () => {
	const setId = await timedExam();
	const [a, b] = await Promise.all([
		exam.createAttempt({
			userId: student,
			kind: "admin_timed",
			examSetId: setId,
		}),
		exam.createAttempt({
			userId: student,
			kind: "admin_timed",
			examSetId: setId,
		}),
	]);
	assert.equal(a.attemptId, b.attemptId);
	const { rows } = await pool.query(
		"SELECT id FROM exam_attempts WHERE user_id = $1 AND exam_set_id = $2",
		[student, setId],
	);
	assert.equal(rows.length, 1);
});

test("지정 시험 마감은 응시 기간 끝을 넘지 않는다", async () => {
	const setId = await timedExam(5); // 제한 30분이지만 기간이 5분 남음
	const a = await exam.createAttempt({
		userId: student,
		kind: "admin_timed",
		examSetId: setId,
	});
	const att = (await exam.getAttempt(a.attemptId))!;
	assert.ok(exam.attemptDeadline(att)! <= Date.now() + 5 * 60_000 + 1000);
});

test("지정 시험은 응시 기간이 끝나기 전까지 문제별 정답·해설을 내주지 않는다", async () => {
	const setId = await timedExam();
	const a = await exam.createAttempt({
		userId: student,
		kind: "admin_timed",
		examSetId: setId,
	});
	await exam.submitAttempt(a.attemptId, student);
	const r = await exam.getAttemptResults(a.attemptId, student);
	assert.deepEqual(r?.items, []);
	assert.ok(r?.itemsHiddenUntil);
});

test("진행 중인 시험의 채점 결과는 학습 리포트에 잡히지 않는다(정답 확인 오라클)", async () => {
	const setId = await timedExam();
	const a = await exam.createAttempt({
		userId: student,
		kind: "admin_timed",
		examSetId: setId,
	});
	const att = (await exam.getAttempt(a.attemptId))!;
	const order = att.choice_order[String(qids[0])];
	await exam.submitAnswer({
		attemptId: a.attemptId,
		userId: student,
		questionId: qids[0],
		selectedDisplayIndex: order.indexOf(0),
	});
	const report = await getStudentReport(student);
	assert.equal(report.totalAnswered, 0);
	assert.equal(report.bySubject.length, 0);
});

test("응시 기간 중인 지정 시험 문제는 다른 학생의 오답노트·기출 회차·연습에서 잠긴다", async () => {
	await timedExam();
	const locked = await exam.lockedQuestionIdsForUser(other);
	for (const q of qids) assert.ok(locked.has(q));
	await assert.rejects(
		exam.createAttempt({
			userId: other,
			kind: "practice_custom",
			questionIds: [qids[0]],
		}),
	);
	assert.deepEqual(await getWrongAnswers(other), []);
});

test("지정 시험 응시 중에는 AI 튜터 등 다른 API가 막히고, 그 시험 API는 열려 있다", async () => {
	const setId = await timedExam();
	const a = await exam.createAttempt({
		userId: student,
		kind: "admin_timed",
		examSetId: setId,
	});
	const call = async (path: string) => {
		let status = 200;
		let passed = false;
		const res = {
			status(c: number) {
				status = c;
				return this;
			},
			json() {
				return this;
			},
		};
		await officialExamLockdown(
			{ user: { id: student, role: "student" }, path } as never,
			res as never,
			() => {
				passed = true;
			},
		);
		return passed ? 200 : status;
	};
	assert.equal(await call("/ask"), 423);
	assert.equal(await call(`/exam/attempts/${a.attemptId}/answer`), 200);
	assert.equal(await call(`/exam/timed/${setId}/start`), 200);
});

test("요청 제한기", () => {
	const l = createLimiter([{ windowMs: 60_000, max: 2 }]);
	assert.equal(l.hit("u").ok, true);
	assert.equal(l.hit("u").ok, true);
	const third = l.hit("u");
	assert.equal(third.ok, false);
	assert.equal(l.hit("other").ok, true);
});
