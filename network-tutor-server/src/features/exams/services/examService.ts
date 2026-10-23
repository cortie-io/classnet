import { randomInt } from "node:crypto";
import { pool } from "../../../infrastructure/db/pool.js";

export type QuestionType =
	| "multiple_choice"
	| "short_answer"
	| "subjective"
	| "essay";

export interface ApprovedQuestion {
	id: number;
	subject: string;
	stem: string;
	questionType: QuestionType;
	choices: string[] | null;
	correctIndex: number | null;
	acceptedAnswers: string[] | null;
	modelAnswer: string | null;
	maxScore: number;
	explanation: string;
	stemImageUrl: string | null;
}

function normalizeShortAnswer(s: string): string {
	return s.trim().toLowerCase().replace(/\s+/g, "");
}

function matchesAcceptedAnswer(submitted: string, accepted: string[]): boolean {
	const norm = normalizeShortAnswer(submitted);
	return accepted.some((a) => normalizeShortAnswer(a) === norm);
}

export function shuffleIndices(n: number): number[] {
	const idx = Array.from({ length: n }, (_, i) => i);
	for (let i = idx.length - 1; i > 0; i--) {
		const j = randomInt(0, i + 1);
		[idx[i], idx[j]] = [idx[j], idx[i]];
	}
	return idx;
}

/** 관리자 승인을 통과한(status='approved') 문제만 학생에게 노출한다 — "AI생성·검수대기" 문제는 절대 시험/연습에 나가지 않는다.
 * 공식 모의시험 응시만 그 시험 전용으로 낸 문제(status='exam_only')도 함께 받는다. */
export async function fetchApprovedQuestions(
	ids: number[],
	opts: { includeExamOnly?: boolean; allowPendingIds?: number[] } = {},
): Promise<Map<number, ApprovedQuestion>> {
	if (ids.length === 0) return new Map();
	const { rows } = await pool.query<{
		id: number;
		subject: string;
		stem: string;
		question_type: QuestionType;
		choices: string[] | null;
		correct_index: number | null;
		accepted_answers: string[] | null;
		model_answer: string | null;
		max_score: string;
		explanation: string;
		stem_image_url: string | null;
	}>(
		`SELECT id, subject, stem, question_type, choices, correct_index, accepted_answers, model_answer, max_score, explanation, stem_image_url
     FROM exam_questions WHERE id = ANY($1::int[])
       AND (status = 'approved' OR ($2 AND status = 'exam_only') OR (status = 'pending_review' AND id = ANY($3::int[])))`,
		[ids, opts.includeExamOnly === true, opts.allowPendingIds ?? []],
	);
	return new Map(
		rows.map((r) => [
			r.id,
			{
				id: r.id,
				subject: r.subject,
				stem: r.stem,
				questionType: r.question_type,
				choices: r.choices,
				correctIndex: r.correct_index,
				acceptedAnswers: r.accepted_answers,
				modelAnswer: r.model_answer,
				maxScore: Number(r.max_score),
				explanation: r.explanation,
				stemImageUrl: r.stem_image_url,
			},
		]),
	);
}

/** 공개된 공식 모의시험·지정 시험의 응시 기간이 끝나기 전까지는 그 시험 문제를 모든 학생에게 잠근다 — 먼저
 * 응시한 학생이 문제은행·해설·기출 회차에서 정답을 찾아 아직 안 본 친구에게 알려 주는 길을 막는다.
 * (마감이 없는 지정 시험은 공개돼 있는 동안 계속 잠근다.) */
export async function officialLockedQuestionIds(): Promise<Set<number>> {
	const { rows } = await pool.query<{ qid: number }>(
		`SELECT DISTINCT unnest(question_ids) AS qid FROM exam_sets
     WHERE kind IN ('official', 'admin_timed') AND is_published AND (scheduled_end IS NULL OR scheduled_end > now())`,
	);
	return new Set(rows.map((r) => r.qid));
}

/** 이 학생이 지금 정답을 볼 수 없는 문항 — 치르고 있는(in_progress) 모의고사·지정 시험·공식 모의시험 문항과,
 * 응시 기간 중인 공식 모의시험 문항. 해설 조회·연습 응시·오답노트로 정답을 미리 보는 것을 막는 데 쓴다. */
export async function lockedQuestionIdsForUser(
	userId: number,
): Promise<Set<number>> {
	const [{ rows }, official] = await Promise.all([
		pool.query<{ qid: number }>(
			`SELECT DISTINCT unnest(att.question_ids) AS qid
       FROM exam_attempts att JOIN exam_sets s ON s.id = att.exam_set_id
       WHERE att.user_id = $1 AND att.status = 'in_progress' AND s.kind IN ('mock', 'admin_timed', 'official')`,
			[userId],
		),
		officialLockedQuestionIds(),
	]);
	for (const r of rows) official.add(r.qid);
	return official;
}

export const LOCKED_QUESTION_MESSAGE =
	"지금 응시 중인 시험의 문제라, 시험을 제출한 뒤에 볼 수 있습니다.";

/** 학급/과목별로 승인된 문제 중 무작위 count개 id를 뽑는다. */
async function drawRandomApprovedIds(
	subject: string | null,
	count: number,
	excludeIds: number[] = [],
): Promise<number[]> {
	const params: unknown[] = [];
	let where = "status = 'approved'";
	if (subject) {
		params.push(subject);
		where += ` AND subject = $${params.length}`;
	}
	if (excludeIds.length > 0) {
		params.push(excludeIds);
		where += ` AND NOT (id = ANY($${params.length}::int[]))`;
	}
	params.push(count);
	const { rows } = await pool.query<{ id: number }>(
		`SELECT id FROM exam_questions WHERE ${where} ORDER BY random() LIMIT $${params.length}`,
		params,
	);
	return rows.map((r) => r.id);
}

// 실제 네트워크관리사 2급 필기 과목별 출제 비중(1과목10/2과목17/3과목18/4과목5, 총 50문항).
// 5과목(정보보호개론)은 교재에는 있지만 이 공식 배분표에는 없어 모의고사 자동 구성 대상에서는
// 제외하고(과목 자체가 없는데 억지로 채우면 실제 시험 구조와 달라짐), 개별 연습에서는 계속 노출한다.
export const MOCK_EXAM_SUBJECT_DISTRIBUTION: Record<string, number> = {
	"1과목_네트워크_일반": 17,
	"2과목_TCP_IP": 10,
	"3과목_NOS": 18,
	"4과목_네트워크_운용기기": 5,
};
export const MOCK_EXAM_DURATION_MINUTES = 50;

