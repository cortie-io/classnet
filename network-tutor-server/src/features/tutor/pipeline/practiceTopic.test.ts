import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { startTestDb, type TestDb } from "../../../test/pgTestDb.js";

// pool이 import되는 순간 DATABASE_URL을 읽으므로, 테스트 DB를 먼저 띄운 뒤 앱 모듈을 불러온다.
const testDb: TestDb = await startTestDb();
const topic = await import("./practiceTopic.js");
const { pool } = await import("../../../infrastructure/db/pool.js");

after(async () => {
	await pool.end();
	await testDb.stop();
});

test("문장에서 주제어만 뽑는다 — 조사·요청 표현·일반어는 버린다", () => {
	assert.deepEqual(topic.extractTopicTerms("서브넷팅 문제를 내달라고"), [
		"서브넷팅",
	]);
	assert.deepEqual(topic.extractTopicTerms("서브넷마스크 문제도 내줘"), [
		"서브넷마스크",
	]);
	assert.deepEqual(
		topic.extractTopicTerms("OSPF와 RIP의 개념을 융합한 문제를 만들어줘"),
		["OSPF", "RIP"],
	);
	assert.deepEqual(topic.extractTopicTerms("osi 7계층 관련 문제"), [
		"osi",
		"7계층",
	]);
	assert.deepEqual(topic.extractTopicTerms("TCP/IP 문제 3개 내줘"), ["TCP/IP"]);
	// 메뉴 이름("단계별 학습하기")은 주제어가 아니다
	assert.deepEqual(topic.extractTopicTerms("단계별 학습하기에 나온 서브넷 문제 3개 줘"), ["서브넷"]);
	assert.deepEqual(topic.extractTopicTerms("관련 문제 뽑아줘"), []);
	assert.deepEqual(topic.extractTopicTerms("문제 더 ㄱㄱ"), []);
	assert.deepEqual(
		topic.extractTopicTerms("이거랑 비슷한 유형의 문제 하나 만들어줄 수 있어?"),
		[],
	);
	assert.deepEqual(
		topic.extractTopicTerms("네트워크 개요 문제를 달라고.."),
		[],
	);
	assert.deepEqual(topic.extractTopicTerms("RAID 문제 좀 주세요"), ["RAID"]);
	assert.deepEqual(topic.extractTopicTerms("좀 같은문제말고 다른거 좀 줘"), []);
	assert.deepEqual(topic.extractTopicTerms("서브넷팅문제를 더 줘"), [
		"서브넷팅",
	]);
});

test("과목 이름(교재 단원명 포함)을 알아본다", () => {
	assert.equal(
		topic.detectSubject("네트워크 개요 문제를 달라고.."),
		"1과목_네트워크_일반",
	);
	assert.equal(
		topic.detectSubject("네트워크 일반 문제 예시 보여줘"),
		"1과목_네트워크_일반",
	);
	assert.equal(topic.detectSubject("3과목 문제 10개"), "3과목_NOS");
	assert.equal(topic.detectSubject("OSPF 문제 내줘"), null);
});

test("지문 검색 패턴 — 영문은 단어 경계, 한글은 띄어쓰기 무시", () => {
	assert.equal(topic.termPattern("AS"), "(^|[^A-Za-z0-9])AS($|[^A-Za-z0-9])");
	assert.equal(
		topic.termPattern("서브넷마스크"),
		"서\\s*브\\s*넷\\s*마\\s*스\\s*크",
	);
	assert.equal(topic.termPattern("802.11"), "8\\s*0\\s*2\\s*\\.\\s*1\\s*1");
	const t = topic.buildTopicTerms(["서브넷팅"]);
	assert.deepEqual(t.terms, ["서브넷팅"]);
	assert.equal(t.patterns.length, 3); // 서브넷팅, 서브넷, 서브네팅
});

test("직전 문제 카드의 주제와 응시 번호를 히스토리에서 읽는다", () => {
	const history = [
		{ role: "user", content: "서브넷팅 문제 내줘" },
		{
			role: "assistant",
			content:
				"**서브넷팅** 관련 실제 문제를 문제은행에서 2개 찾았어요.\n\n[문제은행에서 찾아준 문제 목록 · 연습 #42]\n1번 문제: …",
		},
	];
	assert.equal(topic.previousPracticeTopicLabel(history), "서브넷팅");
	assert.deepEqual(topic.previousPracticeAttemptIds(history), [42]);
	assert.equal(
		topic.previousPracticeTopicLabel([
			{ role: "assistant", content: "TCP는…" },
		]),
		null,
	);
});

let studentId = 0;
let otherStudentId = 0;

