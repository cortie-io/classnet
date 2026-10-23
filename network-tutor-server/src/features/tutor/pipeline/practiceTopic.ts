// "관련 문제 내줘"류 요청에서 "무슨 주제의 문제를 찾을지"를 정하고, 문제은행(exam_questions)에서 실제로 찾는다.
//
// 예전 방식의 문제(2026-09 audit_log 실측):
//   - 영문 약어만 키워드로 썼다. "서브넷팅 문제 내줘"처럼 한글 주제는 키워드가 0개라 개념 노드(49개뿐)로
//     넘어갔고, 문제은행 4,643문제 중 개념 노드가 달린 건 113개(2.4%)뿐이라 엉뚱한 "IP 주소 클래스 범위"
//     문제가 나갔다. 정작 지문에 "서브넷"이 들어간 문제는 110개나 있었다.
//   - 주제가 없는 요청("문제 내줘")은 직전 튜터 답변 앞부분까지 검색어에 넣었는데, 거기서 약어를 전부
//     주워 "TCP/IP/NOS/OSI/UDP/ARP/ICMP/IGMP/NAT 관련 문제"가 나갔다.
//   - "다른 문제 줘"에 방금 보여준 문제가 그대로 다시 나왔다.
// 이제는 (1) 학생이 쓴 말에서만 주제어를 뽑되 조사·요청 표현을 걷어내고, 띄어쓰기가 달라도 맞게 지문을
// 찾으며, (2) 문장만으로 애매하면 LLM에게 "문제 지문에 그대로 나올 만한 키워드"만 짧게 뽑게 하고,
// (3) 직전에 보여준 문제는 빼고 아직 안 풀어 본 문제를 먼저 고른다.

import { pool } from "../../../infrastructure/db/pool.js";
import {
	generateChat,
	type ProviderChoice,
} from "../../../infrastructure/llm/provider.js";

export const SUBJECTS = [
	"1과목_네트워크_일반",
	"2과목_TCP_IP",
	"3과목_NOS",
	"4과목_네트워크_운용기기",
	"5과목_정보보호개론",
] as const;
export type Subject = (typeof SUBJECTS)[number];

// 학생들이 과목을 부르는 이름(교재 단원명 포함) → 문제은행의 subject 값.
const SUBJECT_ALIASES: { re: RegExp; subject: Subject }[] = [
	{
		re: /1과목|네트워크\s*일반|네트워크\s*개요|정보\s*통신\s*이론|정보통신|고속\s*LAN|광대역/i,
		subject: "1과목_네트워크_일반",
	},
	{ re: /2과목|TCP\s*\/\s*IP\s*과목|티씨피/i, subject: "2과목_TCP_IP" },
	{ re: /3과목|NOS|네트워크\s*운영\s*체제|운영체제/i, subject: "3과목_NOS" },
	{
		re: /4과목|운용\s*기기|네트워크\s*장비/i,
		subject: "4과목_네트워크_운용기기",
	},
	{
		re: /5과목|정보\s*보호|정보\s*보안\s*개론/i,
		subject: "5과목_정보보호개론",
	},
];

export function subjectDisplayName(subject: string): string {
	return subject.replace(/^\d과목_/, "").replace(/_/g, " ");
}

export function detectSubject(text: string): Subject | null {
	return SUBJECT_ALIASES.find((a) => a.re.test(text))?.subject ?? null;
}

