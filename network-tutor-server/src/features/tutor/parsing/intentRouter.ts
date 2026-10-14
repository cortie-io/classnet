// 학생 메시지를 어느 경로로 보낼지 정한다 — "문제은행에서 문제 찾아주기(practice_request)"인지, 일반 설명
// (계산·조회 지름길 포함)인지. 예전에는 정규식 한 줄(PRACTICE_TRIGGER_RE)이 전부였는데, 실제 학생들이 쓴
// 표현의 상당수를 놓쳤다(2026-09 audit_log 실측): "서브넷팅 문제를 내달라고", "서브넷마스크 문제도 내줘",
// "osi 7계층 문제 ㄱ", "문제 더 ㄱㄱ", "좀 같은문제말고 다른거 좀 줘", "네트워크 일반 문제 예시 보여줘",
// "실제 기출문제에서 내줘", "이거랑 비슷한 유형의 문제 하나 만들어줄 수 있어?" — 전부 일반 설명으로 새서
// LLM이 그 자리에서 검증 안 된 문제를 지어냈다. 반대로 "서브넷 마스크 관련 문제인데 마지막 숫자를 간단하게
// 계산하는 방법이 있을까?"는 질문인데 문제 카드가 나갔다.
// 그래서 (1) "문제/문항/퀴즈" 뒤에 요청 표현이 오는지를 조사·수량어를 건너뛰며 보고, (2) 특정 문제를
// 가리키며 해설을 구하거나("이 문제 해설해줘") 문제 이야기를 하며 질문하는 경우("~문제인데 방법이 있을까?")는
// 설명으로 돌리고, (3) 직전에 문제 카드를 준 대화에서 "다른 거 줘", "더 ㄱㄱ"처럼 짧게 이어 달라는 말은
// 주제를 이어받는 연습 요청으로 본다.

import { CHOICE_MARKER_RE } from "./practiceRequestExtractor.js";

export interface RouterTurn {
	role: "user" | "assistant";
	content: string;
}

export type RouteKind = "practice_request" | "answer";

export interface RouteDecision {
	route: RouteKind;
	/** practice_request일 때 — 직전 문제 카드의 주제를 이어받는 짧은 후속 요청("다른 거 줘")인지. */
	followUp: boolean;
	/** 판단 근거(감사 로그·테스트용). */
	reason: string;
}

// 문제를 가리키는 명사. "연습문제", "기출문제"처럼 붙여 쓴 경우도 끝의 "문제"로 잡힌다.
const NOUN = "(?:문제|문항|퀴즈|예제)";

// 명사와 요청 동사 사이에 끼어들 수 있는 조사·수량어·부사(공백을 모두 지운 문자열 기준).
// "문제를 내줘", "문제 3개만 줘", "문제도 좀 내줘", "기출문제에서 내줘", "문제로 다시 내줘", "문제 예시 보여줘".
const FILLER =
	"(?:들|를|을|도|만|좀|로|으로|에서|하나|한개|두개|세개|네개|다섯개|몇개|몇|\\d+개|\\d+문제|\\d+|더|다시|하나만|예시|몇문제|몇개만|한번|좀더|만좀|위주로|위주)*";

// 요청 동사(어간). "알려줘"는 일부러 뺐다 — "답을 외울 수 있는 문제 알려줘"처럼 요령을 묻는 말이 대부분이었다.
// "내"·"출제"는 뒤에 오는 글자로 걸러야 한다 — "문제 내용", "문제 출제 경향/범위"는 요청이 아니다.
const REQUEST_VERB =
	"(?:내(?!용|부|장|역)|뽑|줘|주세요|주실|주시|줄래|줄수|주라|주면|주고|줄게|달라|다오|제공|출제(?!경향|비율|범위|기준|빈도|유형|되|돼|됐|된|하는|한)|만들|생성|추천|보여|골라|가져|부탁|ㄱ|고고|풀어보|풀어볼|풀고싶|풀래|풀게|풀자|풀어봐|테스트)";

const NOUN_THEN_REQUEST = new RegExp(`${NOUN}${FILLER}${REQUEST_VERB}`);

// "관련 문제", "비슷한 문제", "다른 문제", "비슷한 유형의 문제" — 요청 동사 없이도("osi 7계층 관련 문제") 연습 요청이다.
const DESCRIPTOR_NOUN = new RegExp(
	`(?:관련된?|비슷한|유사한|연습|기출|예상|추가|다른|새로운|또다른|(?:비슷|유사|같은)한?(?:유형|종류|형식|조건)의?)${NOUN}`,
);

// 특정 문제를 가리키는 말 — "이 문제", "위 문제", "3번 문제", "방금 문제". 이런 문장에 해설·풀이 의도가
// 있으면 문제은행 검색이 아니라 그 문제를 설명해 달라는 것이다.
const REFERENT = new RegExp(
	`(?:이|위|아래|다음|방금|그|해당|저|앞|앞의|위의|\\d+번)${NOUN}`,
);
const EXPLAIN_WORDS =
	/해설|설명|풀이|답이|답은|답좀|답알려|정답|왜|틀렸|틀린|맞는|맞아|맞지|이해|뜻|의미|어떻게|헷갈/;
