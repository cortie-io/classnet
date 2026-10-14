import { test } from "node:test";
import assert from "node:assert/strict";
import {
	requestedPracticeCount,
	routeQuestion,
	type RouterTurn,
} from "./intentRouter.js";

// 2026-09 audit_log에서 실제 학생이 보낸 문장들. 앞의 묶음은 전부 일반 설명으로 새서 LLM이 문제를
// 지어냈던 것, 뒤의 묶음은 문제 카드가 잘못 나갔던 것이다.
const PRACTICE = [
	"서브넷팅 문제를 내달라고",
	"서브넷마스크 문제 달라고",
	"서브넷마스크 문제도 내줘",
	"osi 7계층 문제 ㄱ",
	"문제 더 ㄱㄱ",
	"다른 문제 ㄱ",
	"네트워크 개요 문제를 달라고..",
	"네트워크 일반 문제 예시 보여줘",
	"실제 기출문제에서 내줘",
	"동일한 조건의 문제로 다시내줘",
	"이거랑 비슷한 유형의 문제 하나 만들어줄 수 있어?",
	"OSPF와 RIP의 개념을 융합한 문제를 만들어줘",
	"내가 교제를 보면서 너 문제를 풀어볼게, 네트워크 개요, 프로토콜, 정보통신 이론, 고속 LAN 및 광대역 기술 위주로 문제 ㄱㄱ",
	"osi 7계층 관련 문제",
	"관련 문제 뽑아줘",
	"네트워크 개요문제 10개 줘봐",
	"서브넷팅 문제 내줘",
	"문제줘",
	"OSPF 관련 문제 몇 개 제공해줘",
	"RAID 문제 좀 주세요",
	"퀴즈 내줘",
	"이거랑 비슷한 문제 하나만 더 내줘",
	"제로트러스트 보안 모델 관련 문제를 만들어줘",
];

const ANSWER = [
	"서브넷 마스크 관련 문제인데 마지막 숫자를 간단하게 계산하는 방법이 있을까?",
	"이 문제 답 알려줘: 정답은 뭐야?",
	"시험 문제중에 답을 외울수 있는 문제 알려줘",
	"문제에서 공식처럼 뭐뭐뭐 나오면 무조건 답은 뭐뭐다 같은거",
	"TCP/IP문제는 총 몇개가 출제되?",
	"32비트 ipv4인건 문제 지문뭘 보고 알수있는건데?",
	"근데 윈도우 2000, 2007, 2008, 2000년대 서버 문제는 이제 안나오지 않아?",
	"3번 문제 왜 답이 2번이야?",
	"이 문제 풀어줘: 다음 중 RAID 5에 대한 설명으로 옳은 것은? ① 최소 2개의 디스크로 구성 가능하다 ② 패리티 정보를 분산 저장한다",
	"문제 하나 풀어줘: 서브넷 마스크 255.255.255.224를 사용할 때 한 네트워크에서 사용 가능한 호스트 수는? ① 14 ② 30 ③ 62 ④ 126",
	"문제 내용이 이해가 안 돼",
	"기출문제 풀이 요령 알려줘",
	"네트워크관리사 문제 출제 경향 알려줘",
	"TCP와 UDP의 차이가 뭐야?",
	"오늘 필기 시험보고 왔는데 다행히 62점이야",
];

for (const q of PRACTICE) {
	test(`연습 요청: ${q}`, () => {
		assert.equal(routeQuestion(q).route, "practice_request");
	});
}

for (const q of ANSWER) {
	test(`설명 요청: ${q}`, () => {
		assert.equal(routeQuestion(q).route, "answer");
	});
}

test("사진이 붙은 메시지는 문제 요청 문구가 있어도 설명으로 보낸다", () => {
	assert.equal(
		routeQuestion("이거랑 비슷한 문제 내줘", { hasImage: true }).route,
		"answer",
	);
});

const afterCard: RouterTurn[] = [
	{ role: "user", content: "서브넷팅 문제 내줘" },
	{
		role: "assistant",
		content:
			"**서브넷** 관련 실제 문제를 문제은행에서 2개 찾았어요. 아래에서 바로 풀어보세요.\n\n[문제은행에서 찾아준 문제 목록]\n1번 문제: ...",
	},
];

for (const q of [
	"좀 같은문제말고 다른거 좀 줘",
	"더",
	"또 줘",
	"다른 거 없어?",
	"하나 더",
	"ㄱㄱ",
]) {
	test(`문제 카드 뒤 후속 요청: ${q}`, () => {
		const d = routeQuestion(q, { history: afterCard });
		assert.equal(d.route, "practice_request");
	});
}

for (const q of [
	"1번 왜 답이 3번이야?",
	"좀 더 자세히 설명해줘",
	"더 쉽게 알려줘",
	"고마워",
]) {
	test(`문제 카드 뒤지만 설명 요청: ${q}`, () => {
		assert.equal(routeQuestion(q, { history: afterCard }).route, "answer");
	});
}

test("문제 카드가 없던 대화의 '더 줘'는 연습 요청으로 보지 않는다", () => {
	const history: RouterTurn[] = [
		{ role: "user", content: "TCP와 UDP 차이" },
		{ role: "assistant", content: "TCP는 연결 지향…" },
	];
	assert.equal(routeQuestion("더 알려줘", { history }).route, "answer");
});

test("요청 개수", () => {
	assert.equal(requestedPracticeCount("서브넷 문제 3개 내줘"), 3);
	assert.equal(requestedPracticeCount("네트워크 개요문제 10개 줘봐"), 10);
	assert.equal(requestedPracticeCount("OSPF 문제 세 개만"), 3);
	assert.equal(requestedPracticeCount("관련 문제 몇 개 제공해줘"), 3);
	assert.equal(requestedPracticeCount("문제 하나 내줘"), 1);
	assert.equal(requestedPracticeCount("비슷한 문제 하나만 더"), 1);
	assert.equal(requestedPracticeCount("RAID 5 문제 내줘"), 2);
	assert.equal(requestedPracticeCount("IPv6 문제 4개"), 4);
	assert.equal(requestedPracticeCount("osi 7계층 관련 문제"), 2);
	assert.equal(requestedPracticeCount("문제 50개 줘"), 20);
});