// 주제어가 아닌 말 — 요청 표현, 지시어, 수량어, 일반 명사. 비교는 조사를 뗀 단어 기준이다.
const STOP_WORDS = new Set([
	"문제",
	"문항",
	"퀴즈",
	"예제",
	"연습문제",
	"기출문제",
	"예상문제",
	"기출",
	"연습",
	"예상",
	"유형",
	"종류",
	"형식",
	"조건",
	"관련",
	"관련된",
	"관련한",
	"관련해서",
	"비슷한",
	"유사한",
	"같은",
	"동일한",
	"다른",
	"새로운",
	"또다른",
	"추가",
	"실제",
	"이거",
	"이거랑",
	"이것",
	"이것과",
	"그거",
	"그것",
	"저거",
	"방금",
	"아까",
	"위",
	"아래",
	"다음",
	"이번",
	"해당",
	"하나",
	"하나만",
	"한",
	"두",
	"세",
	"네",
	"몇",
	"몇개",
	"개",
	"개만",
	"좀",
	"더",
	"또",
	"다시",
	"만",
	"또는",
	"그리고",
	"예시",
	"위주",
	"위주로",
	"중심",
	"중심으로",
	"개념",
	"개념을",
	"내용",
	"내용으로",
	"주제",
	"주제로",
	"것",
	"거",
	"걸",
	"융합한",
	"섞은",
	"응용",
	"응용한",
	"심화",
	"기본",
	"쉬운",
	"어려운",
	"난이도",
	"시험",
	"필기",
	"실기",
	"네트워크관리사",
	"2급",
	"자격증",
	"너",
	"나",
	"내가",
	"제가",
	"우리",
	"교재",
	"교제",
	"단계별",
	"학습하기",
	"단계별학습하기",
	"나온",
	"나오는",
	"나왔던",
	"책",
	"보면서",
	"보고",
	"풀어볼게",
	"풀게",
	"ㄱ",
	"ㄱㄱ",
	"고고",
	"부탁",
	"부탁해",
	"부탁해요",
	"제발",
	"빨리",
	"지금",
	"오늘",
	"그냥",
	"아무거나",
	"랜덤",
	"전체",
	"모든",
	// 너무 넓어서 지문 검색어로 쓰면 수천 문제에 다 걸리는 말 — 과목 이름으로만 쓴다(detectSubject).
	"네트워크",
	"개요",
	"일반",
	"과목",
	"이론",
	"기술",
	"기초",
	"정리",
	"이런",
	"저런",
	"그런",
	"있잖아",
	"느낌",
	"스타일",
	"다른거",
	"다른것",
	"같은거",
	"같은것",
	"새거",
	"새걸",
	"말고",
	"계속",
	"한번",
	"한번더",
	"하나더",
	"더더",
]);

// 끝에 붙는 조사·어미. 길이가 긴 것부터 떼어야 "에서는"이 "는"만 떨어지지 않는다.
const PARTICLES = [
	"에서는",
	"으로는",
	"이랑은",
	"에대한",
	"에대해",
	"이라는",
	"이라고",
	"에서",
	"으로",
	"이랑",
	"까지",
	"부터",
	"처럼",
	"하고",
	"이나",
	"에는",
	"와",
	"과",
	"랑",
	"을",
	"를",
	"이",
	"가",
	"은",
	"는",
	"의",
	"에",
	"로",
	"도",
	"만",
	"나",
];

// 요청 동사로 끝나는 말("내줘", "뽑아줘", "달라고", "만들어줄", "보여줘", "풀어볼래")은 통째로 버린다.
const REQUEST_WORD =
	/(?:줘|주세요|주실|줄래|줄수|주라|달라|달라고|다오|해줘|해주|할래|볼래|볼게|봐|싶어|싶어요|있어|있나|있을까|있어요|ㄱ|가자|내봐|뽑아|만들어|만들어줄|보여|가져와|추천해|출제해|제공해|생성해|알려|내달라고)\S*$/;

function stripParticles(word: string): string {
	let w = word;
	for (let i = 0; i < 2; i++) {
		const p = PARTICLES.find((x) => w.length > x.length + 1 && w.endsWith(x));
		if (!p) break;
		w = w.slice(0, -p.length);
	}
	return w;
}

// 자주 쓰는 다른 표기 → 문제 지문에 실제로 많이 나오는 표기.
const SYNONYMS: Record<string, string[]> = {
	서브넷: ["서브네팅"],
	서브넷팅: ["서브넷", "서브네팅"],
	서브네팅: ["서브넷", "서브넷팅"],
	서브넷마스크: ["서브넷"],
	이진수: ["2진수"],
	십진수: ["10진수"],
	십육진수: ["16진수"],
	진법: ["진수"],
	진법변환: ["진수"],
	레이드: ["RAID"],
	라우팅프로토콜: ["라우팅"],
	아이피: ["IP"],
	방화벽: ["방화벽", "Firewall"],
	침입탐지: ["IDS"],
	침입방지: ["IPS"],
	가상랜: ["VLAN"],
	리눅스: ["Linux", "리눅스"],
	윈도우서버: ["Windows Server"],
	포트번호: ["포트"],
};

