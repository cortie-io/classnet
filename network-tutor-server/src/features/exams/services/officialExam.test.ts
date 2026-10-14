import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { startTestDb, type TestDb } from "../../../test/pgTestDb.js";

const testDb: TestDb = await startTestDb();
const { pool } = await import("../../../infrastructure/db/pool.js");
const official = await import("./officialExam.js");
const exam = await import("./examService.js");
const { getWrongAnswers } = await import("./studentReport.js");
const { officialExamLockdown } = await import("./officialLockdown.js");

after(async () => {
	await pool.end();
	await testDb.stop();
});

let adminId = 0;
let alice = 0;
let bob = 0;
let carol = 0;
let questionIds: number[] = [];

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

beforeEach(async () => {
	await testDb.reset();
	const { rows: users } = await pool.query<{ id: number }>(
		`INSERT INTO users (email, password_hash, name, role, student_id) VALUES
       ('t@test', 'x', '선생님', 'admin', NULL), ('a@test', 'x', '앨리스', 'student', '1'),
       ('b@test', 'x', '밥', 'student', '2'), ('c@test', 'x', '캐럴', 'student', '3') RETURNING id`,
	);
	[adminId, alice, bob, carol] = users.map((u) => u.id);
	questionIds = [];
	for (let i = 0; i < 4; i++) {
		const { rows } = await pool.query<{ id: number }>(
			`INSERT INTO exam_questions (source, subject, stem, question_type, choices, correct_index, max_score, explanation, status)
       VALUES ('past_exam', '2과목_TCP_IP', $1, 'multiple_choice', '["A","B","C","D"]', 0, 1, '해설', 'approved') RETURNING id`,
			[`문제 ${i + 1}`],
		);
		questionIds.push(rows[0].id);
	}
});

async function openExam(
	opts: {
		start?: number;
		end?: number;
		duration?: number;
		maxViolations?: number;
	} = {},
) {
	const { id } = await official.createOfficialExam(adminId, {
		title: "1차 공식 모의시험",
		durationMinutes: opts.duration ?? 60,
		scheduledStart: minutes(opts.start ?? -5),
		scheduledEnd: minutes(opts.end ?? 120),
		questionIds,
		maxViolations: opts.maxViolations ?? 3,
	});
	await official.setPublished(id, true);
	return id;
}

/** 학생이 화면에서 고른 보기를 원래 정답(0번)으로 맞춘다 — 보기 순서가 학생마다 섞여 있다. */
async function answerCorrectly(
	userId: number,
	attemptId: number,
	token: string,
	questionId: number,
	correct: boolean,
) {
	const attempt = (await exam.getAttempt(attemptId))!;
	const order = attempt.choice_order[String(questionId)];
	const display = order.indexOf(correct ? 0 : 1);
	return official.answerOfficial(userId, attemptId, token, {
		questionId,
		selectedIndex: display,
	});
}

test("입력 검증 — 기간이 거꾸로이거나 없는 문항이면 만들 수 없다", async () => {
	await assert.rejects(
		official.createOfficialExam(adminId, {
			title: "x",
			durationMinutes: 60,
			scheduledStart: minutes(10),
			scheduledEnd: minutes(5),
			questionIds,
		}),
		/시작 시각은 마감 시각보다 이전/,
	);
	await assert.rejects(
		official.createOfficialExam(adminId, {
			title: "x",
			durationMinutes: 60,
			scheduledStart: minutes(1),
			scheduledEnd: minutes(5),
			questionIds: [999999],
		}),
		/승인되지 않았거나 없는 문항/,
	);
	await assert.rejects(
		official.createOfficialExam(adminId, {
			title: "",
			durationMinutes: 60,
			scheduledStart: minutes(1),
			scheduledEnd: minutes(5),
			questionIds,
		}),
		/시험 이름/,
	);
});

test("응시 기간 전·공개 전에는 시작할 수 없다", async () => {
	const { id } = await official.createOfficialExam(adminId, {
		title: "x",
		durationMinutes: 60,
		scheduledStart: minutes(-5),
		scheduledEnd: minutes(60),
		questionIds,
	});
	await assert.rejects(
		official.startOfficialExam(alice, id, undefined, {}),
		/찾을 수 없습니다/,
	); // 비공개
	const later = await openExam({ start: 30, end: 90 });
	await assert.rejects(
		official.startOfficialExam(alice, later, undefined, {}),
		/아직 응시 기간이 아닙니다/,
	);
});

