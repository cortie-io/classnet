import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { startTestDb, type TestDb } from "../../../test/pgTestDb.js";
import {
	chatCompletion,
	stubFetch,
	type FetchCall,
} from "../../../test/fetchStub.js";

// 질문 → 경로 선택 → 검색/계산/문제은행 → 감사 로그까지 실제 코드 그대로 돈다. 바깥으로 나가는 것은
// OpenAI 호출뿐이고, 그건 가짜 fetch가 대신 답한다(임베딩은 끄고 BM25만으로 검색).
const testDb: TestDb = await startTestDb();
const { config } = await import("../../../config.js");
config.openaiApiKey = "sk-test-not-real";
config.embedProvider = "none";
const { pool } = await import("../../../infrastructure/db/pool.js");
const { loadCorpus, getCorpus } = await import(
	"../../../infrastructure/search/corpus.js"
);
const { bm25Index } = await import(
	"../../../infrastructure/search/textIndex.js"
);
const { answerQuestion } = await import("./answerPipeline.js");

let userId = 0;
let llmCalls: FetchCall[] = [];
let restoreFetch: () => void = () => {};

// 가짜 OpenAI: 주제 해석·사실검증·답변 생성 요청을 프롬프트 내용으로 구분해 그럴듯한 응답을 준다.
function fakeOpenAi(call: FetchCall): Response {
	const body = call.body as { messages: { role: string; content: string }[] };
	const userText = body.messages.map((m) => m.content).join("\n");
	if (userText.includes("문제은행에서 연습문제를 찾아 달라고")) {
		return chatCompletion(
			JSON.stringify({
				topic: "서브넷 호스트 계산",
				keywords: ["호스트", "서브넷"],
				subject: null,
			}),
		);
	}
	if (userText.includes("팩트체커"))
		return chatCompletion(JSON.stringify({ grounded: true, reason: "ok" }));
	return chatCompletion("**답변** 테스트용 설명입니다.");
}

before(async () => {
	await testDb.reset();
	const u = await pool.query<{ id: number }>(
		"INSERT INTO users (email, password_hash, name, role, level) VALUES ('s@test', 'x', '학생', 'student', 'beginner') RETURNING id",
	);
	userId = u.rows[0].id;
	const node = (
		section: string,
		subject: string,
		category: string,
		topic: string,
		title: string,
		body: string,
		order: number,
	) =>
		pool.query<{ id: number }>(
			`INSERT INTO concept_nodes (subject, category, topic, tag_path, section_no, title, body_md, body_text, order_index)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8) RETURNING id`,
			[
				subject,
				category,
				topic,
				`${subject}/${category}/${topic}`,
				section,
				title,
				body,
				order,
			],
		);
	const ports = await node(
		"2.15",
		"2과목_TCP_IP",
		"전송_계층",
		"TCP_UDP_포트",
		"TCP/UDP 주요 포트 번호",
		"TCP와 UDP의 주요 포트 번호. HTTPS는 443, SNMP는 161과 162, FTP는 20과 21을 쓴다. 포트 번호 서비스 프로토콜",
		1,
	);
	await node(
		"2.12",
		"2과목_TCP_IP",
		"전송_계층",
		"TCP_vs_UDP",
		"TCP vs UDP 비교",
		"TCP는 연결 지향, 신뢰성 보장, 흐름 제어와 혼잡 제어를 한다. UDP는 비연결형으로 빠르다. TCP UDP 차이 비교",
		2,
	);
	await node(
		"4.3",
		"4과목_네트워크_운용기기",
		"RAID",
		"RAID_레벨",
		"RAID 레벨별 특징",
		"RAID 0은 스트라이핑, RAID 1은 미러링, RAID 5는 분산 패리티를 쓴다. RAID 레벨 디스크 패리티",
		3,
	);
	const rows = [
		{ 포트: "161", 서비스: "SNMP", 프로토콜: "UDP" },
		{ 포트: "162", 서비스: "SNMP Trap", 프로토콜: "UDP" },
		{ 포트: "443", 서비스: "HTTPS", 프로토콜: "TCP" },
	];
	for (const [i, r] of rows.entries()) {
		await pool.query(
			"INSERT INTO lookup_tables (node_id, table_name, row_order, row_data) VALUES ($1, 't2_2_15', $2, $3)",
			[ports.rows[0].id, i, JSON.stringify(r)],
		);
	}
	const q = (subject: string, stem: string) =>
		pool.query(
			`INSERT INTO exam_questions (source, subject, stem, question_type, choices, correct_index, max_score, explanation, status)
       VALUES ('past_exam', $1, $2, 'multiple_choice', '["가","나","다","라"]', 0, 1, '해설', 'approved')`,
			[subject, stem],
		);
	await q(
		"2과목_TCP_IP",
		"서브넷 마스크 255.255.255.224에서 사용 가능한 호스트 수는?",
	);
	await q(
		"2과목_TCP_IP",
		"C 클래스를 서브네팅할 때 서브넷 마스크로 옳은 것은?",
	);
	await q("2과목_TCP_IP", "서브넷 마스크가 /26일 때 서브넷 개수는?");
	await q("2과목_TCP_IP", "OSPF에 대한 설명으로 옳은 것은?");
	await q("1과목_네트워크_일반", "LAN과 WAN의 차이로 옳은 것은?");
	await q("1과목_네트워크_일반", "UTP 케이블 CAT6의 최대 속도는?");
	await loadCorpus();
	bm25Index.build(getCorpus());
});

beforeEach(() => {
	const stub = stubFetch((call) => fakeOpenAi(call));
	llmCalls = stub.calls;
	restoreFetch = stub.restore;
});