async function seed() {
	await testDb.reset();
	const u = await pool.query<{ id: number }>(
		`INSERT INTO users (email, password_hash, name, role) VALUES
       ('a@test', 'x', '학생A', 'student'), ('b@test', 'x', '학생B', 'student') RETURNING id`,
	);
	studentId = u.rows[0].id;
	otherStudentId = u.rows[1].id;
	const q = (subject: string, stem: string, choices: string[]) =>
		pool.query(
			`INSERT INTO exam_questions (source, subject, stem, question_type, choices, correct_index, max_score, explanation, status)
       VALUES ('past_exam', $1, $2, 'multiple_choice', $3, 0, 1, '해설', 'approved')`,
			[subject, stem, JSON.stringify(choices)],
		);
	await q(
		"2과목_TCP_IP",
		"다음 중 서브넷 마스크 255.255.255.224에서 사용 가능한 호스트 수는?",
		["14", "30", "62", "126"],
	); // 1
	await q("2과목_TCP_IP", "C 클래스를 서브네팅할 때 필요한 비트 수는?", [
		"1",
		"2",
		"3",
		"4",
	]); // 2
	await q("2과목_TCP_IP", "OSPF에 대한 설명으로 옳은 것은?", [
		"거리벡터",
		"링크상태",
		"RIP와 같다",
		"BGP",
	]); // 3
	await q("2과목_TCP_IP", "다음 중 라우팅 프로토콜이 아닌 것은?", [
		"RIP",
		"OSPF",
		"FTP",
		"BGP",
	]); // 4 (보기에만 OSPF)
	await q("2과목_TCP_IP", "Class B 주소의 기본 마스크는?", [
		"/8",
		"/16",
		"/24",
		"/32",
	]); // 5 ("AS"가 Class 안에 있음)
	await q("1과목_네트워크_일반", "LAN과 WAN의 차이로 옳은 것은?", [
		"가",
		"나",
		"다",
		"라",
	]); // 6
	await q("1과목_네트워크_일반", "UTP 케이블 CAT6의 최대 속도는?", [
		"가",
		"나",
		"다",
		"라",
	]); // 7
}

beforeEach(seed);

test("한글 주제어는 띄어쓰기가 달라도, 동의어까지 지문에서 찾는다", async () => {
	const { patterns } = topic.buildTopicTerms(["서브넷팅"]);
	const ids = await topic.searchBankByPatterns({
		userId: studentId,
		patterns,
		excludeIds: [],
		subject: null,
		limit: 5,
	});
	assert.deepEqual(ids.sort(), [1, 2]);
});

test("지문에 맞는 문제가 보기에만 맞는 문제보다 먼저 나온다", async () => {
	const { patterns } = topic.buildTopicTerms(["OSPF"]);
	const ids = await topic.searchBankByPatterns({
		userId: studentId,
		patterns,
		excludeIds: [],
		subject: null,
		limit: 2,
	});
	assert.deepEqual(ids, [3, 4]);
});

test("짧은 영문 약어는 다른 단어 안에 끼어 맞지 않는다", async () => {
	const { patterns } = topic.buildTopicTerms(["AS"]);
	const ids = await topic.searchBankByPatterns({
		userId: studentId,
		patterns,
		excludeIds: [],
		subject: null,
		limit: 5,
	});
	assert.deepEqual(ids, []);
});

test("이미 보여 준 문제는 빼고, 그 학생이 받아 본 적 없는 문제를 먼저 고른다", async () => {
	await pool.query(
		"INSERT INTO exam_attempts (user_id, question_ids) VALUES ($1, '{1}')",
		[studentId],
	);
	const { patterns } = topic.buildTopicTerms(["서브넷"]); // 동의어 "서브네팅"까지
	const first = await topic.searchBankByPatterns({
		userId: studentId,
		patterns,
		excludeIds: [],
		subject: null,
		limit: 1,
	});
	assert.deepEqual(first, [2]);
	const excluded = await topic.searchBankByPatterns({
		userId: studentId,
		patterns,
		excludeIds: [2],
		subject: null,
		limit: 5,
	});
	assert.deepEqual(excluded, [1]);
});

test("과목을 지정하면 그 과목 안에서만 찾는다", async () => {
	const ids = await topic.searchBankBySubject({
		userId: studentId,
		subject: "1과목_네트워크_일반",
		excludeIds: [],
		limit: 10,
	});
	assert.deepEqual(ids.sort(), [6, 7]);
});

test("다른 학생의 응시 번호로는 문제 목록을 읽을 수 없다", async () => {
	const { rows } = await pool.query<{ id: number }>(
		"INSERT INTO exam_attempts (user_id, question_ids) VALUES ($1, '{3,4}') RETURNING id",
		[otherStudentId],
	);
	assert.deepEqual(
		await topic.questionIdsOfAttempts(studentId, [rows[0].id]),
		[],
	);
	assert.deepEqual(
		await topic.questionIdsOfAttempts(otherStudentId, [rows[0].id]),
		[3, 4],
	);
});
