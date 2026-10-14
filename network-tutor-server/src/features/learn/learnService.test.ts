import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { startTestDb, type TestDb } from "../../test/pgTestDb.js";

const testDb: TestDb = await startTestDb();
const { pool } = await import("../../infrastructure/db/pool.js");
const exam = await import("../exams/services/examService.js");
const learn = await import("./learnService.js");

after(async () => {
	await pool.end();
	await testDb.stop();
});

let student = 0;
let other = 0;
let subnetQids: number[] = [];

beforeEach(async () => {
	await testDb.reset();
	const { rows } = await pool.query<{ id: number }>(
		"INSERT INTO users (email, password_hash, name, role) VALUES ('a@t','x','a','student'), ('b@t','x','b','student') RETURNING id",
	);
	[student, other] = rows.map((r) => r.id);
	subnetQids = [];
	const stems = [
		"다음 중 서브넷 마스크 255.255.255.192를 쓸 때 호스트 수는?",
		"서브네팅을 할 때 브로드캐스트 주소는?",
		"C 클래스를 서브넷 4개로 나눌 때 알맞은 마스크는?",
		"OSI 7계층 중 전송 계층의 역할은?",
		"TCP의 3-way 핸드셰이크 순서는?",
		"UDP 헤더의 크기는?",
		"ARP의 역할은?",
	];
	for (const stem of stems) {
		const { rows: q } = await pool.query<{ id: number }>(
			`INSERT INTO exam_questions (source, subject, stem, question_type, choices, correct_index, max_score, explanation, status)
       VALUES ('past_exam', '2과목_TCP_IP', $1, 'multiple_choice', '["A","B","C","D"]', 0, 1, '해설', 'approved') RETURNING id`,
			[stem],
		);
		if (stem.includes("서브넷") || stem.includes("서브네팅"))
			subnetQids.push(q[0].id);
	}
});

const quizInput = {
	slug: "tcpip-subnetting",
	subject: "2과목_TCP_IP",
	terms: ["서브넷", "서브네팅"],
	title: "서브넷 마스크와 서브네팅",
};

test("읽기 기록은 처음 읽은 시각을 지키고 마지막 시각만 바꾼다", async () => {
	const a = await learn.markRead(student, "net-osi-model");
	assert.ok(a.firstReadAt && a.lastReadAt);
	const b = await learn.markRead(student, "net-osi-model");
	assert.equal(b.firstReadAt, a.firstReadAt);
	const p = await learn.getProgress(student);
	assert.equal(p.lastSlug, "net-osi-model");
	assert.equal(p.lessons.length, 1);
	assert.equal((await learn.getProgress(other)).lessons.length, 0);
});

test("이상한 단원 이름은 받지 않는다", async () => {
	for (const bad of ["", "../etc", "A-B", "x".repeat(61), "a--b", 3]) {
		await assert.rejects(
			learn.markRead(student, bad as string),
			learn.LearnError,
		);
	}
});

test("확인 문제는 단원 주제어가 나오는 문제를 먼저 고르고, 모자라면 같은 과목으로 채운다", async () => {
	const r = await learn.startLessonQuiz(student, quizInput);
	const ids = r.questions.map((q) => q.questionId);
	assert.equal(ids.length, learn.LESSON_QUIZ_SIZE);
	for (const id of subnetQids)
		assert.ok(ids.includes(id), "주제어 문제가 빠짐");
	// 풀던 확인 문제가 있으면 새로 만들지 않고 이어 준다
	const again = await learn.startLessonQuiz(student, quizInput);
	assert.equal(again.attemptId, r.attemptId);
});

test("확인 문제 입력 검사", async () => {
	await assert.rejects(
		learn.startLessonQuiz(student, {
			...quizInput,
			subject: "5과목_정보보호개론",
		}),
		learn.LearnError,
	);
	await assert.rejects(
		learn.startLessonQuiz(student, { ...quizInput, terms: [] }),
		learn.LearnError,
	);
	await assert.rejects(
		learn.startLessonQuiz(student, { ...quizInput, terms: "서브넷" }),
		learn.LearnError,
	);
});

test("단원 완료는 제출한 확인 문제의 점수를 남기고, 남의 응시나 다른 단원 응시는 인정하지 않는다", async () => {
	const r = await learn.startLessonQuiz(student, quizInput);
	await assert.rejects(
		learn.markComplete(student, quizInput.slug, r.attemptId),
		/제출/,
	);
	const att = (await exam.getAttempt(r.attemptId))!;
	const first = r.questions[0].questionId;
	await exam.submitAnswer({
		attemptId: r.attemptId,
		userId: student,
		questionId: first,
		selectedDisplayIndex: att.choice_order[String(first)].indexOf(0),
	});
	await exam.submitAttempt(r.attemptId, student);
	await assert.rejects(
		learn.markComplete(other, quizInput.slug, r.attemptId),
		learn.LearnError,
	);
	await assert.rejects(
		learn.markComplete(student, "net-osi-model", r.attemptId),
		learn.LearnError,
	);
	const done = await learn.markComplete(student, quizInput.slug, r.attemptId);
	assert.ok(done.completedAt);
	assert.equal(done.quizCorrect, 1);
	assert.equal(done.quizTotal, learn.LESSON_QUIZ_SIZE);
	// 확인 문제 없는 단원도 끝낼 수 있다
	assert.ok(
		(await learn.markComplete(student, "start-exam-guide")).completedAt,
	);
	const overview = await learn.progressOverview();
	const me = overview.students.find((s) => s.userId === student)!;
	assert.equal(me.completed, 2);
	assert.equal(
		overview.lessons.find((l) => l.slug === quizInput.slug)?.completed,
		1,
	);
});