test("시작 응답에는 정답·해설이 없고, 마감은 응시 기간 끝을 넘지 않는다", async () => {
	const id = await openExam({ end: 30, duration: 60 });
	const start = await official.startOfficialExam(alice, id, undefined, {});
	assert.ok(start.deviceToken);
	assert.equal(start.questions.length, 4);
	const json = JSON.stringify(start);
	assert.doesNotMatch(json, /correct|explanation|해설/);
	const deadline = new Date(start.deadlineAt).getTime();
	assert.ok(
		deadline <= Date.now() + 30 * 60_000 + 1000,
		"마감은 응시 기간 끝(30분 뒤)을 넘으면 안 된다",
	);
});

test("다른 기기(토큰 없음)에서는 이어 풀 수 없고, 같은 기기는 이어 푼다", async () => {
	const id = await openExam();
	const first = await official.startOfficialExam(alice, id, undefined, {});
	await assert.rejects(
		official.startOfficialExam(alice, id, undefined, {}),
		/처음 시작한 기기/,
	);
	await assert.rejects(
		official.startOfficialExam(alice, id, "wrong-token-xxxxxxxxxxxxxxxx", {}),
		/처음 시작한 기기/,
	);
	const resumed = await official.startOfficialExam(
		alice,
		id,
		first.deviceToken,
		{},
	);
	assert.equal(resumed.attemptId, first.attemptId);
	assert.equal(resumed.deviceToken, undefined);
	// 답 저장도 토큰이 있어야 한다.
	await assert.rejects(
		official.answerOfficial(alice, first.attemptId, undefined, {
			questionId: questionIds[0],
			selectedIndex: 0,
		}),
		/처음 시작한 기기/,
	);
	// 다른 기기 시도는 검토 대상으로 남는다.
	const attempt = (await exam.getAttempt(first.attemptId))!;
	assert.equal(attempt.flagged_for_review, true);
	// 관리자가 잠금을 풀면 새 기기에 새 토큰이 나간다.
	await official.resetDeviceLock(id, first.attemptId, adminId);
	const moved = await official.startOfficialExam(alice, id, undefined, {});
	assert.ok(moved.deviceToken && moved.deviceToken !== first.deviceToken);
});

test("일반 시험 API로는 공식 시험 답을 저장·제출할 수 없다", async () => {
	const id = await openExam();
	const s = await official.startOfficialExam(alice, id, undefined, {});
	await assert.rejects(
		exam.submitAnswer({
			attemptId: s.attemptId,
			userId: alice,
			questionId: questionIds[0],
			selectedDisplayIndex: 0,
		}),
		/공식 모의시험 화면에서만/,
	);
	await assert.rejects(
		exam.submitAttempt(s.attemptId, alice),
		/공식 모의시험 화면에서만/,
	);
});

test("응시 중에는 시험 API 말고는 전부 막힌다", async () => {
	const id = await openExam();
	await official.startOfficialExam(alice, id, undefined, {});
	const call = async (path: string, userId: number) => {
		let status = 200;
		let nextCalled = false;
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
			{ user: { id: userId, role: "student" }, path } as never,
			res as never,
			() => {
				nextCalled = true;
			},
		);
		return nextCalled ? 200 : status;
	};
	assert.equal(await call("/ask", alice), 423);
	assert.equal(await call("/exam/bank", alice), 423);
	assert.equal(await call("/exam/questions/1/explain", alice), 423);
	assert.equal(await call("/official-exams/attempts/1/answer", alice), 200);
	assert.equal(await call("/auth/logout", alice), 200);
	assert.equal(await call("/ask", bob), 200); // 응시 중이 아닌 학생은 그대로
});

test("응시 기간 중에는 그 시험 문제가 모든 학생에게 잠긴다", async () => {
	await openExam();
	const lockedForBob = await exam.lockedQuestionIdsForUser(bob);
	for (const q of questionIds) assert.ok(lockedForBob.has(q));
	await assert.rejects(
		exam.createAttempt({
			userId: bob,
			kind: "practice_custom",
			questionIds: [questionIds[0]],
		}),
		/응시 중인 시험의 문제/,
	);
});

