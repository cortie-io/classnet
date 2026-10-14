import {
	generateChat,
	type ProviderChoice,
} from "../../../infrastructure/llm/provider.js";
import {
	hybridRetrieve,
	type HybridRetrieveResult,
} from "../../../infrastructure/search/hybridSearch.js";
import { assembleContext } from "./context.js";
import { writeAuditLog } from "./audit.js";
import { confidentTopic } from "./topicGate.js";
import { createAttempt } from "../../exams/services/examService.js";
import { pool } from "../../../infrastructure/db/pool.js";
import type { RequesterContext, AnswerResponse } from "./contracts.js";
import { retrievalQueryFor } from "./prompt.js";
import { retrievalDetail } from "./retrievalPolicy.js";
import { failedAnswer } from "./failure.js";

const PRACTICE_COUNT_RE = /(\d+)\s*(개|문항|문제)/;
const DEFAULT_PRACTICE_COUNT = 2;
const MAX_PRACTICE_COUNT = 20;

function requestedPracticeCount(question: string): number {
	const m = question.match(PRACTICE_COUNT_RE);
	if (!m) return DEFAULT_PRACTICE_COUNT;
	return Math.min(Math.max(Number(m[1]), 1), MAX_PRACTICE_COUNT);
}

// lookupSearch.ts의 extractSpecificTokens와 같은 발상 — "NSSA", "ABR", "OSPF"처럼 영문 약어는 개념
// 노드 49개짜리 대분류보다 훨씬 더 구체적인 주제 식별자다. 개념 노드 태깅에 의존하면(=concept_node_id
// 일치) 그 노드에 안 걸린 실제 기출 문제를 못 찾아 "완전 무관한 과목 내 랜덤 문제"로 새버린다(실사용
// 확인된 버그: NSSA/ABR 얘기 후 "관련 문제"를 물었더니 전혀 다른 라우팅 방식 비교 문제가 나왔다 — 정작
// 문제은행에는 OSPF 관련 문제가 15개나 있었는데 못 찾은 것).
// PostgreSQL의 단어 경계(\y)는 한글에서 제대로 안 먹는다(실측 확인됨: '\\y2진수\\y'는 매칭 0건,
// 일반 부분일치 '2진수'는 정상 매칭). 그래서 영문 키워드는 \y로 감싸고(짧은 약어가 다른 단어 안에
// 우연히 끼어 매칭되는 것 방지), 한글 키워드는 경계 없이 부분일치로 검색해야 한다 — 대신 "진수"처럼
// 너무 짧은 조각은 무관한 단어에도 우연히 걸릴 수 있어(실측: 3건) "2진수"처럼 숫자+단위까지 포함된
// 조각만 뽑는다.
function extractKeywordTokens(text: string): {
	bounded: string[];
	unbounded: string[];
} {
	const acronyms = text.match(/\b[A-Z]{2,}\d*\b/g) ?? [];
	// "Ext4", "Cat6"처럼 순수 대문자가 아닌 혼합 대소문자 기술 용어도 있다(실사용 중 확인된 버그:
	// "ext4 저널링" 얘기 후 "관련 문제"를 물었을 때 이런 용어를 놓쳐서 개념 노드 폴백으로 새다가
	// 완전 무관한 문제가 섞여 나왔다). 숫자가 붙은 영숫자 복합어까지 잡는다(순수 영단어 오탐 방지를
	// 위해 숫자가 반드시 붙어있어야 함).
	const alphaNumCodes = text.match(/\b[A-Za-z]+\d+[A-Za-z]*\b/g) ?? [];
	const bounded = Array.from(
		new Set([...acronyms, ...alphaNumCodes].map((t) => t.toUpperCase())),
	);

	// 진법 변환("173을 2진수로 변환")은 문제은행 전체 문제의 97.5%가 concept_node_id 태깅이 안 돼있어
	// (실측 확인됨) 개념 노드 매칭으로는 절대 못 찾는다 — 직접 지문 검색만이 유일한 경로다(실사용 중
	// 확인된 버그: "2진수 변환" 다음 "관련 문제"를 물었더니 vi 편집기 문제가 나왔다. 정작 문제은행에
	// "10진수 N을 2진수로 변환" 문제가 6개나 있었는데 못 찾은 것).
	const baseConversionTerms = text.match(/\d*진법|\d+진수/g) ?? [];
	const unbounded = Array.from(new Set(baseConversionTerms));

	return { bounded, unbounded };
}