export interface TopicTerms {
	/** 지문 검색용 정규식(PostgreSQL ~*). 영문은 단어 경계, 한글은 글자 사이 공백 허용. */
	patterns: string[];
	/** 학생에게 보여 줄 주제 이름(검색어 원형). */
	terms: string[];
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 한 단어를 지문 검색 정규식으로. "서브넷마스크"는 "서브넷 마스크"에도, "OSPF"는 단어 경계로만 맞는다. */
export function termPattern(term: string): string {
	const t = term.trim();
	if (/^[A-Za-z][A-Za-z0-9.+\-/]*$/.test(t)) {
		// 짧은 영문 약어("AS", "IP")가 "Class"·"VIP" 안에 끼어 맞는 일을 막되, 한글 조사가 바로 붙은
		// "OSPF에", "RIP는"은 맞아야 한다. PostgreSQL의 \y는 한글도 단어 글자로 봐서 "OSPF에"를 놓친다
		// (예전 키워드 검색이 지문의 "OSPF에 대한 설명"을 못 찾던 원인) — 영숫자만 경계로 본다.
		return `(^|[^A-Za-z0-9])${escapeRegex(t)}($|[^A-Za-z0-9])`;
	}
	// 한글은 \y가 먹지 않는다(실측) — 대신 글자 사이 공백을 허용해 띄어쓰기 차이를 흡수한다.
	return Array.from(t.replace(/\s+/g, ""))
		.map((ch) => escapeRegex(ch))
		.join("\\s*");
}

/** 학생이 쓴 문장에서 주제어만 뽑는다(대화 맥락·LLM 없이). */
export function extractTopicTerms(text: string): string[] {
	const out: string[] = [];
	const add = (t: string) => {
		if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
	};
	// "TCP/IP", "IEEE 802.11" 같은 표기를 먼저 통째로.
	for (const m of text.match(/\b[A-Za-z]{2,}\s*\/\s*[A-Za-z]{2,}\b/g) ?? [])
		add(m.replace(/\s+/g, ""));
	for (const m of text.match(/\b\d{3}\.\d+[a-z]?\b/g) ?? []) add(m);

	const words = text
		.replace(/[^\p{L}\p{N}/.\s-]/gu, " ")
		.split(/\s+/)
		.filter(Boolean);
	for (const raw of words) {
		if (/\//.test(raw) && /[A-Za-z]/.test(raw)) continue; // 이미 위에서 처리한 TCP/IP류
		const word = raw.replace(/[.,!?~]+$/, "");
		if (!word || REQUEST_WORD.test(word)) continue;
		// "3개", "10문제", "2번" 같은 수량·번호는 주제가 아니다.
		if (/^\d+(?:개|문제|문항|번|가지|회)?(?:만|씩|정도)?$/.test(word)) continue;

		// 영문+한글이 붙은 말("OSPF와", "RAID5는")은 영문 부분만.
		const latin = word.match(/^[A-Za-z][A-Za-z0-9.+-]*/);
		if (latin && /[가-힣]/.test(word.slice(latin[0].length))) {
			if (latin[0].length >= 2) add(latin[0]);
			continue;
		}
		if (/^[A-Za-z][A-Za-z0-9.+-]*$/.test(word)) {
			if (word.length >= 2 && !/^(ㄱ+|go)$/i.test(word)) add(word);
			continue;
		}
		const base = stripParticles(word);
		if (base.length < 2 || STOP_WORDS.has(base) || STOP_WORDS.has(word))
			continue;
		// "문제를", "개념문제"처럼 끝이 요청 명사인 말은 앞부분만 남긴다("서브넷팅문제" → "서브넷팅").
		const trimmed = base.replace(
			/(?:관련)?(?:연습|기출|예상)?(?:문제|문항|퀴즈).*$/,
			"",
		);
		if (trimmed.length < 2 || STOP_WORDS.has(trimmed)) continue;
		add(trimmed);
	}
	return out.slice(0, 6);
}

export function buildTopicTerms(terms: string[]): TopicTerms {
	const all: string[] = [];
	for (const t of terms) {
		all.push(t);
		for (const s of SYNONYMS[t.replace(/\s+/g, "")] ?? []) all.push(s);
	}
	const uniq = Array.from(
		new Map(all.map((t) => [t.toLowerCase(), t])).values(),
	);
	return { terms: terms.slice(0, 4), patterns: uniq.map(termPattern) };
}

// ---------------- LLM 주제 해석(문장만으로 애매할 때) ----------------

export interface LlmTopic {
	topic: string;
	keywords: string[];
	subject: Subject | null;
}

const GENERIC_KEYWORDS = new Set([
	"문제",
	"네트워크",
	"시험",
	"기출",
	"연습",
	"개념",
	"관련",
	"프로토콜",
	"컴퓨터",
]);

/** 학생의 연습문제 요청을 LLM으로 해석해, 문제 지문에서 그대로 찾을 수 있는 키워드로 바꾼다.
 * "컴퓨터 몇 대 쓸 거다 이런 문제" → ["호스트", "서브넷"]처럼 말로 설명한 주제를 시험 용어로 옮기는 게 목적이다.
 * 실패하거나 시간이 걸리면 null — 호출하는 쪽은 문장에서 뽑은 주제어로 그대로 진행한다. */
export async function interpretTopicWithLlm(
	request: string,
	previousContext: string,
	provider: ProviderChoice,
): Promise<LlmTopic | null> {
	const prompt = `학생이 네트워크관리사 2급 문제은행에서 연습문제를 찾아 달라고 했습니다. 학생이 원하는 주제를 정리하세요.
[학생 요청]
${request}
${previousContext ? `\n[직전 대화(요청에 주제가 없을 때만 참고)]\n${previousContext.slice(0, 600)}\n` : ""}
규칙:
- keywords는 실제 시험 문제 지문에 글자 그대로 나올 만한 핵심 용어 1~4개(예: "서브넷", "OSPF", "브로드캐스트", "chmod"). "문제", "네트워크", "시험" 같은 일반어는 쓰지 마세요.
- 학생이 과목이나 교재 단원 이름만 말했다면 keywords는 비우고 subject만 채우세요.
- subject는 다음 중 하나이거나 null: ${SUBJECTS.join(", ")}
- 주제를 전혀 알 수 없으면 topic을 빈 문자열로 두세요.
JSON으로만 답하세요: {"topic": "짧은 주제 이름", "keywords": ["..."], "subject": null}`;
	try {
		const { text } = await generateChat(
			[
				{
					role: "system",
					content:
						"You extract search keywords for a Korean network-certification question bank. Respond with JSON only.",
				},
				{ role: "user", content: prompt },
			],
			provider,
			{
				tier: "fast",
				json: true,
				temperature: 0,
				reasoningEffort: "low",
				maxCompletionTokens: 300,
			},
		);
		const raw = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as Partial<{
			topic: unknown;
			keywords: unknown;
			subject: unknown;
		}>;
		const keywords = Array.isArray(raw.keywords)
			? raw.keywords
					.filter((k): k is string => typeof k === "string")
					.map((k) => k.trim())
					.filter(
						(k) => k.length >= 2 && k.length <= 30 && !GENERIC_KEYWORDS.has(k),
					)
					.slice(0, 4)
			: [];
		const subject = SUBJECTS.find((s) => s === raw.subject) ?? null;
		const topic =
			typeof raw.topic === "string" ? raw.topic.trim().slice(0, 40) : "";
		if (!topic && keywords.length === 0 && !subject) return null;
		return { topic, keywords, subject };
	} catch (err) {
		console.warn(
			"[practice] 주제 해석(LLM) 실패 — 문장에서 뽑은 주제어로 진행합니다:",
			err instanceof Error ? err.message : err,
		);
		return null;
	}
}

// ---------------- 이전 문제 카드 ----------------

/** 웹(network-tutor-model.ts)이 히스토리에 "[문제은행에서 찾아준 문제 목록 · 연습 #123]"으로 남긴 응시 번호. */
export function previousPracticeAttemptIds(
	history: { role: string; content: string }[] | undefined,
): number[] {
	const ids: number[] = [];
	for (const h of history ?? []) {
		if (h.role !== "assistant") continue;
		for (const m of h.content.matchAll(/연습\s*#(\d+)/g))
			ids.push(Number(m[1]));
	}
	return ids.slice(-3);
}

/** 직전 문제 카드의 주제 이름("**서브넷** 관련 실제 문제를…"). */
export function previousPracticeTopicLabel(
	history: { role: string; content: string }[] | undefined,
): string | null {
	const last = [...(history ?? [])]
		.reverse()
		.find((h) => h.role === "assistant");
	const m = last?.content.match(/\*\*(.+?)\*\*\s*관련\s*(?:실제\s*)?문제/);
	return m ? m[1] : null;
}

/** 그 학생의 응시에 들어 있던 문제 id들 — 남의 응시 번호를 넣어도 아무것도 안 나오게 user_id로 거른다. */
export async function questionIdsOfAttempts(
	userId: number,
	attemptIds: number[],
): Promise<number[]> {
	if (attemptIds.length === 0) return [];
	const { rows } = await pool.query<{ question_ids: number[] }>(
		"SELECT question_ids FROM exam_attempts WHERE user_id = $1 AND id = ANY($2::int[])",
		[userId, attemptIds],
	);
	return rows.flatMap((r) => r.question_ids);
}

// ---------------- 문제은행 검색 ----------------

/** 지문(가중치 3)·보기(1)에서 주제어가 맞는 문제를 고른다. 지문에 맞는 문제가 먼저, 그다음 이 학생이 아직
 * 받아 본 적 없는 문제, 그다음 많이 맞는 순. 같은 점수끼리는 무작위. */
export async function searchBankByPatterns(params: {
	userId: number;
	patterns: string[];
	excludeIds: number[];
	subject: string | null;
	limit: number;
}): Promise<number[]> {
	if (params.patterns.length === 0 || params.limit <= 0) return [];
	const { rows } = await pool.query<{ id: number }>(
		`WITH cand AS (
       SELECT q.id,
              (SELECT count(*) FROM unnest($1::text[]) p WHERE q.stem ~* p) AS stem_hits,
              (SELECT count(*) FROM unnest($1::text[]) p WHERE COALESCE(q.choices::text, '') ~* p) AS choice_hits,
              EXISTS (SELECT 1 FROM exam_attempts t WHERE t.user_id = $2 AND q.id = ANY(t.question_ids)) AS seen
       FROM exam_questions q
       WHERE q.status = 'approved'
         AND (q.stem ~* ANY($1::text[]) OR COALESCE(q.choices::text, '') ~* ANY($1::text[]))
         AND q.id <> ALL($3::int[])
         AND ($4::text IS NULL OR q.subject = $4)
     )
     SELECT id FROM cand
     ORDER BY (stem_hits > 0) DESC, seen ASC, (stem_hits * 3 + choice_hits) DESC, random()
     LIMIT $5`,
		[
			params.patterns,
			params.userId,
			params.excludeIds,
			params.subject,
			params.limit,
		],
	);
	return rows.map((r) => r.id);
}

/** 과목 안에서 고른다(학생이 과목만 말했을 때, 또는 주제 매칭이 모자랄 때). 안 풀어 본 문제 먼저. */
export async function searchBankBySubject(params: {
	userId: number;
	subject: string;
	excludeIds: number[];
	limit: number;
}): Promise<number[]> {
	if (params.limit <= 0) return [];
	const { rows } = await pool.query<{ id: number }>(
		`SELECT q.id FROM exam_questions q
     WHERE q.status = 'approved' AND q.subject = $1 AND q.id <> ALL($2::int[])
     ORDER BY EXISTS (SELECT 1 FROM exam_attempts t WHERE t.user_id = $3 AND q.id = ANY(t.question_ids)) ASC, random()
     LIMIT $4`,
		[params.subject, params.excludeIds, params.userId, params.limit],
	);
	return rows.map((r) => r.id);
}