test("제출해도 결과는 공개 전까지 숨겨지고, 공개하면 점수·등수가 보인다", async () => {
	const id = await openExam();
	const a = await official.startOfficialExam(alice, id, undefined, {});
	const b = await official.startOfficialExam(bob, id, undefined, {});
	for (const q of questionIds)
		await answerCorrectly(alice, a.attemptId, a.deviceToken!, q, true);
	await answerCorrectly(bob, b.attemptId, b.deviceToken!, questionIds[0], true);
	await answerCorrectly(
		bob,
		b.attemptId,
		b.deviceToken!,
		questionIds[1],
		false,
	);
	const submitted = await official.submitOfficial(
		alice,
		a.attemptId,
		a.deviceToken!,
	);
	assert.deepEqual(submitted, { submitted: true }); // 제출 응답에도 점수·정답이 없다
	await official.submitOfficial(bob, b.attemptId, b.deviceToken!);

	const hidden = await official.resultForStudent(alice, id);
	assert.equal(hidden.released, false);
	assert.doesNotMatch(JSON.stringify(hidden), /score|items/);
	const generic = await exam.getAttemptResults(a.attemptId, alice);
	assert.equal(generic?.score, null);
	assert.deepEqual(generic?.items, []);

	await official.setRelease(id, { results: true, rank: false });
	const shown = await official.resultForStudent(alice, id);
	assert.equal(shown.released, true);
	if (!shown.released) return;
	assert.equal(shown.score, 100);
	assert.equal(shown.rank, null);

	await official.setRelease(id, { results: true, rank: true });
	const ranked = await official.resultForStudent(bob, id);
	assert.ok(ranked.released && ranked.rank);
	if (ranked.released)
		assert.deepEqual(ranked.rank, { rank: 2, participants: 2 });

	// 관리자 화면: 전체 학생 명단, 미응시 포함, 등수.
	const detail = await official.officialExamDetailAdmin(id);
	const byName = Object.fromEntries(detail.roster.map((r) => [r.name, r]));
	assert.equal(byName.앨리스.rank, 1);
	assert.equal(byName.밥.rank, 2);
	assert.equal(byName.캐럴.status, "not_started");
	assert.equal(detail.stats.submittedCount, 2);
});

test("한 번 제출하면 다시 응시할 수 없다(관리자가 무효 처리하면 다시 가능)", async () => {
	const id = await openExam();
	const a = await official.startOfficialExam(alice, id, undefined, {});
	await official.submitOfficial(alice, a.attemptId, a.deviceToken!);
	await assert.rejects(
		official.startOfficialExam(alice, id, a.deviceToken, {}),
		/이미 응시를 마친/,
	);
	await official.invalidateAttempt(id, a.attemptId, adminId);
	const again = await official.startOfficialExam(alice, id, undefined, {});
	assert.notEqual(again.attemptId, a.attemptId);
});

test("위반이 정해진 횟수에 닿으면 서버가 자동 제출한다", async () => {
	const id = await openExam({ maxViolations: 2 });
	const a = await official.startOfficialExam(alice, id, undefined, {});
	const first = await official.proctorEventOfficial(
		alice,
		a.attemptId,
		a.deviceToken!,
		{ eventType: "tab_hidden" },
	);
	assert.equal(first.autoSubmitted, false);
	// 복사 시도는 기록만 하고 위반으로 세지 않는다.
	await official.proctorEventOfficial(alice, a.attemptId, a.deviceToken!, {
		eventType: "copy",
	});
	const second = await official.proctorEventOfficial(
		alice,
		a.attemptId,
		a.deviceToken!,
		{ eventType: "fullscreen_exit" },
	);
	assert.equal(second.autoSubmitted, true);
	assert.equal((await exam.getAttempt(a.attemptId))!.status, "auto_submitted");
	// 화면이 서버 전용 이벤트를 지어낼 수 없다.
	const b = await official.startOfficialExam(bob, id, undefined, {});
	await assert.rejects(
		official.proctorEventOfficial(bob, b.attemptId, b.deviceToken!, {
			eventType: "heartbeat_gap",
		}),
		/알 수 없는 이벤트/,
	);
});

test("공식 시험은 오답노트·응시 기록에 섞이지 않는다", async () => {
	const id = await openExam();
	const a = await official.startOfficialExam(alice, id, undefined, {});
	await answerCorrectly(
		alice,
		a.attemptId,
		a.deviceToken!,
		questionIds[0],
		false,
	);
	await official.submitOfficial(alice, a.attemptId, a.deviceToken!);
	await official.setRelease(id, { results: true });
	assert.deepEqual(await getWrongAnswers(alice), []);
	assert.deepEqual(await exam.listMyAttempts(alice), []);
});

test("시험 전용으로 낸 문제는 공식 시험에서만 나온다", async () => {
	const { id: qid } = await official.createExamOnlyQuestion({
		subject: "2과목_TCP_IP",
		stem: "전용 문제",
		choices: ["가", "나", "다", "라"],
		correctIndex: 2,
		explanation: "해설",
	});
	const plain = await exam.fetchApprovedQuestions([qid]);
	assert.equal(plain.size, 0);
	questionIds = [qid];
	const id = await openExam();
	const s = await official.startOfficialExam(carol, id, undefined, {});
	assert.equal(s.questions[0].stem, "전용 문제");
});