interface GeneratedQuestion {
	stem: string;
	choices: [string, string, string, string];
	correctIndex: number;
	explanation: string;
}

/** 문제은행에 실제로 맞는 문제가 하나도 없을 때만 쓰는 최후 수단 — AI가 새로 문제를 만들되, 만들자마자
 * 별도의 팩트체크 통과를 반드시 거친 것만 내보낸다(검증 없이 그냥 내보내면 안 됨: 실사용 중 "OSPF는
 * 벨먼-포드, RIP는 다익스트라"처럼 알고리즘이 뒤바뀐 채로 나간 사고가 있었다 — 실제로는 반대다).
 * 검증까지 통과한 것만 exam_questions에 source='ai_generated'/status='pending_review'로 저장해 문제은행에도
 * 남긴다(나중에 관리자가 검수/반려 가능, /admin/questions에서 조회됨). */
async function queueFallbackQuestion(
	topicLabel: string,
	contextText: string,
	subject: string,
	provider: ProviderChoice,
): Promise<boolean> {
	const genPrompt = `당신은 네트워크관리사 2급 필기시험 출제 위원입니다. 아래 주제로 객관식 문제 1개를 새로 만드세요.
[주제]\n${topicLabel}\n\n[참고 자료(있으면 최우선 근거로 삼으세요)]\n${contextText.slice(0, 3000) || "(참고 자료 없음 — 당신의 지식으로 만드세요)"}\n
반드시 아래 JSON 형식으로만 답하세요. 다른 설명은 절대 추가하지 마세요.
{"stem": "문제 지문", "choices": ["보기1", "보기2", "보기3", "보기4"], "correctIndex": 0부터_시작하는_정답_인덱스, "explanation": "정답인 이유를 간단히"}
기술적 사실(알고리즘 종류, 프로토콜 번호, 표준 규격 등)은 절대 혼동하지 말고 정확히 확인한 것만 쓰세요.`;

	let parsed: GeneratedQuestion;
	try {
		const { text: raw } = await generateChat(
			[
				{
					role: "system",
					content:
						"You are a careful, accurate exam question writer. Respond with JSON only.",
				},
				{ role: "user", content: genPrompt },
			],
			provider,
			{ temperature: 0.2, tier: "accurate" },
		);
		const jsonMatch = raw.match(/\{[\s\S]*\}/);
		if (!jsonMatch) return false;
		const candidate = JSON.parse(jsonMatch[0]) as Partial<GeneratedQuestion>;
		if (
			typeof candidate.stem !== "string" ||
			!Array.isArray(candidate.choices) ||
			candidate.choices.length !== 4 ||
			candidate.choices.some((c) => typeof c !== "string") ||
			typeof candidate.correctIndex !== "number" ||
			candidate.correctIndex < 0 ||
			candidate.correctIndex > 3
		) {
			return false;
		}
		parsed = candidate as GeneratedQuestion;
	} catch {
		return false;
	}

	// 생성 직후 별도의 신선한 호출로 팩트체크한다 — 같은 호출 안에서 스스로 검토하게 하면 자기 확신을
	// 그대로 반복할 뿐 실제 검증 효과가 약하다는 게 verify.ts의 기존 설계 방침이라 그대로 따른다.
	const verifyPrompt = `당신은 네트워크관리사 2급 시험 문제의 엄격한 검수위원입니다. 아래 객관식 문제와 정답이 기술적으로 완전히 정확한지 판단하세요.
특히 알고리즘 종류, 프로토콜 번호/포트, 표준 규격, 계층 구분 같은 구체적 사실이 서로 혼동되지 않았는지 꼼꼼히 확인하세요.
반드시 아래 JSON 형식으로만 답하세요.
{"valid": true 또는 false, "reason": "한 문장 이유"}

[문제]\n${parsed.stem}\n[보기]\n${parsed.choices.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n[표시된 정답]\n${parsed.correctIndex + 1}번: ${parsed.choices[parsed.correctIndex]}\n[해설]\n${parsed.explanation}`;

	try {
		const { text: verifyRaw } = await generateChat(
			[
				{
					role: "system",
					content:
						"You are a strict technical fact-checker. Respond with JSON only.",
				},
				{ role: "user", content: verifyPrompt },
			],
			provider,
			{ temperature: 0, tier: "accurate" },
		);
		const verifyMatch = verifyRaw.match(/\{[\s\S]*\}/);
		if (!verifyMatch) return false;
		const verifyResult = JSON.parse(verifyMatch[0]) as { valid?: boolean };
		if (verifyResult.valid !== true) {
			return false;
		}
	} catch {
		return false;
	}

	await pool.query(
		`INSERT INTO exam_questions (source, subject, stem, question_type, choices, correct_index, max_score, explanation, status)
     VALUES ('ai_generated', $1, $2, 'multiple_choice', $3, $4, 1, $5, 'pending_review')`,
		[
			subject,
			parsed.stem,
			JSON.stringify(parsed.choices),
			parsed.correctIndex,
			parsed.explanation,
		],
	);
	// Automated checking does not replace administrator approval.
	return true;
}