after(async () => {
	restoreFetch();
	// 백그라운드 사실검증이 감사 로그를 갱신할 시간을 준 뒤 닫는다.
	await new Promise((r) => setTimeout(r, 200));
	await pool.end();
	await testDb.stop();
});

const ctx = (history?: { role: "user" | "assistant"; content: string }[]) => ({
	userId,
	level: "beginner" as const,
	provider: { provider: "default" as const },
	history,
});

test("한글 주제의 문제 요청은 지문 키워드로 문제은행에서 찾는다(LLM 호출 없이)", async () => {
	const r = await answerQuestion("서브넷팅 문제 2개 내줘", ctx());
	restoreFetch();
	assert.equal(r.intent, "practice_request");
	assert.equal(r.practiceAttempt?.questions.length, 2);
	for (const q of r.practiceAttempt!.questions)
		assert.match(q.stem, /서브넷|서브네팅/);
	assert.match(
		r.answer,
		/\*\*서브넷팅\*\* 관련 실제 문제를 문제은행에서 2개 찾았어요/,
	);
	assert.equal(llmCalls.length, 0);
});

test("'다른 거 줘'는 직전 카드의 주제를 잇고 방금 보여 준 문제는 빼고 고른다", async () => {
	const first = await answerQuestion("서브넷 문제 2개 내줘", ctx());
	const shown = first.practiceAttempt!.questions.map((q) => q.questionId);
	const history = [
		{ role: "user" as const, content: "서브넷 문제 2개 내줘" },
		{
			role: "assistant" as const,
			content: `${first.answer}\n\n[문제은행에서 찾아준 문제 목록 · 연습 #${first.practiceAttempt!.attemptId}]\n1번 문제: …`,
		},
	];
	const next = await answerQuestion("다른 거 좀 줘", ctx(history));
	restoreFetch();
	assert.equal(next.intent, "practice_request");
	const again = next.practiceAttempt!.questions.map((q) => q.questionId);
	assert.ok(again.length >= 1);
	for (const id of again)
		assert.ok(!shown.includes(id), `이미 보여 준 문제 ${id}가 다시 나왔다`);
	assert.match(next.answer, /개 더 찾았어요/);
});

test("주제를 말로 풀어 쓴 요청은 LLM이 키워드로 바꿔 찾는다", async () => {
	const r = await answerQuestion("컴퓨터 몇 대 쓸 거다 이런 문제 내줘", ctx());
	restoreFetch();
	assert.equal(r.intent, "practice_request");
	assert.ok(
		r.practiceAttempt!.questions.some((q) => /호스트|서브넷/.test(q.stem)),
	);
	assert.match(r.answer, /서브넷 호스트 계산/);
});

test("과목만 말하면 그 과목 안에서 고른다", async () => {
	const r = await answerQuestion("네트워크 일반 문제 2개 줘", ctx());
	restoreFetch();
	assert.equal(r.practiceAttempt?.questions.length, 2);
	assert.ok(r.practiceAttempt!.questions.every((q) => /LAN|CAT6/.test(q.stem)));
});

test("포트 질문은 표 행을 정확한 값으로 넣되, 답은 일반 설명으로 만든다", async () => {
	const r = await answerQuestion("포트 443은 무슨 서비스야?", ctx());
	restoreFetch();
	assert.equal(r.intent, "lookup");
	const gen = llmCalls.find((c) =>
		JSON.stringify(c.body).includes("[학생 질문]"),
	);
	assert.ok(gen, "답변 생성 호출이 있어야 한다");
	const prompt = JSON.stringify(gen!.body);
	assert.match(prompt, /정확한 표 데이터/);
	assert.match(prompt, /HTTPS/);
	const exactBlock = prompt.slice(
		prompt.indexOf("[정확한 표 데이터"),
		prompt.indexOf("###"),
	);
	assert.match(exactBlock, /443, 서비스: HTTPS/);
	assert.doesNotMatch(exactBlock, /SNMP Trap/); // 162 행은 443 질문과 무관
	assert.doesNotMatch(prompt, /RAID/); // 단어 한두 개만 겹친 무관한 개념은 빠진다
	assert.match(prompt, /답을 거절하지 마세요/);
});

test("점수 이야기에 표 조회가 걸리지 않고, 출처도 붙지 않는다", async () => {
	const r = await answerQuestion(
		"오늘 필기 시험보고 왔는데 다행히 62점이야",
		ctx(),
	);
	restoreFetch();
	assert.equal(r.intent, "explain");
	assert.deepEqual(r.sources, []);
	assert.doesNotMatch(r.answer, /출처:/);
});

test("호스트 수 계산은 규칙엔진이 푼다", async () => {
	const r = await answerQuestion(
		"호스트 30개가 필요한 부서에 줄 수 있는 최소 서브넷 크기는?",
		ctx(),
	);
	restoreFetch();
	assert.equal(r.intent, "calc");
	assert.equal(r.calcTrace?.result.프리픽스, "/27");
});

test("붙여넣은 문제 해설 요청은 문제 카드가 아니라 설명으로 간다", async () => {
	const r = await answerQuestion(
		"이 문제 풀어줘: 다음 중 RAID 5에 대한 설명으로 옳은 것은? ① 미러링만 쓴다 ② 패리티를 분산 저장한다 ③ 디스크 1개로 된다 ④ 속도만 높인다",
		ctx(),
	);
	restoreFetch();
	assert.equal(r.intent, "explain");
	assert.equal(r.practiceAttempt, undefined);
	const gen = llmCalls.find((c) =>
		JSON.stringify(c.body).includes("[학생 질문]"),
	);
	assert.match(JSON.stringify(gen!.body), /정답: ②/); // 정답부터 밝히라는 지시
});