const SIMILARITY_WORDS =
	/비슷|유사|관련|같은유형|다른|추가|새로운|또|다시|더내|더줘|하나더/;

// "~문제인데 …방법이 있을까?", "기출문제 풀이 요령"처럼 문제 이야기를 하면서 묻는 질문의 표지.
const QUESTION_WORDS =
	/어떻게|방법|요령|팁|왜|무엇|뭐야|뭐가|뭔가|뭘|무슨|몇개가|몇문제가|어느|차이|알려|설명|외우|공부|나와|나오|출제되|출제돼|풀이/;

// 붙여넣은 실제 문제(보기·발문 포함)는 "이 문제를 설명해 달라"는 뜻이다.
const STEM_PHRASES =
	/다음\s*중|옳은\s*것은|옳지\s*않은\s*것은|올바른\s*것은|올바르지\s*않은|틀린\s*것은|해당하는\s*것은|아닌\s*것은|알맞은\s*것은/;
const NUMBERED_OPTION_LINE = /(^|\n)\s*(?:\d[.)]|[가-라][.)]|\(\d\))\s*\S/g;

// 이보다 긴 메시지는 대부분 문제 지문·해설 요청을 붙여넣은 합성 메시지다(오답노트 "전체 해설 생성" 등).
const MAX_PRACTICE_REQUEST_LENGTH = 160;