/** "이거랑 비슷한 문제 줘"류 요청 — 절대로 AI가 그 자리에서 문제를 지어내지 않는다. 실제 검수를 거쳐
 * 승인된 문제은행(exam_questions)에서만 찾아서, 연습 응시(practice_custom)로 미리 만들어 반환한다.
 * 채팅 화면은 이 attemptId로 곧바로 이어서 풀 수 있는 카드를 렌더링한다. */
export async function runPracticeRequest(
	question: string,
	ctx: RequesterContext,
): Promise<AnswerResponse> {
	const count = requestedPracticeCount(question);

	// 이번 메시지 자체에 이미 명확한 주제가 있는지 먼저 본다(예: "osi 7계층 관련 문제"). 있으면 그것만
	// 쓰고 이전 대화는 무시한다 — 실사용 중 확인된 버그: "2진수 변환" 얘기를 한참 하다가 전혀 다른 주제
	// "osi 7계층 관련 문제"를 새로 요청했는데, 직전 대화까지 검색어에 섞다 보니 옛 주제("2진수")가
	// 새 요청보다 텍스트 분량이 많아 그대로 눌러버렸다(단독 질문 topScore 0.62 vs 대화 포함 0.48).
	// "관련 문제 뽑아줘"처럼 이번 메시지에 주제가 아예 없을 때만(대화 없이도 topScore가 낮음) 아래에서
	// 직전 대화를 검색어에 섞는 기존 방식으로 넘어간다.
	// "주제가 있다"의 기준(예전 MIN_TOPIC_SCORE=0.5)은 이제 검색 모드마다 다르다 — pipeline/topicGate.ts.
	const questionOnlyKeywords = extractKeywordTokens(question);
	const hasQuestionOnlyKeyword =
		questionOnlyKeywords.bounded.length > 0 ||
		questionOnlyKeywords.unbounded.length > 0;

	// "관련 문제 뽑아줄 수 있어?"처럼 요청 자체에는 주제가 없는 경우가 많다 — 직전 대화(예: 방금 물어본
	// "포트 443은 무슨 서비스야?")를 검색어에 함께 넣지 않으면 엉뚱한 개념의 문제를 찾아온다(실사용 중
	// 확인된 버그: 포트/HTTPS 얘기 다음 "관련 문제"를 물었더니 링크상태 라우팅 문제가 나왔다).
	// 1순위 노드의 점수가 낮으면 topNode 자체가 사실상 무관한 노드다 — 이걸 그대로
	// concept_node_match/subject_fallback에 쓰면 완전히 다른 주제의 문제가 "관련 문제"로 나가버린다
	// (실사용 중 확인된 버그: "173을 2진수로 변환" 다음 "관련 문제"를 물었더니 vi 편집기 명령어 문제가
	// 나왔다 — 이때 bge-m3 유사도가 0.44로, 실제 좋은 매칭(0.6대)에 한참 못 미쳤다). 진짜 주제 매칭일 때만
	// topNode를 신뢰하고, 아니면 차라리 키워드 매칭 결과만 쓰거나 정직하게 "못 찾음"으로 넘긴다.
	let questionHasOwnTopic: boolean;
	let retrievalQuery: string;
	let retrieval: HybridRetrieveResult;
	let topic: ReturnType<typeof confidentTopic>;
	try {
		const questionOnly = await hybridRetrieve(question);
		const questionOnlyTopic = confidentTopic(questionOnly, question);
		questionHasOwnTopic =
			hasQuestionOnlyKeyword || questionOnlyTopic.node !== null;
		retrievalQuery = questionHasOwnTopic
			? question
			: retrievalQueryFor(question, ctx.history);
		retrieval = questionHasOwnTopic
			? questionOnly
			: await hybridRetrieve(retrievalQuery);
		topic = questionHasOwnTopic
			? questionOnlyTopic
			: confidentTopic(retrieval, retrievalQuery);
	} catch (err) {
		return failedAnswer({
			question,
			ctx,
			intent: "practice_request",
			err,
			detail: { stage: "retrieval" },
		});
	}
	const { primary } = retrieval;
	const topNode = topic.node;
	const topicDetail = {
		...retrievalDetail(retrieval),
		topicBasis: topic.basis,
		topicScore: topic.score === null ? null : Number(topic.score.toFixed(3)),
	};

	let questionIds: number[] = [];
	let method = "";

	// 1순위: 대화에서 뽑은 구체적 키워드(약어)로 문제 지문을 직접 검색 — 개념 노드 태깅보다 정밀하다.
	// 단순 ILIKE '%AS%' 부분일치는 "AS"가 "Class"/"Base" 같은 무관한 단어 안에도 걸려버려서(실사용 중
	// 확인된 버그) 단어 경계(\y)를 강제하는 정규식으로 짧은 약어도 안전하게 매칭한다.
	const { bounded, unbounded } = questionHasOwnTopic
		? questionOnlyKeywords
		: extractKeywordTokens(retrievalQuery);
	const patterns = [...bounded.map((k) => `\\y${k}\\y`), ...unbounded];
	if (patterns.length > 0) {
		const { rows } = await pool.query<{ id: number; hits: number }>(
			`SELECT id, (SELECT count(*) FROM unnest($1::text[]) p WHERE stem ~* p) AS hits
       FROM exam_questions
       WHERE status = 'approved' AND stem ~* ANY($1::text[])
       ORDER BY hits DESC, random()
       LIMIT $2`,
			[patterns, count],
		);
		questionIds = rows.map((r) => r.id);
		if (questionIds.length > 0) method = "keyword_match";
	}

	// 2순위: 개념 노드 태깅 일치. 후보 2·3순위 노드까지 쓰면 주제가 살짝 옆길로 새는 사례가 실사용
	// 중 확인돼서(예: "ext4 저널링" 다음 관련 문제에 침입방지시스템 문제가 섞여 나옴), 정확도를 위해
	// 최상위 후보 하나만 쓴다 — 개수가 부족하게 나올 수는 있어도 무관한 문제가 섞이는 것보다 낫다.
	// topNode가 null이면(위 주제 기준 미달) 아예 이 단계를 건너뛴다.
	if (questionIds.length < count && topNode) {
		const { rows } = await pool.query<{ id: number }>(
			`SELECT id FROM exam_questions WHERE status = 'approved' AND concept_node_id = $1
       AND id != ALL($2::int[]) ORDER BY random() LIMIT $3`,
			[topNode.id, questionIds, count - questionIds.length],
		);
		if (rows.length > 0 && !method) method = "concept_node_match";
		questionIds.push(...rows.map((r) => r.id));
	}

	// 3순위(최후 수단): 같은 과목 내 무작위 — 주제가 정확히 안 맞을 수 있으니 답변 문구에서 반드시 솔직하게 밝힌다.
	let filledBySubjectFallback = false;
	if (questionIds.length < count && topNode) {
		const { rows: bySubject } = await pool.query<{ id: number }>(
			`SELECT id FROM exam_questions WHERE status = 'approved' AND subject = $1
       AND id != ALL($2::int[]) ORDER BY random() LIMIT $3`,
			[topNode.subject, questionIds, count - questionIds.length],
		);
		if (bySubject.length > 0) {
			filledBySubjectFallback = true;
			if (!method) method = "subject_fallback";
		}
		questionIds.push(...bySubject.map((r) => r.id));
	}

	const allKeywords = [...bounded, ...unbounded];
	const topicLabel =
		allKeywords.length > 0
			? allKeywords.join("/")
			: topNode
				? topNode.title
				: "요청하신 주제";

	// 4순위(최후 수단): 문제은행에 진짜 하나도 없으면 AI가 새로 만든다 — 단, generateFallbackQuestion 안에서
	// 별도 팩트체크를 통과한 것만 나온다(요청 반영: "문제은행 기본, 없으면 창작 허용"). 검증까지 실패하면
	// 억지로 보여주지 않고 정직하게 "못 찾음"으로 넘어간다.
	let queuedForReview = false;
	if (questionIds.length === 0) {
		const { contextText } =
			primary.length > 0
				? await assembleContext(primary, [])
				: { contextText: "" };
		const subject = topNode?.subject ?? "1과목_네트워크_일반";
		// topicLabel은 키워드/개념 노드가 안 잡혔을 때 "요청하신 주제"처럼 의미 없는 표시용 문구로 빠질 수
		// 있다(실측 확인된 버그: "제로트러스트" 요청인데 정작 생성 프롬프트에 주제가 안 들어가 엉뚱하게
		// OSPF 문제를 만들어버림) — 생성에는 항상 학생이 실제로 입력한 원문(question)을 그대로 준다.
		queuedForReview = await queueFallbackQuestion(
			question,
			contextText,
			subject,
			ctx.provider,
		);
	}

	if (questionIds.length === 0) {
		const finalAnswer = queuedForReview
			? "현재 주제와 일치하는 승인된 문제가 없습니다. 새로 생성한 문항은 교사 검토를 기다리고 있어요. 다른 표현으로 물어보시거나 '문제 연습'에서 과목별 문제를 찾아보세요."
			: "현재 문제은행에서 이 주제와 일치하는 문제를 찾지 못했어요. 다른 표현으로 물어보시거나 '문제 연습'에서 과목별 문제를 찾아보세요.";
		const auditLogId = await writeAuditLog({
			userId: ctx.userId,
			question,
			intent: "practice_request",
			retrievedNodeIds: topNode ? [topNode.id] : [],
			ruleEngineTrace: null,
			llmRawAnswer: null,
			verificationStatus: "rule_only",
			verificationDetail: {
				method: queuedForReview
					? "practice_request_pending_review"
					: "practice_request_no_match",
				...topicDetail,
			},
			finalAnswer,
			confidence: 1,
		});
		return {
			question,
			intent: "practice_request",
			answer: finalAnswer,
			sources: [],
			ontologyPath: [],
			calcTrace: null,
			confidence: 1,
			verificationStatus: "rule_only",
			cached: false,
			auditLogId,
			providerUsed: null,
			practiceAttempt: null,
		};
	}

	const { attemptId, questions } = await createAttempt({
		userId: ctx.userId,
		kind: "practice_custom",
		questionIds,
		title: topNode ? `${topNode.title} 관련 문제` : "연습 문제",
	});

	const shortfallNote =
		questions.length < count
			? ` (요청하신 ${count}개 중 문제은행에서 실제로 찾은 건 ${questions.length}개예요.)`
			: "";
	const fallbackNote = filledBySubjectFallback
		? " 일부는 정확히 같은 세부 주제는 아니지만 같은 과목의 문제로 채웠어요."
		: "";
	const finalAnswer = `**${topicLabel}** 관련 실제 문제를 문제은행에서 ${questions.length}개 찾았어요.${shortfallNote}${fallbackNote} 아래에서 바로 풀어보세요.`;
	const auditLogId = await writeAuditLog({
		userId: ctx.userId,
		question,
		intent: "practice_request",
		retrievedNodeIds: topNode ? [topNode.id] : [],
		ruleEngineTrace: null,
		llmRawAnswer: null,
		verificationStatus: "rule_only",
		verificationDetail: {
			method,
			attemptId,
			questionIds,
			requestedCount: count,
			...topicDetail,
		},
		finalAnswer,
		confidence: 1,
	});

	return {
		question,
		intent: "practice_request",
		answer: finalAnswer,
		sources: [],
		ontologyPath: topNode
			? [topNode.subject, topNode.category, topNode.topic]
			: [],
		calcTrace: null,
		confidence: 1,
		verificationStatus: "rule_only",
		cached: false,
		auditLogId,
		providerUsed: null,
		practiceAttempt: { attemptId, questions },
	};
}