export interface AttemptQuestionView {
	questionId: number;
	stem: string;
	questionType: QuestionType;
	choices: string[]; // 이미 셔플된 순서 (객관식 외에는 빈 배열)
	maxScore: number;
	stemImageUrl: string | null;
}

export function buildChoiceOrder(question: ApprovedQuestion): {
	order: number[];
	view: string[];
} {
	if (question.questionType !== "multiple_choice" || !question.choices)
		return { order: [], view: [] };
	const order = shuffleIndices(question.choices.length);
	const view = order.map((origIdx) => question.choices![origIdx]);
	return { order, view };
}

export async function createAttempt(params: {
	userId: number;
	kind: "practice_custom" | "mock" | "admin_timed" | "past_exam_round";
	subject?: string | null;
	count?: number;
	examSetId?: number; // admin_timed일 때 이미 만들어진 세트를 지정
	title?: string;
	roundLabel?: string; // past_exam_round일 때 "연도-월-일" 형식으로 회차 지정
	/** past_exam_round: 풀다 만 같은 회차가 있어도 이어 풀지 않고 새로 시작 */
	fresh?: boolean;
	/** practice_custom(무작위): 이 학생이 아직 안 푼 문제부터 뽑고, 모자라면 푼 문제로 채운다 */
	unseenFirst?: boolean;
	questionIds?: number[]; // practice_custom일 때 무작위 대신 특정 문제로 고정하고 싶으면(예: 채팅에서 뽑아준 문제)
	/** 검수 전(pending_review)이지만 이 응시에만 내보내도 되는 문제 — 채팅에서 이 학생을 위해 AI가 만든 문제. */
	allowPendingIds?: number[];
}): Promise<{
	attemptId: number;
	questions: AttemptQuestionView[];
	timeLimitMinutes: number | null;
	savedAnswers?: Record<
		number,
		{ selectedIndex?: number; answerText?: string }
	>;
	/** 풀다 만 응시를 이어서 열었을 때 true */
	resumed?: boolean;
}> {
	let questionIds: number[];
	let timeLimitMinutes: number | null = null;
	let examSetId: number | null = null;
	let oneShot = false;
	let deadlineAt: Date | null = null;
	// 회차별 풀이는 원본 그대로의 1~50번 순서를 유지한다(실제 인쇄된 기출문제를 그대로 따라 풀 수 있도록) —
	// 다른 종류는 전부 부정행위 방지를 위해 문항 순서까지 학생마다 섞는다.
	const preserveOrder = params.kind === "past_exam_round";

	if (params.kind === "past_exam_round") {
		if (!params.roundLabel)
			throw new Error("past_exam_round 응시에는 roundLabel이 필요합니다.");
		const { rows } = await pool.query<{ id: number }>(
			`SELECT id FROM exam_questions
       WHERE status = 'approved' AND source = 'past_exam' AND source_detail->>'roundLabel' = $1
       ORDER BY (source_detail->>'qnum')::int`,
			[params.roundLabel],
		);
		if (rows.length === 0)
			throw new Error("해당 회차의 문제를 찾을 수 없습니다.");
		questionIds = rows.map((r) => r.id);
		// 회차 풀이는 정답을 바로 공개할 수 있어서, 지금 치르는(또는 응시 기간 중인) 시험 문제가 섞여 있으면 막는다.
		const locked = await lockedQuestionIdsForUser(params.userId);
		if (questionIds.some((id) => locked.has(id))) {
			throw new Error(
				"이 회차에는 지금 응시 중이거나 응시 기간 중인 시험 문제가 들어 있어, 시험이 끝난 뒤에 풀 수 있어요.",
			);
		}
		timeLimitMinutes = null;
		const title = pastRoundTitle(params.roundLabel);
		// 50문제를 한 번에 다 풀지 못하고 나갔다 오면 예전엔 새 응시가 만들어져 고른 답이 전부 사라졌다
		// (기출 응시 114건 중 39건이 미제출, 2026-10-23). 같은 회차를 풀다 만 게 있으면 그걸 이어서 연다.
		if (!params.fresh) {
			const { rows: open } = await pool.query<AttemptRow>(
				`SELECT att.* FROM exam_attempts att JOIN exam_sets s ON s.id = att.exam_set_id
         WHERE att.user_id = $1 AND s.kind = 'past_exam_round' AND s.title = $2
           AND att.status = 'in_progress' AND NOT att.is_official
         ORDER BY att.started_at DESC LIMIT 1`,
				[params.userId, title],
			);
			if (open[0]) return { ...(await resumeAttempt(open[0])), resumed: true };
		}
		const setRes = await pool.query<{ id: number }>(
			`INSERT INTO exam_sets (kind, title, created_by, question_ids, is_published)
       VALUES ('past_exam_round', $1, $2, $3, true) RETURNING id`,
			[title, params.userId, questionIds],
		);
		examSetId = setRes.rows[0].id;
	} else if (params.kind === "admin_timed") {
		if (!params.examSetId)
			throw new Error("admin_timed 응시에는 examSetId가 필요합니다.");
		const { rows } = await pool.query<{
			question_ids: number[];
			duration_minutes: number | null;
			is_published: boolean;
			scheduled_start: Date | null;
			scheduled_end: Date | null;
		}>(
			"SELECT question_ids, duration_minutes, is_published, scheduled_start, scheduled_end FROM exam_sets WHERE id = $1 AND kind = 'admin_timed'",
			[params.examSetId],
		);
		if (rows.length === 0) throw new Error("존재하지 않는 시험입니다.");
		if (!rows[0].is_published)
			throw new Error("아직 공개되지 않은 시험입니다.");
		const now = new Date();
		if (rows[0].scheduled_start && now < rows[0].scheduled_start) {
			throw new Error(
				`아직 응시 시작 전입니다. 응시 가능 시작: ${rows[0].scheduled_start.toLocaleString("ko-KR")}`,
			);
		}
		if (rows[0].scheduled_end && now > rows[0].scheduled_end) {
			throw new Error(
				`응시 가능 기간이 종료되었습니다. 응시 마감: ${rows[0].scheduled_end.toLocaleString("ko-KR")}`,
			);
		}
		// 지정 시험(사전/사후테스트 등)은 한 번만 친다 — 제출 후 결과 화면에서 정답을 보고 다시 응시해
		// 만점을 받는 일을 막는다. 진행 중인 응시가 있으면(새로고침·창 닫힘) 새로 만들지 않고 그대로 이어서 준다.
		// 관리자가 무효 처리(invalidated)한 응시는 없는 것으로 보고 재응시를 허용한다.
		const { rows: prev } = await pool.query<AttemptRow>(
			`SELECT * FROM exam_attempts WHERE user_id = $1 AND exam_set_id = $2 AND status <> 'invalidated'
       ORDER BY started_at DESC LIMIT 1`,
			[params.userId, params.examSetId],
		);
		if (prev[0]) {
			if (prev[0].status !== "in_progress" || isTimeExpired(prev[0])) {
				await autoSubmitIfExpired(prev[0].id);
				throw new Error(
					"이미 응시한 시험입니다. 다시 응시하려면 선생님께 문의하세요.",
				);
			}
			return resumeAttempt(prev[0]);
		}
		questionIds = rows[0].question_ids;
		timeLimitMinutes = rows[0].duration_minutes;
		examSetId = params.examSetId;
		oneShot = true;
		// 마감은 서버가 정한다 — 시작 + 제한시간과 응시 기간 끝 중 이른 쪽(제한시간이 없어도 기간 끝은 지킨다).
		const limits = [
			timeLimitMinutes ? Date.now() + timeLimitMinutes * 60_000 : null,
			rows[0].scheduled_end ? new Date(rows[0].scheduled_end).getTime() : null,
		].filter((v): v is number => v !== null);
		deadlineAt = limits.length > 0 ? new Date(Math.min(...limits)) : null;
	} else if (params.kind === "mock") {
		const picks: number[] = [];
		const locked = [...(await officialLockedQuestionIds())];
		for (const [subject, count] of Object.entries(
			MOCK_EXAM_SUBJECT_DISTRIBUTION,
		)) {
			const ids = await drawRandomApprovedIds(subject, count, [
				...picks,
				...locked,
			]);
			picks.push(...ids);
		}
		questionIds = picks;
		timeLimitMinutes = MOCK_EXAM_DURATION_MINUTES;
		const setRes = await pool.query<{ id: number }>(
			`INSERT INTO exam_sets (kind, title, created_by, duration_minutes, question_ids, subject_distribution, is_published)
       VALUES ('mock', '모의고사', $1, $2, $3, $4, true) RETURNING id`,
			[
				params.userId,
				timeLimitMinutes,
				questionIds,
				JSON.stringify(MOCK_EXAM_SUBJECT_DISTRIBUTION),
			],
		);
		examSetId = setRes.rows[0].id;
	} else {
		const locked = await lockedQuestionIdsForUser(params.userId);
		if (params.questionIds && params.questionIds.length > 0) {
			if (params.questionIds.some((id) => locked.has(id)))
				throw new Error(LOCKED_QUESTION_MESSAGE);
			questionIds = params.questionIds;
		} else {
			const count = params.count ?? 10;
			const exclude = [...locked];
			questionIds = [];
			if (params.unseenFirst) {
				const { rows: seen } = await pool.query<{ question_id: number }>(
					`SELECT DISTINCT a.question_id FROM exam_answers a JOIN exam_attempts att ON att.id = a.attempt_id
           WHERE att.user_id = $1`,
					[params.userId],
				);
				const seenIds = seen.map((r) => r.question_id);
				questionIds = await drawRandomApprovedIds(params.subject ?? null, count, [
					...exclude,
					...seenIds,
				]);
			}
			if (questionIds.length < count) {
				questionIds.push(
					...(await drawRandomApprovedIds(
						params.subject ?? null,
						count - questionIds.length,
						[...exclude, ...questionIds],
					)),
				);
			}
		}
		const setRes = await pool.query<{ id: number }>(
			`INSERT INTO exam_sets (kind, title, created_by, question_ids, is_published)
       VALUES ('practice_custom', $1, $2, $3, true) RETURNING id`,
			[
				params.title ??
					`연습 문제${params.subject ? ` (${params.subject})` : ""}`,
				params.userId,
				questionIds,
			],
		);
		examSetId = setRes.rows[0].id;
	}

	if (questionIds.length === 0)
		throw new Error("조건에 맞는 승인된 문제가 없습니다.");

	const approvedMap = await fetchApprovedQuestions(questionIds, {
		allowPendingIds: params.allowPendingIds,
	});
	const orderedIds = questionIds.filter((id) => approvedMap.has(id));
	if (!orderedIds.length)
		throw new Error("조건에 맞는 승인된 문제가 없습니다.");
	// 문항 순서 자체도 학생마다 섞는다(부정행위 방지: 옆 사람과 화면이 달라짐) — 다만 회차별 풀이는
	// preserveOrder로 원본 1~50번 순서를 그대로 유지한다.
	const shuffledOrder = preserveOrder
		? orderedIds
		: shuffleIndices(orderedIds.length).map((i) => orderedIds[i]);

	const choiceOrderMap: Record<number, number[]> = {};
	const views: AttemptQuestionView[] = shuffledOrder.map((qid) => {
		const q = approvedMap.get(qid)!;
		const { order, view } = buildChoiceOrder(q);
		choiceOrderMap[qid] = order;
		return {
			questionId: qid,
			stem: q.stem,
			questionType: q.questionType,
			choices: view,
			maxScore: q.maxScore,
			stemImageUrl: q.stemImageUrl,
		};
	});

	let attemptRes: { rows: { id: number }[] };
	try {
		attemptRes = await pool.query<{ id: number }>(
			`INSERT INTO exam_attempts (exam_set_id, user_id, question_ids, choice_order, time_limit_minutes, one_shot, deadline_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
			[
				examSetId,
				params.userId,
				shuffledOrder,
				JSON.stringify(choiceOrderMap),
				timeLimitMinutes,
				oneShot,
				deadlineAt,
			],
		);
	} catch (err) {
		// 같은 지정 시험의 시작 요청이 거의 동시에 들어와 다른 쪽이 먼저 만든 경우 — 그 응시를 이어서 준다.
		if (oneShot && (err as { code?: string }).code === "23505") {
			const { rows: existing } = await pool.query<AttemptRow>(
				`SELECT * FROM exam_attempts WHERE user_id = $1 AND exam_set_id = $2 AND one_shot AND status = 'in_progress'`,
				[params.userId, examSetId],
			);
			if (existing[0]) return resumeAttempt(existing[0]);
			throw new Error(
				"이미 응시한 시험입니다. 다시 응시하려면 선생님께 문의하세요.",
			);
		}
		throw err;
	}

	return {
		attemptId: attemptRes.rows[0].id,
		questions: views,
		timeLimitMinutes,
	};
}

interface AttemptRow {
	id: number;
	exam_set_id: number | null;
	user_id: number;
	question_ids: number[];
	choice_order: Record<string, number[]>;
	time_limit_minutes: number | null;
	started_at: Date;
	submitted_at: Date | null;
	status: string;
	score: number | null;
	flagged_for_review: boolean;
	is_official: boolean;
	deadline_at: Date | null;
	device_token_hash: string | null;
	last_heartbeat_at: Date | null;
}

export type { AttemptRow };

/** 응시 마감 시각(ms). 서버가 응시마다 정해 둔 deadline_at이 있으면 그것, 없으면 시작 + 제한시간. 제한이 없으면 null. */
export function attemptDeadline(
	attempt: Pick<
		AttemptRow,
		"deadline_at" | "started_at" | "time_limit_minutes"
	>,
): number | null {
	if (attempt.deadline_at) return new Date(attempt.deadline_at).getTime();
	if (!attempt.time_limit_minutes) return null;
	return (
		new Date(attempt.started_at).getTime() + attempt.time_limit_minutes * 60_000
	);
}

export async function getAttempt(
	attemptId: number,
): Promise<AttemptRow | null> {
	const { rows } = await pool.query<AttemptRow>(
		"SELECT * FROM exam_attempts WHERE id = $1",
		[attemptId],
	);
	return rows[0] ?? null;
}

/** 진행 중인 응시를 처음 받았던 화면 그대로(문항·보기 순서, 남은 시간, 이미 저장한 답) 다시 만들어 준다. */
export async function resumeAttempt(attempt: AttemptRow): Promise<{
	attemptId: number;
	questions: AttemptQuestionView[];
	timeLimitMinutes: number | null;
	savedAnswers: Record<number, { selectedIndex?: number; answerText?: string }>;
}> {
	const approvedMap = await fetchApprovedQuestions(attempt.question_ids, {
		includeExamOnly: attempt.is_official,
	});
	const views: AttemptQuestionView[] = attempt.question_ids
		.filter((qid) => approvedMap.has(qid))
		.map((qid) => {
			const q = approvedMap.get(qid)!;
			const order = attempt.choice_order[String(qid)] ?? [];
			const choices =
				q.questionType === "multiple_choice" && q.choices
					? order.map((i) => q.choices![i])
					: [];
			return {
				questionId: qid,
				stem: q.stem,
				questionType: q.questionType,
				choices,
				maxScore: q.maxScore,
				stemImageUrl: q.stemImageUrl,
			};
		});

	const { rows } = await pool.query<{
		question_id: number;
		selected_index: number | null;
		answer_text: string | null;
	}>(
		"SELECT question_id, selected_index, answer_text FROM exam_answers WHERE attempt_id = $1",
		[attempt.id],
	);
	const savedAnswers: Record<
		number,
		{ selectedIndex?: number; answerText?: string }
	> = {};
	for (const r of rows) {
		const order = attempt.choice_order[String(r.question_id)];
		if (r.selected_index != null) {
			savedAnswers[r.question_id] = {
				selectedIndex: order
					? order.indexOf(r.selected_index)
					: r.selected_index,
			};
		} else if (r.answer_text != null) {
			savedAnswers[r.question_id] = { answerText: r.answer_text };
		}
	}

	// 화면은 "지금부터 timeLimitMinutes분"으로 카운트다운하므로 남은 시간만 넘긴다(서버 마감은 그대로).
	const deadline = attemptDeadline(attempt);
	const timeLimitMinutes =
		deadline !== null ? Math.max(0, deadline - Date.now()) / 60_000 : null;
	return {
		attemptId: attempt.id,
		questions: views,
		timeLimitMinutes,
		savedAnswers,
	};
}

async function getExamSetKind(
	examSetId: number | null,
): Promise<string | null> {
	if (!examSetId) return null;
	const { rows } = await pool.query<{ kind: string }>(
		"SELECT kind FROM exam_sets WHERE id = $1",
		[examSetId],
	);
	return rows[0]?.kind ?? null;
}

export function isTimeExpired(attempt: AttemptRow): boolean {
	const deadline = attemptDeadline(attempt);
	return deadline !== null && Date.now() > deadline;
}

export interface AnswerResult {
	recorded: true;
	isCorrect?: boolean;
	correctIndex?: number; // 셔플된 화면 기준 인덱스 (객관식만)
	explanation?: string;
	gradingPending?: boolean; // 주관식/서술형: 교사 채점 전까지 true
	instantFeedback: boolean;
}

/** selectedDisplayIndex(객관식, 셔플된 화면 기준 인덱스)/answerText(단답식·주관식·서술형) 중 문제 유형에 맞는 것만 채운다. */
export async function submitAnswer(params: {
	attemptId: number;
	userId: number;
	questionId: number;
	selectedDisplayIndex?: number;
	answerText?: string;
	/** 바로 정오답을 보여주는 연습(채팅 안 미니 문제 등)에서 "정답 확인"을 눌렀을 때만 true.
	 * 한 번 정답을 공개한 문항은 답을 바꿀 수 없다(정답을 보고 고쳐서 맞춘 것으로 기록되는 걸 막음). */
	reveal?: boolean;
	/** 공식 모의시험 전용 경로(officialExam.ts)에서만 true — 기기 토큰 확인을 거친 뒤에만 답을 받는다. */
	official?: boolean;
}): Promise<AnswerResult> {
	const attempt = await getAttempt(params.attemptId);
	if (!attempt || attempt.user_id !== params.userId)
		throw new Error("응시 기록을 찾을 수 없습니다.");
	if (attempt.is_official !== (params.official === true))
		throw new Error(OFFICIAL_ONLY_MESSAGE);
	if (attempt.status !== "in_progress")
		throw new Error("이미 종료된 응시입니다.");
	if (isTimeExpired(attempt)) {
		// 점수까지 계산해서 닫는다 — 상태만 바꾸면 score가 영구히 NULL로 남아 사전/사후 점수에서 빠졌다.
		await autoSubmitIfExpired(params.attemptId);
		throw new Error("제한 시간이 종료되어 자동 제출되었습니다.");
	}
	if (!attempt.question_ids.includes(params.questionId))
		throw new Error("이 응시에 포함되지 않은 문제입니다.");

	const { rows } = await pool.query<{
		question_type: QuestionType;
		correct_index: number | null;
		accepted_answers: string[] | null;
		max_score: string;
		explanation: string;
	}>(
		"SELECT question_type, correct_index, accepted_answers, max_score, explanation FROM exam_questions WHERE id = $1",
		[params.questionId],
	);
	if (rows.length === 0) throw new Error("문제를 찾을 수 없습니다.");
	const q = rows[0];
	const maxScore = Number(q.max_score);
	const kind = await getExamSetKind(attempt.exam_set_id);
	// 예전에 만들어 둔 연습 응시로 지금 치르는(또는 응시 기간 중인) 시험 문제의 정답을 공개받지 못하게 한다.
	const instantFeedback =
		(kind === "practice_custom" || kind === "past_exam_round") &&
		params.reveal === true &&
		!(await lockedQuestionIdsForUser(params.userId)).has(params.questionId);

	const { rows: prevRows } = await pool.query<{ revealed_at: Date | null }>(
		"SELECT revealed_at FROM exam_answers WHERE attempt_id = $1 AND question_id = $2",
		[params.attemptId, params.questionId],
	);
	if (prevRows[0]?.revealed_at)
		throw new Error("이미 정답을 확인한 문제라 답을 바꿀 수 없습니다.");

	if (q.question_type === "multiple_choice") {
		if (typeof params.selectedDisplayIndex !== "number")
			throw new Error("selectedDisplayIndex가 필요합니다.");
		const order = attempt.choice_order[String(params.questionId)];
		const originalIndex = order
			? order[params.selectedDisplayIndex]
			: params.selectedDisplayIndex;
		const isCorrect = q.correct_index === originalIndex;
		const score = isCorrect ? maxScore : 0;

		await pool.query(
			`INSERT INTO exam_answers (attempt_id, question_id, selected_index, is_correct, score, graded_at, revealed_at)
       VALUES ($1,$2,$3,$4,$5,now(),$6)
       ON CONFLICT (attempt_id, question_id) DO UPDATE SET
         selected_index = EXCLUDED.selected_index, is_correct = EXCLUDED.is_correct, score = EXCLUDED.score, answered_at = now(), graded_at = now(),
         revealed_at = EXCLUDED.revealed_at`,
			[
				params.attemptId,
				params.questionId,
				originalIndex,
				isCorrect,
				score,
				instantFeedback ? new Date() : null,
			],
		);

		if (!instantFeedback) return { recorded: true, instantFeedback };
		// 화면(셔플) 기준 정답 인덱스로 되돌려서 알려준다(클라이언트는 원본 인덱스를 모름).
		const displayCorrectIndex = order
			? order.indexOf(q.correct_index!)
			: q.correct_index!;
		return {
			recorded: true,
			instantFeedback,
			isCorrect,
			correctIndex: displayCorrectIndex,
			explanation: q.explanation,
		};
	}

	const answerText = (params.answerText ?? "").trim();
	if (!answerText) throw new Error("answerText가 필요합니다.");

	if (q.question_type === "short_answer") {
		const isCorrect = matchesAcceptedAnswer(
			answerText,
			q.accepted_answers ?? [],
		);
		const score = isCorrect ? maxScore : 0;
		await pool.query(
			`INSERT INTO exam_answers (attempt_id, question_id, answer_text, is_correct, score, graded_at, revealed_at)
       VALUES ($1,$2,$3,$4,$5,now(),$6)
       ON CONFLICT (attempt_id, question_id) DO UPDATE SET
         answer_text = EXCLUDED.answer_text, is_correct = EXCLUDED.is_correct, score = EXCLUDED.score, answered_at = now(), graded_at = now(),
         revealed_at = EXCLUDED.revealed_at`,
			[
				params.attemptId,
				params.questionId,
				answerText,
				isCorrect,
				score,
				instantFeedback ? new Date() : null,
			],
		);
		if (!instantFeedback) return { recorded: true, instantFeedback };
		return {
			recorded: true,
			instantFeedback,
			isCorrect,
			explanation: q.explanation,
		};
	}

	// subjective/essay: 정답이 하나로 정해지지 않아 자동채점하지 않는다 — 교사가 나중에 직접 채점한다.
	await pool.query(
		`INSERT INTO exam_answers (attempt_id, question_id, answer_text, is_correct, score)
     VALUES ($1,$2,$3,NULL,NULL)
     ON CONFLICT (attempt_id, question_id) DO UPDATE SET
       answer_text = EXCLUDED.answer_text, is_correct = NULL, score = NULL, graded_by = NULL, graded_at = NULL, grader_feedback = NULL, answered_at = now()`,
		[params.attemptId, params.questionId, answerText],
	);
	return { recorded: true, instantFeedback: false, gradingPending: true };
}

export interface AttemptResultItem {
	questionId: number;
	subject: string;
	stem: string;
	questionType: QuestionType;
	choices: string[]; // 화면 기준, 객관식만
	selectedIndex: number | null; // 화면 기준, 객관식만
	correctIndex: number | null; // 화면 기준, 객관식만
	answerText: string | null; // 단답식/주관식/서술형
	isCorrect: boolean | null;
	score: number | null; // 채점 전(주관식/서술형)이면 null
	maxScore: number;
	graderFeedback: string | null;
	explanation: string;
	stemImageUrl: string | null;
}

export async function buildResultItems(
	attempt: AttemptRow,
): Promise<{
	score: number;
	total: number;
	correctCount: number;
	gradingPending: boolean;
	items: AttemptResultItem[];
}> {
	const { rows: questions } = await pool.query<{
		id: number;
		subject: string;
		stem: string;
		question_type: QuestionType;
		choices: string[] | null;
		correct_index: number | null;
		max_score: string;
		explanation: string;
		stem_image_url: string | null;
	}>(
		"SELECT id, subject, stem, question_type, choices, correct_index, max_score, explanation, stem_image_url FROM exam_questions WHERE id = ANY($1::int[])",
		[attempt.question_ids],
	);
	const qMap = new Map(questions.map((q) => [q.id, q]));

	const { rows: answers } = await pool.query<{
		question_id: number;
		selected_index: number | null;
		answer_text: string | null;
		is_correct: boolean | null;
		score: string | null;
		grader_feedback: string | null;
	}>(
		"SELECT question_id, selected_index, answer_text, is_correct, score, grader_feedback FROM exam_answers WHERE attempt_id = $1",
		[attempt.id],
	);
	const aMap = new Map(answers.map((a) => [a.question_id, a]));

	let correctCount = 0;
	let scoreSum = 0;
	let maxScoreSum = 0;
	let gradingPending = false;
	const items: AttemptResultItem[] = attempt.question_ids.map((qid) => {
		const q = qMap.get(qid)!;
		const maxScore = Number(q.max_score);
		const order =
			attempt.choice_order[String(qid)] ??
			(q.choices ? q.choices.map((_, i) => i) : []);
		const a = aMap.get(qid);
		if (a?.is_correct) correctCount++;
		const itemScore = a?.score != null ? Number(a.score) : null;
		maxScoreSum += maxScore;
		if (itemScore != null) scoreSum += itemScore;
		if (
			(q.question_type === "subjective" || q.question_type === "essay") &&
			a &&
			itemScore == null
		) {
			gradingPending = true;
		}
		return {
			questionId: qid,
			subject: q.subject,
			stem: q.stem,
			questionType: q.question_type,
			choices: q.choices ? order.map((origIdx) => q.choices![origIdx]) : [],
			selectedIndex:
				a?.selected_index != null ? order.indexOf(a.selected_index) : null,
			correctIndex:
				q.correct_index != null ? order.indexOf(q.correct_index) : null,
			answerText: a?.answer_text ?? null,
			isCorrect: a?.is_correct ?? null,
			score: itemScore,
			maxScore,
			graderFeedback: a?.grader_feedback ?? null,
			explanation: q.explanation,
			stemImageUrl: q.stem_image_url,
		};
	});

	const score =
		maxScoreSum > 0 ? Math.round((scoreSum / maxScoreSum) * 1000) / 10 : 0;
	return {
		score,
		total: attempt.question_ids.length,
		correctCount,
		gradingPending,
		items,
	};
}

export async function submitAttempt(
	attemptId: number,
	userId: number,
	opts: { official?: boolean } = {},
): Promise<{
	score: number;
	total: number;
	gradingPending: boolean;
	items: AttemptResultItem[];
}> {
	const attempt = await getAttempt(attemptId);
	if (!attempt || attempt.user_id !== userId)
		throw new Error("응시 기록을 찾을 수 없습니다.");
	if (attempt.is_official !== (opts.official === true))
		throw new Error(OFFICIAL_ONLY_MESSAGE);
	if (attempt.status !== "in_progress")
		throw new Error("이미 종료된 응시입니다.");

	const { score, total, gradingPending, items } =
		await buildResultItems(attempt);
	const { rowCount } = await pool.query(
		"UPDATE exam_attempts SET status = 'submitted', submitted_at = now(), score = $1 WHERE id = $2 AND status = 'in_progress'",
		[score, attemptId],
	);
	if (rowCount === 0) throw new Error("이미 종료된 응시입니다.");

	return { score, total, gradingPending, items };
}

/** 교사가 서술형을 채점한 뒤 응시 점수를 다시 계산한다 — 제출 때와 같은 공식(응시의 전체 문항 배점 합이
 * 분모)을 써야 한다. 예전엔 답한 문항 배점만 더해서, 서술형 1개만 답하고 만점을 받으면 2%가 100%가 됐다. */
export async function recomputeAttemptScore(attemptId: number): Promise<void> {
	const attempt = await getAttempt(attemptId);
	if (!attempt || attempt.status === "in_progress") return;
	const { score } = await buildResultItems(attempt);
	await pool.query("UPDATE exam_attempts SET score = $1 WHERE id = $2", [
		score,
		attemptId,
	]);
}

/** 이미 제출된 응시의 결과(문제별 정답·해설 포함)를 상태 변경 없이 다시 조회한다 — "내가 푼 문제 해설 보기". */
export async function getAttemptResults(
	attemptId: number,
	userId: number,
): Promise<{
	status: string;
	score: number | null;
	total: number;
	gradingPending: boolean;
	items: AttemptResultItem[];
	itemsHiddenUntil?: Date;
} | null> {
	const attempt = await getAttempt(attemptId);
	if (!attempt || attempt.user_id !== userId) return null;
	if (attempt.status === "in_progress") {
		return {
			status: attempt.status,
			score: null,
			total: attempt.question_ids.length,
			gradingPending: false,
			items: [],
		};
	}
	// 공식 모의시험은 관리자가 결과를 공개하기 전까지 점수·정답·해설을 하나도 내주지 않는다.
	if (
		attempt.is_official &&
		!(await officialResultsReleased(attempt.exam_set_id))
	) {
		return {
			status: attempt.status,
			score: null,
			total: attempt.question_ids.length,
			gradingPending: false,
			items: [],
		};
	}
	// 지정 시험은 응시 기간이 끝나기 전까지 문제별 정답·해설을 감춘다(먼저 낸 학생이 아직 안 본 친구에게 정답을
	// 알려 줄 수 있었다). 점수는 바로 보여 준다.
	if (attempt.exam_set_id) {
		const { rows } = await pool.query<{
			kind: string;
			scheduled_end: Date | null;
		}>("SELECT kind, scheduled_end FROM exam_sets WHERE id = $1", [
			attempt.exam_set_id,
		]);
		const set = rows[0];
		if (
			set?.kind === "admin_timed" &&
			set.scheduled_end &&
			new Date(set.scheduled_end).getTime() > Date.now()
		) {
			const { total, gradingPending } = await buildResultItems(attempt);
			return {
				status: attempt.status,
				score: attempt.score,
				total,
				gradingPending,
				items: [],
				itemsHiddenUntil: set.scheduled_end,
			};
		}
	}
	const { total, gradingPending, items } = await buildResultItems(attempt);
	// 다른 시험에서 지금 잠겨 있는 문항은 예전 응시 결과에서도 정답·해설을 비운다.
	const locked = await lockedQuestionIdsForUser(userId);
	const safeItems = items.map((it) =>
		locked.has(it.questionId)
			? { ...it, correctIndex: null, isCorrect: null, explanation: "" }
			: it,
	);
	return {
		status: attempt.status,
		score: attempt.score,
		total,
		gradingPending,
		items: safeItems,
	};
}

export async function officialResultsReleased(
	examSetId: number | null,
): Promise<boolean> {
	if (!examSetId) return false;
	const { rows } = await pool.query<{ results_released: boolean }>(
		"SELECT results_released FROM exam_sets WHERE id = $1 AND kind = 'official'",
		[examSetId],
	);
	return rows[0]?.results_released === true;
}

export const OFFICIAL_ONLY_MESSAGE =
	"공식 모의시험은 공식 모의시험 화면에서만 응시할 수 있어요.";

export interface PastExamRound {
	roundLabel: string;
	year: string;
	month: string;
	day: string;
	questionCount: number;
}

/** 실제 기출문제 회차 목록(최신순) — "회차별 풀이" 화면에서 고를 회차 목록으로 쓴다. */
export async function listPastExamRounds(): Promise<PastExamRound[]> {
	const { rows } = await pool.query<{
		round_label: string;
		year: string;
		month: string;
		day: string;
		count: string;
	}>(
		`SELECT source_detail->>'roundLabel' AS round_label,
            source_detail->>'year' AS year, source_detail->>'month' AS month, source_detail->>'day' AS day,
            count(*) AS count
     FROM exam_questions
     WHERE source = 'past_exam' AND status = 'approved'
     GROUP BY round_label, year, month, day
     ORDER BY year DESC, month DESC, day DESC`,
	);
	return rows.map((r) => ({
		roundLabel: r.round_label,
		year: r.year,
		month: r.month,
		day: r.day,
		questionCount: Number(r.count),
	}));
}

export async function listMyAttempts(
	userId: number,
	limit = 50,
): Promise<
	{
		id: number;
		status: string;
		score: number | null;
		startedAt: Date;
		submittedAt: Date | null;
		setKind: string | null;
		setTitle: string | null;
		correct: number;
		total: number;
	}[]
> {
	// 끝까지 응시(제출 또는 시간초과 자동제출)한 것만 기록에 남긴다 — 중간에 그만둔 응시는 학생 화면에
	// 아예 안 보이는 게 맞다는 피드백이 있었다. (부정행위 검토용 관리자 화면은 별도 쿼리라 여기 영향 없음)
	const { rows } = await pool.query(
		`SELECT a.id, a.status, a.score, a.started_at, a.submitted_at, s.kind AS set_kind, s.title AS set_title,
            array_length(a.question_ids, 1) AS total,
            (SELECT count(*) FROM exam_answers ea WHERE ea.attempt_id = a.id AND ea.is_correct) AS correct
     FROM exam_attempts a LEFT JOIN exam_sets s ON s.id = a.exam_set_id
     WHERE a.user_id = $1 AND a.status IN ('submitted', 'auto_submitted') AND NOT a.is_official
     ORDER BY a.started_at DESC LIMIT $2`,
		[userId, limit],
	);
	return rows.map((r) => ({
		id: r.id,
		status: r.status,
		score: r.score !== null ? Number(r.score) : null,
		startedAt: r.started_at,
		submittedAt: r.submitted_at,
		setKind: r.set_kind,
		setTitle: r.set_title,
		correct: Number(r.correct),
		total: r.total ?? 0,
	}));
}

// ---------- 부정행위 방지(관찰 가능한 이상 신호 기록) ----------
// 완벽한 감독은 불가능하다(웹캠 감독 등은 별도 소프트웨어 영역) — 여기서는 브라우저가 관찰할 수 있는
// 신호(탭 전환, 전체화면 이탈, 개발자도구, 복사/붙여넣기)를 전부 기록하고, 반복되면 자동으로
// flagged_for_review를 세워 교사가 사후에 판단하게 한다. "잡아낸다"가 아니라 "기록해서 검토 대상으로
// 남긴다"는 설계다.
const SUSPICIOUS_EVENT_TYPES = new Set([
	"blur",
	"fullscreen_exit",
	"devtools_open",
	"tab_switch",
	"copy",
	"paste",
	"right_click",
	"multiple_tabs",
]);
const FLAG_THRESHOLD = 3;
// 검토 대상 표시(FLAG_THRESHOLD)보다 훨씬 높은 문턱 — 여기까지 가면 "사후 검토"로는 부족하다고 보고
// 그 자리에서 바로 자동 제출한다. 오탐 한두 번으로 시험이 끝나버리는 걸 막기 위해 충분히 높게 잡는다.
const AUTO_SUBMIT_THRESHOLD = 8;

export async function logProctorEvent(
	attemptId: number,
	userId: number,
	eventType: string,
	detail: unknown,
	opts: { official?: boolean } = {},
): Promise<{
	flagged: boolean;
	autoSubmit: boolean;
	violations?: number;
	maxViolations?: number;
}> {
	const attempt = await getAttempt(attemptId);
	if (!attempt || attempt.user_id !== userId)
		throw new Error("응시 기록을 찾을 수 없습니다.");
	if (attempt.is_official !== (opts.official === true))
		throw new Error(OFFICIAL_ONLY_MESSAGE);
	// 끝난 응시에는 더 쌓지 않는다(결과 화면을 보는 중의 탭 전환 등이 기록돼 교사 화면을 어지럽혔다).
	if (attempt.status !== "in_progress")
		return { flagged: attempt.flagged_for_review ?? false, autoSubmit: false };

	// 요청 본문 상한(15MB)까지 detail을 그대로 받아 저장하던 것을 막는다 — 정상 이벤트의 detail은 수십 바이트다.
	const detailJson = JSON.stringify(detail ?? {});
	await pool.query(
		"INSERT INTO exam_proctor_events (attempt_id, event_type, detail) VALUES ($1,$2,$3)",
		[
			attemptId,
			eventType.slice(0, 40),
			detailJson.length <= 2000
				? detailJson
				: JSON.stringify({ truncated: true, length: detailJson.length }),
		],
	);

	const violationTypes = attempt.is_official
		? OFFICIAL_VIOLATION_TYPES
		: SUSPICIOUS_EVENT_TYPES;
	if (!violationTypes.has(eventType))
		return { flagged: attempt.flagged_for_review ?? false, autoSubmit: false };

	const { rows } = await pool.query<{ count: string }>(
		"SELECT count(*) FROM exam_proctor_events WHERE attempt_id = $1 AND event_type = ANY($2::text[])",
		[attemptId, [...violationTypes]],
	);
	const suspiciousCount = Number(rows[0].count);
	// 공식 모의시험은 한 번만 어겨도 검토 대상으로 표시하고, 관리자가 정한 횟수(max_violations)에 닿으면 자동 제출한다.
	let maxViolations = AUTO_SUBMIT_THRESHOLD;
	if (attempt.is_official && attempt.exam_set_id) {
		const { rows: setRows } = await pool.query<{ max_violations: number }>(
			"SELECT max_violations FROM exam_sets WHERE id = $1",
			[attempt.exam_set_id],
		);
		maxViolations = Math.max(1, setRows[0]?.max_violations ?? 3);
	}
	const flagged = suspiciousCount >= (attempt.is_official ? 1 : FLAG_THRESHOLD);
	if (flagged) {
		await pool.query(
			"UPDATE exam_attempts SET flagged_for_review = true WHERE id = $1",
			[attemptId],
		);
	}
	const autoSubmit = suspiciousCount >= maxViolations;
	if (autoSubmit) {
		// 예전엔 "자동 제출하라"고 답만 하고 실제 제출은 화면에 맡겨서, 화면을 고치면 그냥 무시할 수 있었다.
		// 서버가 그 자리에서 채점까지 해서 닫는다(화면은 이어서 결과 화면으로 넘어간다).
		const { score } = await buildResultItems(attempt);
		await pool.query(
			"UPDATE exam_attempts SET status = 'auto_submitted', submitted_at = now(), score = $1 WHERE id = $2 AND status = 'in_progress'",
			[score, attemptId],
		);
	}
	return attempt.is_official
		? { flagged, autoSubmit, violations: suspiciousCount, maxViolations }
		: { flagged, autoSubmit };
}

/** 공식 모의시험에서 위반으로 세는 행동 — 브라우저가 막을 수 있는 복사·붙여넣기·우클릭 등은 막고 기록만 한다. */
export const OFFICIAL_VIOLATION_TYPES = new Set([
	"tab_hidden", // 다른 탭·앱으로 전환(화면이 가려짐)
	"window_blur", // 다른 창으로 포커스가 2초 넘게 이동
	"fullscreen_exit",
	"multiple_tabs",
	"devtools_open",
	"screenshot_key",
	"heartbeat_gap", // 서버가 감지: 화면 신호가 끊김(창을 닫았거나 기기를 바꾸려 한 경우 등)
]);

/** 제한 시간이 지난 in_progress 응시를 자동 제출 처리한다 — GET으로 상태를 조회할 때마다 확인한다. */
export async function autoSubmitIfExpired(attemptId: number): Promise<void> {
	const attempt = await getAttempt(attemptId);
	if (!attempt || attempt.status !== "in_progress" || !isTimeExpired(attempt))
		return;
	const { score } = await buildResultItems(attempt);
	await pool.query(
		"UPDATE exam_attempts SET status = 'auto_submitted', submitted_at = now(), score = $1 WHERE id = $2 AND status = 'in_progress'",
		[score, attemptId],
	);
}

export function pastRoundTitle(roundLabel: string): string {
	return `기출문제 ${roundLabel} 회차`;
}

/** 학생이 직접 시작한 응시(연습·기출·모의고사·지정 시험)를 이어서 연다 — 새로고침하거나 다른 화면에
 * 갔다 와도 고른 답을 잃지 않게. 공식 시험은 감독 절차가 따로 있어 여기서 열지 않는다. */
export async function resumeOwnAttempt(userId: number, attemptId: number) {
	const attempt = await getAttempt(attemptId);
	if (!attempt || attempt.user_id !== userId)
		throw new Error("응시 기록을 찾을 수 없습니다.");
	if (attempt.is_official)
		throw new Error("공식 시험은 시험 화면에서 이어서 응시해 주세요.");
	await autoSubmitIfExpired(attemptId);
	const current = (await getAttempt(attemptId))!;
	if (current.status !== "in_progress")
		throw new Error("이미 제출된 응시예요. 결과 화면에서 확인해 주세요.");
	return { ...(await resumeAttempt(current)), resumed: true };
}

export interface PastRoundProgress {
	roundLabel: string;
	inProgress: { attemptId: number; answered: number; total: number } | null;
	last: {
		attemptId: number;
		correct: number;
		total: number;
		submittedAt: Date;
	} | null;
	bestCorrect: number | null;
	timesSubmitted: number;
}

/** 기출 회차 목록에 붙일 "내 기록" — 이어 풀 회차, 마지막·최고 점수 */
export async function listPastRoundProgress(
	userId: number,
): Promise<PastRoundProgress[]> {
	const { rows } = await pool.query<{
		title: string;
		id: number;
		status: string;
		total: number;
		submitted_at: Date | null;
		answered: string;
		correct: string;
	}>(
		`SELECT s.title, att.id, att.status, array_length(att.question_ids, 1) AS total, att.submitted_at,
            count(a.id) FILTER (WHERE a.selected_index IS NOT NULL OR a.answer_text IS NOT NULL) AS answered,
            count(a.id) FILTER (WHERE a.is_correct) AS correct
     FROM exam_attempts att
     JOIN exam_sets s ON s.id = att.exam_set_id
     LEFT JOIN exam_answers a ON a.attempt_id = att.id
     WHERE att.user_id = $1 AND s.kind = 'past_exam_round' AND NOT att.is_official AND att.status <> 'invalidated'
     GROUP BY s.title, att.id
     ORDER BY att.started_at DESC`,
		[userId],
	);
	const byRound = new Map<string, PastRoundProgress>();
	for (const r of rows) {
		const label = r.title.replace(/^기출문제 /, "").replace(/ 회차$/, "");
		const p = byRound.get(label) ?? {
			roundLabel: label,
			inProgress: null,
			last: null,
			bestCorrect: null,
			timesSubmitted: 0,
		};
		if (r.status === "in_progress") {
			p.inProgress ??= {
				attemptId: r.id,
				answered: Number(r.answered),
				total: r.total,
			};
		} else {
			const correct = Number(r.correct);
			p.timesSubmitted += 1;
			p.last ??= {
				attemptId: r.id,
				correct,
				total: r.total,
				submittedAt: r.submitted_at ?? new Date(0),
			};
			p.bestCorrect = Math.max(p.bestCorrect ?? 0, correct);
		}
		byRound.set(label, p);
	}
	return [...byRound.values()];
}