// 직전 튜터 답변이 문제은행 문제 카드였는지 — 웹(network-tutor-model.ts humanizeHistoryText)이 카드를
// "[문제은행에서 찾아준 문제 목록…]"으로 풀어 보내고, 답변 문구 자체도 아래 표현으로 시작한다.
const PRACTICE_CARD_MARKERS =
	/\[문제은행에서 찾아준 문제 목록|관련 실제 문제를 문제은행에서|AI가 새로 만들고 검증까지 통과한 문제/;

// 문제 카드 직후의 짧은 이어 달라는 말("다른 거 줘", "더 ㄱㄱ", "하나 더", "또 줘", "다른 거 없어?").
const FOLLOW_UP_WORDS =
	/다른|더|또|추가|다시|새로운|새거|새걸|계속|한번더|ㄱ|고고/;
const FOLLOW_UP_REQUEST =
	/줘|주세요|내줘|내봐|ㄱ|고고|부탁|있어|있나|없어|없나|가자|풀래|풀게/;
const BARE_FOLLOW_UP =
	/^(더|또|하나더|더더|계속|다음|다른거|다른것|ㄱ+|고고)[!?.~]*$/;
// "좀 더 자세히", "더 쉽게"는 방금 설명을 더 해 달라는 말이다.
const ELABORATE_WORDS = /자세히|쉽게|간단히|길게|짧게|예를|예시로|구체적|정리/;
const MAX_FOLLOW_UP_LENGTH = 40;

function compact(text: string): string {
	return text.replace(/\s+/g, "").toLowerCase();
}

export function looksLikePastedProblem(question: string): boolean {
	if (CHOICE_MARKER_RE.test(question)) return true;
	const optionLines = question.match(NUMBERED_OPTION_LINE)?.length ?? 0;
	if (optionLines >= 3) return true;
	return STEM_PHRASES.test(question) && question.length > 25;
}

export function lastPracticeCardTurn(
	history: RouterTurn[] | undefined,
): RouterTurn | null {
	if (!history || history.length === 0) return null;
	const lastAssistant = [...history]
		.reverse()
		.find((h) => h.role === "assistant");
	return lastAssistant && PRACTICE_CARD_MARKERS.test(lastAssistant.content)
		? lastAssistant
		: null;
}

/** 메시지 자체만 보고 연습문제 요청인지 판단한다(대화 맥락 없이). */
export function isPracticeRequestText(question: string): {
	match: boolean;
	reason: string;
} {
	const q = question.trim();
	if (!q) return { match: false, reason: "empty" };
	if (q.length > MAX_PRACTICE_REQUEST_LENGTH)
		return { match: false, reason: "too_long" };
	if (looksLikePastedProblem(q))
		return { match: false, reason: "pasted_problem" };

	const c = compact(q);
	const requested = NOUN_THEN_REQUEST.test(c);
	const described = DESCRIPTOR_NOUN.test(c);
	if (!requested && !described)
		return { match: false, reason: "no_practice_phrase" };

	// "이 문제 해설해줘", "3번 문제 답이 왜 2번이야?" — 특정 문제를 설명해 달라는 것.
	if (REFERENT.test(c) && EXPLAIN_WORDS.test(c) && !SIMILARITY_WORDS.test(c)) {
		return { match: false, reason: "refers_to_specific_problem" };
	}
	// "서브넷 마스크 관련 문제인데 … 계산하는 방법이 있을까?", "기출문제 풀이 요령" — 문제 이야기를 하며
	// 묻는 질문. 요청 동사가 명사 바로 뒤에 붙어 있으면("관련 문제 내줘") 질문어가 섞여 있어도 요청으로 본다.
	if (!requested && QUESTION_WORDS.test(c)) {
		return { match: false, reason: "asks_about_problem" };
	}
	return {
		match: true,
		reason: requested ? "noun_then_request" : "descriptor_noun",
	};
}

/** 문제 카드 바로 뒤에 온 짧은 "다른 거 줘"류 후속 요청인지. */
export function isPracticeFollowUp(
	question: string,
	history: RouterTurn[] | undefined,
): boolean {
	if (!lastPracticeCardTurn(history)) return false;
	const q = question.trim();
	if (!q || q.length > MAX_FOLLOW_UP_LENGTH || looksLikePastedProblem(q))
		return false;
	const c = compact(q);
	// "1번 왜 답이 3번이야?", "해설해줘"는 방금 받은 문제에 대한 질문이다.
	if (EXPLAIN_WORDS.test(c) || ELABORATE_WORDS.test(c) || /\d+번/.test(c))
		return false;
	if (BARE_FOLLOW_UP.test(c)) return true;
	return FOLLOW_UP_WORDS.test(c) && FOLLOW_UP_REQUEST.test(c);
}

export function routeQuestion(
	question: string,
	opts: { history?: RouterTurn[]; hasImage?: boolean } = {},
): RouteDecision {
	// 사진 첨부는 언제나 "이 사진 속 문제를 설명해 달라"는 뜻이다.
	if (opts.hasImage)
		return { route: "answer", followUp: false, reason: "image" };
	const text = isPracticeRequestText(question);
	if (text.match)
		return { route: "practice_request", followUp: false, reason: text.reason };
	if (isPracticeFollowUp(question, opts.history)) {
		return {
			route: "practice_request",
			followUp: true,
			reason: "follow_up_after_practice_card",
		};
	}
	return { route: "answer", followUp: false, reason: text.reason };
}

// ---------------- 요청 개수 ----------------

const KOREAN_NUMBERS: Record<string, number> = {
	한: 1,
	하나: 1,
	두: 2,
	둘: 2,
	세: 3,
	셋: 3,
	서: 3,
	네: 4,
	넷: 4,
	너: 4,
	다섯: 5,
	여섯: 6,
	일곱: 7,
	여덟: 8,
	아홉: 9,
	열: 10,
	스무: 20,
	스물: 20,
	몇: 3,
};
const COUNT_RE =
	/(\d+|하나|한|두|둘|세|셋|서|네|넷|너|다섯|여섯|일곱|여덟|아홉|열|스무|스물|몇)\s*(개|문제|문항|가지)/g;
// "문제 하나 내줘", "문제 둘만" — 단위 없이 명사 뒤에 수사가 오는 경우.
const NOUN_COUNT_RE =
	/(?:문제|문항|퀴즈)\s*(\d+|하나|둘|셋|넷|다섯|여섯|일곱|여덟|아홉|열)(?!\s*(?:번|계층|진수|비트|bit|과목))/;
export const DEFAULT_PRACTICE_COUNT = 2;
export const MAX_PRACTICE_COUNT = 20;

/** "문제 3개", "세 문제", "몇 개", "하나만"에서 요청 개수를 읽는다. "RAID 5 문제"의 5처럼 영문 용어에 붙은
 * 숫자는 개수가 아니라 주제의 일부이므로 건너뛴다. */
export function requestedPracticeCount(question: string): number {
	for (const m of question.matchAll(COUNT_RE)) {
		const token = m[1];
		const before = question.slice(
			Math.max(0, (m.index ?? 0) - 2),
			m.index ?? 0,
		);
		if (/^\d+$/.test(token) && /[A-Za-z/.:]\s?$/.test(before)) continue;
		// "서브넷 문제"의 "넷", "인터넷 문제"의 "넷"처럼 단어 끝 글자가 수사처럼 보이는 경우.
		if (!/^\d+$/.test(token) && /[가-힣]$/.test(before)) continue;
		// "한 번"이 아니라 "한 개/한 문제"만 — COUNT_RE가 이미 단위를 요구한다.
		const n = /^\d+$/.test(token) ? Number(token) : KOREAN_NUMBERS[token];
		if (!n) continue;
		return Math.min(Math.max(n, 1), MAX_PRACTICE_COUNT);
	}
	const nounCount = question.match(NOUN_COUNT_RE);
	if (nounCount) {
		const token = nounCount[1];
		const n = /^\d+$/.test(token) ? Number(token) : KOREAN_NUMBERS[token];
		if (n) return Math.min(Math.max(n, 1), MAX_PRACTICE_COUNT);
	}
	if (/하나만|하나\s*더|한\s*개만|한\s*문제만/.test(question)) return 1;
	return DEFAULT_PRACTICE_COUNT;
}
