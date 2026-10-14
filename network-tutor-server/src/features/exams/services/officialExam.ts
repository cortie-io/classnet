// 공식 모의시험 — 관리자가 문항·응시 기간·제한 시간을 정해 전체 학생이 정해진 기간에 한 번 치르는 시험.
//
// 다른 시험과 아예 따로 관리한다(요청 반영, 2026-10-14):
//   - 점수·정답·해설은 관리자가 공개하기 전까지 학생에게 하나도 나가지 않는다(제출 응답에도 없다).
//   - 학습 순위·관리자 통계·학습 리포트·오답노트·개인화 어디에도 반영하지 않는다(쿼리마다 NOT is_official).
//   - 등수는 관리자 화면에서 늘 보이고, 학생에게는 관리자가 "등수 공개"를 켰을 때만 보인다.
//
// 부정행위를 막는 장치(브라우저로 막을 수 있는 것은 막고, 막을 수 없는 것은 기록·억제한다):
//   - 응시 기간 밖·미공개 시험은 시작 불가, 학생당 1회(DB 유니크 인덱스로 강제), 마감은 서버 시각 기준
//     (시작 + 제한시간과 응시 기간 끝 중 이른 쪽 → exam_attempts.deadline_at).
//   - 응시를 시작한 브라우저에만 기기 토큰을 주고 해시만 저장한다 — 답 저장·제출·신호는 그 토큰이 있어야
//     받는다. 다른 기기·탭으로 이어 풀 수 없다(관리자가 잠금을 풀어 줘야 한다).
//   - 응시 중인 학생은 AI 튜터·문제은행·해설·오답노트 등 다른 API를 전혀 쓸 수 없다(officialLockdown.ts).
//   - 응시 기간 중인 시험 문제는 모든 학생에게 문제은행·해설·기출 회차에서 잠근다(examService).
//   - 화면 이탈·전체화면 해제 등 위반이 정해진 횟수(max_violations)에 닿으면 서버가 그 자리에서 자동 제출한다.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { pool } from "../../../infrastructure/db/pool.js";
import {
	attemptDeadline,
	autoSubmitIfExpired,
	buildResultItems,
	fetchApprovedQuestions,
	getAttempt,
	isTimeExpired,
	logProctorEvent,
	MOCK_EXAM_SUBJECT_DISTRIBUTION,
	OFFICIAL_VIOLATION_TYPES,
	resumeAttempt,
	shuffleIndices,
	buildChoiceOrder,
	submitAnswer,
	submitAttempt,
	type AttemptQuestionView,
	type AttemptRow,
} from "./examService.js";

export class OfficialExamError extends Error {
	constructor(
		message: string,
		readonly status = 400,
		readonly code?: string,
	) {
		super(message);
	}
}

export const OFFICIAL_SUBJECTS = [
	"1과목_네트워크_일반",
	"2과목_TCP_IP",
	"3과목_NOS",
	"4과목_네트워크_운용기기",
	"5과목_정보보호개론",
] as const;

const MAX_QUESTIONS = 200;
const MAX_DURATION_MINUTES = 600;
const HEARTBEAT_GAP_SECONDS = 45;

// ---------------- 입력 검증 ----------------

export interface OfficialExamInput {
	title: string;
	description: string | null;
	durationMinutes: number;
	scheduledStart: Date;
	scheduledEnd: Date;
	questionIds: number[];
	maxViolations: number;
}

function parseDate(v: unknown, label: string): Date {
	if (typeof v !== "string" && typeof v !== "number")
		throw new OfficialExamError(`${label}이(가) 필요합니다.`);
	const d = new Date(v);
	if (Number.isNaN(d.getTime()))
		throw new OfficialExamError(`${label} 형식이 올바르지 않습니다.`);
	return d;
}

function parseIntIn(
	v: unknown,
	label: string,
	min: number,
	max: number,
): number {
	const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
	if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
		throw new OfficialExamError(
			`${label}은(는) ${min}~${max} 사이의 정수여야 합니다.`,
		);
	}
	return n;
}

export function parseExamInput(
	body: unknown,
	existing?: Partial<OfficialExamInput>,
): OfficialExamInput {
	const b = (body ?? {}) as Record<string, unknown>;
	const pick = <K extends keyof OfficialExamInput>(
		k: K,
		raw: unknown,
		parse: (v: unknown) => OfficialExamInput[K],
	) =>
		raw === undefined && existing && existing[k] !== undefined
			? (existing[k] as OfficialExamInput[K])
			: parse(raw);

	const title = pick("title", b.title, (v) => {
		if (typeof v !== "string" || !v.trim())
			throw new OfficialExamError("시험 이름이 필요합니다.");
		if (v.trim().length > 100)
			throw new OfficialExamError("시험 이름은 100자 이내로 입력하세요.");
		return v.trim();
	});
	const description = pick("description", b.description, (v) => {
		if (v === null || v === undefined || v === "") return null;
		if (typeof v !== "string")
			throw new OfficialExamError("안내 문구 형식이 올바르지 않습니다.");
		if (v.length > 2000)
			throw new OfficialExamError("안내 문구는 2000자 이내로 입력하세요.");
		return v.trim();
	});
	const durationMinutes = pick("durationMinutes", b.durationMinutes, (v) =>
		parseIntIn(v, "제한 시간(분)", 1, MAX_DURATION_MINUTES),
	);
	const scheduledStart = pick("scheduledStart", b.scheduledStart, (v) =>
		parseDate(v, "응시 시작 시각"),
	);
	const scheduledEnd = pick("scheduledEnd", b.scheduledEnd, (v) =>
		parseDate(v, "응시 마감 시각"),
	);
	if (scheduledStart.getTime() >= scheduledEnd.getTime()) {
		throw new OfficialExamError(
			"응시 시작 시각은 마감 시각보다 이전이어야 합니다.",
		);
	}
	const questionIds = pick("questionIds", b.questionIds, (v) => {
		if (!Array.isArray(v) || v.length === 0)
			throw new OfficialExamError("문항을 1개 이상 선택하세요.");
		if (v.length > MAX_QUESTIONS)
			throw new OfficialExamError(
				`문항은 최대 ${MAX_QUESTIONS}개까지 넣을 수 있습니다.`,
			);
		const ids = v.map((x) => Number(x));
		if (ids.some((x) => !Number.isInteger(x) || x <= 0))
			throw new OfficialExamError("문항 번호가 올바르지 않습니다.");
		if (new Set(ids).size !== ids.length)
			throw new OfficialExamError("같은 문항이 두 번 들어 있습니다.");
		return ids;
	});
	const maxViolations = pick(
		"maxViolations",
		b.maxViolations ?? (existing ? undefined : 3),
		(v) => parseIntIn(v, "자동 제출 위반 횟수", 1, 20),
	);
	return {
		title,
		description,
		durationMinutes,
		scheduledStart,
		scheduledEnd,
		questionIds,
		maxViolations,
	};
}

async function assertQuestionsUsable(ids: number[]): Promise<void> {
	const { rows } = await pool.query<{ id: number }>(
		"SELECT id FROM exam_questions WHERE id = ANY($1::int[]) AND status IN ('approved','exam_only')",
		[ids],
	);
	if (rows.length !== ids.length) {
		throw new OfficialExamError(
			"승인되지 않았거나 없는 문항이 포함되어 있습니다. 문제 검수에서 먼저 승인하세요.",
		);
	}
}

interface ExamRow {
	id: number;
	title: string;
	description: string | null;
	duration_minutes: number;
	question_ids: number[];
	scheduled_start: Date;
	scheduled_end: Date;
	is_published: boolean;
	results_released: boolean;
	rank_released: boolean;
	results_released_at: Date | null;
	max_violations: number;
	created_at: Date;
}

const EXAM_COLUMNS = `id, title, description, duration_minutes, question_ids, scheduled_start, scheduled_end, is_published,
  results_released, rank_released, results_released_at, max_violations, created_at`;

async function getExam(id: number): Promise<ExamRow> {
	const { rows } = await pool.query<ExamRow>(
		`SELECT ${EXAM_COLUMNS} FROM exam_sets WHERE id = $1 AND kind = 'official'`,
		[id],
	);
	if (!rows[0]) throw new OfficialExamError("시험을 찾을 수 없습니다.", 404);
	return rows[0];
}

function examStatus(
	exam: Pick<ExamRow, "scheduled_start" | "scheduled_end">,
	now = Date.now(),
): "upcoming" | "open" | "closed" {
	if (now < new Date(exam.scheduled_start).getTime()) return "upcoming";
	if (now >= new Date(exam.scheduled_end).getTime()) return "closed";
	return "open";
}

async function attemptCount(examId: number): Promise<number> {
	const { rows } = await pool.query<{ n: string }>(
		"SELECT count(*) AS n FROM exam_attempts WHERE exam_set_id = $1",
		[examId],
	);
	return Number(rows[0].n);
}

/** 이 시험에서 마감이 지났는데 아직 열려 있는 응시를 닫는다 — 관리자 화면의 상태·점수가 정확하도록. */
async function closeExpiredAttempts(examId: number): Promise<void> {
	const { rows } = await pool.query<{ id: number }>(
		"SELECT id FROM exam_attempts WHERE exam_set_id = $1 AND is_official AND status = 'in_progress' AND deadline_at <= now()",
		[examId],
	);
	for (const r of rows) await autoSubmitIfExpired(r.id);
}

// ---------------- 관리자 ----------------

export async function createOfficialExam(
	adminId: number,
	body: unknown,
): Promise<{ id: number }> {
	const input = parseExamInput(body);
	await assertQuestionsUsable(input.questionIds);
	const { rows } = await pool.query<{ id: number }>(
		`INSERT INTO exam_sets (kind, title, description, created_by, duration_minutes, question_ids, scheduled_start, scheduled_end,
                            max_violations, is_published)
     VALUES ('official', $1, $2, $3, $4, $5, $6, $7, $8, false) RETURNING id`,
		[
			input.title,
			input.description,
			adminId,
			input.durationMinutes,
			input.questionIds,
			input.scheduledStart,
			input.scheduledEnd,
			input.maxViolations,
		],
	);
	return { id: rows[0].id };
}

export async function updateOfficialExam(
	id: number,
	body: unknown,
): Promise<void> {
	const exam = await getExam(id);
	const input = parseExamInput(body, {
		title: exam.title,
		description: exam.description,
		durationMinutes: exam.duration_minutes,
		scheduledStart: new Date(exam.scheduled_start),
		scheduledEnd: new Date(exam.scheduled_end),
		questionIds: exam.question_ids,
		maxViolations: exam.max_violations,
	});
	const questionsChanged =
		input.questionIds.length !== exam.question_ids.length ||
		input.questionIds.some((q, i) => q !== exam.question_ids[i]);
	if (questionsChanged) {
		// 이미 누가 응시했다면 문항을 바꾸면 응시마다 다른 시험을 친 셈이 된다.
		if ((await attemptCount(id)) > 0)
			throw new OfficialExamError(
				"이미 응시한 학생이 있어 문항을 바꿀 수 없습니다.",
			);
		await assertQuestionsUsable(input.questionIds);
	}
	await pool.query(
		`UPDATE exam_sets SET title = $2, description = $3, duration_minutes = $4, question_ids = $5,
       scheduled_start = $6, scheduled_end = $7, max_violations = $8
     WHERE id = $1 AND kind = 'official'`,
		[
			id,
			input.title,
			input.description,
			input.durationMinutes,
			input.questionIds,
			input.scheduledStart,
			input.scheduledEnd,
			input.maxViolations,
		],
	);
}

export async function deleteOfficialExam(id: number): Promise<void> {
	await getExam(id);
	if ((await attemptCount(id)) > 0) {
		throw new OfficialExamError(
			"응시 기록이 있는 시험은 삭제할 수 없습니다. 비공개로 돌리세요.",
		);
	}
	await pool.query(
		"DELETE FROM exam_sets WHERE id = $1 AND kind = 'official'",
		[id],
	);
}

export async function setPublished(
	id: number,
	published: boolean,
): Promise<void> {
	await getExam(id);
	if (!published && (await attemptCount(id)) > 0) {
		throw new OfficialExamError(
			"이미 응시한 학생이 있어 비공개로 돌릴 수 없습니다.",
		);
	}
	await pool.query(
		"UPDATE exam_sets SET is_published = $2 WHERE id = $1 AND kind = 'official'",
		[id, published],
	);
}

export async function setRelease(id: number, body: unknown): Promise<void> {
	const exam = await getExam(id);
	const b = (body ?? {}) as Record<string, unknown>;
	const results =
		typeof b.results === "boolean" ? b.results : exam.results_released;
	// 등수는 결과를 공개했을 때만 공개할 수 있다.
	const rank =
		results && (typeof b.rank === "boolean" ? b.rank : exam.rank_released);
	if (results && !exam.results_released) await closeExpiredAttempts(id);
	await pool.query(
		`UPDATE exam_sets SET results_released = $2, rank_released = $3,
       results_released_at = CASE WHEN $2 AND NOT results_released THEN now() WHEN NOT $2 THEN NULL ELSE results_released_at END
     WHERE id = $1 AND kind = 'official'`,
		[id, results, rank],
	);
}

/** 공식 모의시험 전용 문제 작성 — status='exam_only'라 문제은행 어디에도 나오지 않는다. */
export async function createExamOnlyQuestion(
	body: unknown,
): Promise<{ id: number }> {
	const b = (body ?? {}) as Record<string, unknown>;
	const subject = OFFICIAL_SUBJECTS.find((s) => s === b.subject);
	if (!subject) throw new OfficialExamError("과목을 선택하세요.");
	const stem = typeof b.stem === "string" ? b.stem.trim() : "";
	if (!stem || stem.length > 3000)
		throw new OfficialExamError("문제 지문을 3000자 이내로 입력하세요.");
	if (
		!Array.isArray(b.choices) ||
		b.choices.length < 2 ||
		b.choices.length > 6
	) {
		throw new OfficialExamError("보기는 2~6개를 입력하세요.");
	}
	const choices = b.choices.map((c) => (typeof c === "string" ? c.trim() : ""));
	if (choices.some((c) => !c || c.length > 500))
		throw new OfficialExamError("빈 보기가 있거나 보기가 너무 깁니다.");
	const correctIndex = parseIntIn(
		b.correctIndex,
		"정답 번호",
		0,
		choices.length - 1,
	);
	const explanation =
		typeof b.explanation === "string"
			? b.explanation.trim().slice(0, 3000)
			: "";
	const maxScore =
		b.maxScore === undefined ? 1 : parseIntIn(b.maxScore, "배점", 1, 100);
	const { rows } = await pool.query<{ id: number }>(
		`INSERT INTO exam_questions (source, subject, stem, question_type, choices, correct_index, max_score, explanation, status)
     VALUES ('admin_authored', $1, $2, 'multiple_choice', $3, $4, $5, $6, 'exam_only') RETURNING id`,
		[
			subject,
			stem,
			JSON.stringify(choices),
			correctIndex,
			maxScore,
			explanation,
		],
	);
	return { id: rows[0].id };
}

/** 실제 시험 과목 배분(10/17/18/5)대로 승인된 문제를 무작위로 골라 준다 — 관리자 출제 화면의 "자동 채우기". */
export async function autoPickQuestionIds(
	excludeIds: number[] = [],
): Promise<number[]> {
	const picked: number[] = [];
	for (const [subject, count] of Object.entries(
		MOCK_EXAM_SUBJECT_DISTRIBUTION,
	)) {
		const { rows } = await pool.query<{ id: number }>(
			`SELECT id FROM exam_questions WHERE status = 'approved' AND subject = $1 AND question_type = 'multiple_choice'
       AND NOT (id = ANY($2::int[])) ORDER BY random() LIMIT $3`,
			[subject, [...excludeIds, ...picked], count],
		);
		picked.push(...rows.map((r) => r.id));
	}
	return picked;
}

export async function listOfficialExamsAdmin() {
	const { rows } = await pool.query(
		`SELECT s.id, s.title, s.description, s.duration_minutes, s.scheduled_start, s.scheduled_end, s.is_published,
            s.results_released, s.rank_released, s.max_violations, s.created_at,
            cardinality(s.question_ids) AS question_count,
            count(a.id) FILTER (WHERE a.status <> 'invalidated') AS participant_count,
            count(a.id) FILTER (WHERE a.status IN ('submitted','auto_submitted')) AS submitted_count,
            count(a.id) FILTER (WHERE a.status = 'in_progress') AS in_progress_count,
            count(a.id) FILTER (WHERE a.flagged_for_review AND a.status <> 'invalidated') AS flagged_count,
            round(avg(a.score) FILTER (WHERE a.status IN ('submitted','auto_submitted')), 1) AS avg_score,
            (SELECT count(*) FROM users WHERE role = 'student') AS student_count
     FROM exam_sets s LEFT JOIN exam_attempts a ON a.exam_set_id = s.id AND a.is_official
     WHERE s.kind = 'official'
     GROUP BY s.id ORDER BY s.scheduled_start DESC`,
	);
	const now = Date.now();
	return rows.map((r) => ({
		...r,
		question_count: Number(r.question_count),
		participant_count: Number(r.participant_count),
		submitted_count: Number(r.submitted_count),
		in_progress_count: Number(r.in_progress_count),
		flagged_count: Number(r.flagged_count),
		student_count: Number(r.student_count),
		avg_score: r.avg_score === null ? null : Number(r.avg_score),
		status: examStatus(r, now),
	}));
}

export async function officialExamDetailAdmin(id: number) {
	const exam = await getExam(id);
	await closeExpiredAttempts(id);
	const { rows: questions } = await pool.query(
		`SELECT id, subject, stem, question_type, choices, correct_index, explanation, max_score, status, stem_image_url
     FROM exam_questions WHERE id = ANY($1::int[])`,
		[exam.question_ids],
	);
	const byId = new Map(questions.map((q) => [q.id, q]));
	const { rows: roster } = await pool.query(
		`WITH att AS (
       SELECT DISTINCT ON (a.user_id) a.*
       FROM exam_attempts a WHERE a.exam_set_id = $1 AND a.is_official
       ORDER BY a.user_id, (a.status = 'invalidated') ASC, a.started_at DESC
     ),
     viol AS (
       SELECT e.attempt_id, count(*) FILTER (WHERE e.event_type = ANY($2::text[])) AS violations
       FROM exam_proctor_events e JOIN att ON att.id = e.attempt_id GROUP BY e.attempt_id
     ),
     ranked AS (
       SELECT id, RANK() OVER (ORDER BY score DESC) AS rank
       FROM att WHERE status IN ('submitted','auto_submitted') AND score IS NOT NULL
     )
     SELECT u.id AS user_id, u.student_id, u.name, u.department,
            att.id AS attempt_id, att.status, att.score, att.started_at, att.submitted_at, att.deadline_at,
            att.flagged_for_review, att.last_heartbeat_at, att.start_ip, (att.device_token_hash IS NOT NULL) AS device_locked,
            COALESCE(viol.violations, 0)::int AS violations, ranked.rank::int AS rank
     FROM users u
     LEFT JOIN att ON att.user_id = u.id
     LEFT JOIN viol ON viol.attempt_id = att.id
     LEFT JOIN ranked ON ranked.id = att.id
     WHERE u.role = 'student'
     ORDER BY ranked.rank NULLS LAST, u.student_id NULLS LAST, u.name`,
		[id, [...OFFICIAL_VIOLATION_TYPES]],
	);
	const scores = roster
		.filter((r) => r.status === "submitted" || r.status === "auto_submitted")
		.map((r) => Number(r.score));
	return {
		exam: {
			...exam,
			status: examStatus(exam),
			question_count: exam.question_ids.length,
		},
		questions: exam.question_ids.map((qid) => byId.get(qid)).filter(Boolean),
		roster: roster.map((r) => ({
			...r,
			score: r.score === null ? null : Number(r.score),
			status: r.status ?? "not_started",
		})),
		stats: {
			studentCount: roster.length,
			participantCount: roster.filter(
				(r) => r.status && r.status !== "invalidated",
			).length,
			submittedCount: scores.length,
			inProgressCount: roster.filter((r) => r.status === "in_progress").length,
			notStartedCount: roster.filter(
				(r) => !r.status || r.status === "invalidated",
			).length,
			flaggedCount: roster.filter(
				(r) => r.flagged_for_review && r.status !== "invalidated",
			).length,
			avgScore: scores.length
				? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) /
					10
				: null,
			maxScore: scores.length ? Math.max(...scores) : null,
			minScore: scores.length ? Math.min(...scores) : null,
		},
	};
}

async function officialAttemptOf(
	examId: number,
	attemptId: number,
): Promise<AttemptRow> {
	const attempt = await getAttempt(attemptId);
	if (!attempt || !attempt.is_official || attempt.exam_set_id !== examId) {
		throw new OfficialExamError("응시 기록을 찾을 수 없습니다.", 404);
	}
	return attempt;
}

export async function attemptDetailAdmin(examId: number, attemptId: number) {
	await autoSubmitIfExpired(attemptId);
	const attempt = await officialAttemptOf(examId, attemptId);
	const [{ rows: user }, { rows: events }, result] = await Promise.all([
		pool.query(
			"SELECT id, student_id, name, department FROM users WHERE id = $1",
			[attempt.user_id],
		),
		pool.query(
			"SELECT event_type, detail, created_at FROM exam_proctor_events WHERE attempt_id = $1 ORDER BY created_at",
			[attemptId],
		),
		buildResultItems(attempt),
	]);
	return {
		student: user[0] ?? null,
		attempt: {
			id: attempt.id,
			status: attempt.status,
			score: attempt.score === null ? null : Number(attempt.score),
			startedAt: attempt.started_at,
			submittedAt: attempt.submitted_at,
			deadlineAt: attempt.deadline_at,
			flagged: attempt.flagged_for_review,
		},
		events: events.map((e) => ({
			...e,
			violation: OFFICIAL_VIOLATION_TYPES.has(e.event_type),
		})),
		result,
	};
}

/** 학생이 브라우저를 잃어버렸거나 기기를 바꿔야 할 때 — 다음에 시작하는 기기에 새 토큰을 준다. */
export async function resetDeviceLock(
	examId: number,
	attemptId: number,
	adminId: number,
): Promise<void> {
	await officialAttemptOf(examId, attemptId);
	await pool.query(
		"UPDATE exam_attempts SET device_token_hash = NULL WHERE id = $1",
		[attemptId],
	);
	await pool.query(
		"INSERT INTO exam_proctor_events (attempt_id, event_type, detail) VALUES ($1, 'device_reset', $2)",
		[attemptId, JSON.stringify({ by: adminId })],
	);
}

export async function forceSubmit(
	examId: number,
	attemptId: number,
	adminId: number,
): Promise<void> {
	const attempt = await officialAttemptOf(examId, attemptId);
	if (attempt.status !== "in_progress")
		throw new OfficialExamError("이미 끝난 응시입니다.");
	const { score } = await buildResultItems(attempt);
	await pool.query(
		"UPDATE exam_attempts SET status = 'auto_submitted', submitted_at = now(), score = $1 WHERE id = $2 AND status = 'in_progress'",
		[score, attemptId],
	);
	await pool.query(
		"INSERT INTO exam_proctor_events (attempt_id, event_type, detail) VALUES ($1, 'force_submit', $2)",
		[attemptId, JSON.stringify({ by: adminId })],
	);
}

/** 응시를 무효로 돌린다 — 그 학생은 다시 응시할 수 있게 된다(학생당 1회 제한에서 무효 응시는 빠진다). */
export async function invalidateAttempt(
	examId: number,
	attemptId: number,
	adminId: number,
): Promise<void> {
	await officialAttemptOf(examId, attemptId);
	await pool.query(
		"UPDATE exam_attempts SET status = 'invalidated' WHERE id = $1",
		[attemptId],
	);
	await pool.query(
		"INSERT INTO exam_proctor_events (attempt_id, event_type, detail) VALUES ($1, 'invalidated', $2)",
		[attemptId, JSON.stringify({ by: adminId })],
	);
}

function csvCell(value: unknown): string {
	let s = value === null || value === undefined ? "" : String(value);
	// 엑셀이 =, +, -, @로 시작하는 칸을 수식으로 실행하지 않게 한다(CSV 수식 주입).
	if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportCsv(id: number): Promise<string> {
	const { exam, roster } = await officialExamDetailAdmin(id);
	const statusLabel: Record<string, string> = {
		not_started: "미응시",
		in_progress: "응시 중",
		submitted: "제출",
		auto_submitted: "자동 제출",
		invalidated: "무효",
	};
	const header = [
		"등수",
		"학번",
		"이름",
		"학과",
		"상태",
		"점수",
		"위반 횟수",
		"검토 대상",
		"시작",
		"제출",
	];
	const lines = roster.map((r) =>
		[
			r.rank ?? "",
			r.student_id,
			r.name,
			r.department,
			statusLabel[r.status] ?? r.status,
			r.score ?? "",
			r.violations,
			r.flagged_for_review ? "Y" : "",
			r.started_at ? new Date(r.started_at).toLocaleString("ko-KR") : "",
			r.submitted_at ? new Date(r.submitted_at).toLocaleString("ko-KR") : "",
		]
			.map(csvCell)
			.join(","),
	);
	return `﻿${csvCell(exam.title)}\n${[header.join(","), ...lines].join("\n")}`;
}

// ---------------- 학생 ----------------

function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

function deviceMatches(
	attempt: AttemptRow,
	token: string | undefined,
): boolean {
	if (!attempt.device_token_hash || !token || token.length > 200) return false;
	const a = Buffer.from(hashToken(token), "hex");
	const b = Buffer.from(attempt.device_token_hash, "hex");
	return a.length === b.length && timingSafeEqual(a, b);
}

async function myOfficialAttempt(
	userId: number,
	attemptId: number,
	token: string | undefined,
): Promise<AttemptRow> {
	const attempt = await getAttempt(attemptId);
	if (!attempt || attempt.user_id !== userId || !attempt.is_official) {
		throw new OfficialExamError("응시 기록을 찾을 수 없습니다.", 404);
	}
	if (attempt.status === "in_progress" && !deviceMatches(attempt, token)) {
		throw new OfficialExamError(DEVICE_LOCKED_MESSAGE, 409, "DEVICE_LOCKED");
	}
	return attempt;
}

export const DEVICE_LOCKED_MESSAGE =
	"이 시험은 처음 시작한 기기(브라우저)에서만 이어서 응시할 수 있어요. 기기를 바꿔야 한다면 선생님께 잠금 해제를 요청하세요.";

export async function listOfficialExamsForStudent(userId: number) {
	const { rows } = await pool.query(
		`SELECT s.id, s.title, s.description, s.duration_minutes, s.scheduled_start, s.scheduled_end,
            s.results_released, s.rank_released, cardinality(s.question_ids) AS question_count,
            a.id AS attempt_id, a.status AS attempt_status, a.deadline_at
     FROM exam_sets s
     LEFT JOIN LATERAL (
       SELECT id, status, deadline_at FROM exam_attempts
       WHERE exam_set_id = s.id AND user_id = $1 AND is_official AND status <> 'invalidated'
       ORDER BY started_at DESC LIMIT 1
     ) a ON true
     WHERE s.kind = 'official' AND s.is_published
     ORDER BY s.scheduled_start DESC`,
		[userId],
	);
	const now = Date.now();
	return rows.map((r) => {
		const expired =
			r.attempt_status === "in_progress" &&
			r.deadline_at &&
			new Date(r.deadline_at).getTime() <= now;
		return {
			id: r.id,
			title: r.title,
			description: r.description,
			durationMinutes: r.duration_minutes,
			scheduledStart: r.scheduled_start,
			scheduledEnd: r.scheduled_end,
			questionCount: Number(r.question_count),
			status: examStatus(r, now),
			myStatus: (expired
				? "auto_submitted"
				: (r.attempt_status ?? "not_started")) as string,
			resultsReleased: r.results_released === true,
			rankReleased: r.rank_released === true,
		};
	});
}

/** 지금 응시 중인 공식 모의시험(있으면) — 학생 화면이 다른 페이지 대신 시험 화면으로 돌려보내는 데 쓴다. */
export async function activeOfficialAttempt(
	userId: number,
): Promise<{ attemptId: number; examId: number } | null> {
	const { rows } = await pool.query<{ id: number; exam_set_id: number }>(
		"SELECT id, exam_set_id FROM exam_attempts WHERE user_id = $1 AND is_official AND status = 'in_progress' LIMIT 1",
		[userId],
	);
	const row = rows[0];
	if (!row) return null;
	await autoSubmitIfExpired(row.id);
	const after = await getAttempt(row.id);
	return after?.status === "in_progress"
		? { attemptId: row.id, examId: row.exam_set_id }
		: null;
}

export interface StartResult {
	attemptId: number;
	examId: number;
	title: string;
	questions: AttemptQuestionView[];
	savedAnswers: Record<number, { selectedIndex?: number; answerText?: string }>;
	deadlineAt: string;
	serverNow: string;
	maxViolations: number;
	violations: number;
	/** 새로 발급한 경우에만 — 브라우저가 보관했다가 이후 모든 요청에 x-exam-token으로 보낸다. */
	deviceToken?: string;
	/** 화면 워터마크용(이름·학번) — 사진으로 문제가 새면 누구 화면인지 드러나게 한다. */
	watermark: string;
}

async function violationCount(attemptId: number): Promise<number> {
	const { rows } = await pool.query<{ n: string }>(
		"SELECT count(*) AS n FROM exam_proctor_events WHERE attempt_id = $1 AND event_type = ANY($2::text[])",
		[attemptId, [...OFFICIAL_VIOLATION_TYPES]],
	);
	return Number(rows[0].n);
}

async function startPayload(
	exam: ExamRow,
	attempt: AttemptRow,
	deviceToken?: string,
): Promise<StartResult> {
	const resumed = await resumeAttempt(attempt);
	const { rows: who } = await pool.query<{
		name: string;
		student_id: string | null;
	}>("SELECT name, student_id FROM users WHERE id = $1", [attempt.user_id]);
	return {
		attemptId: attempt.id,
		examId: exam.id,
		title: exam.title,
		questions: resumed.questions,
		savedAnswers: resumed.savedAnswers,
		deadlineAt: new Date(attemptDeadline(attempt)!).toISOString(),
		serverNow: new Date().toISOString(),
		maxViolations: exam.max_violations,
		violations: await violationCount(attempt.id),
		...(deviceToken ? { deviceToken } : {}),
		watermark: [who[0]?.name, who[0]?.student_id].filter(Boolean).join(" · "),
	};
}

export async function startOfficialExam(
	userId: number,
	examId: number,
	token: string | undefined,
	meta: { ip?: string; userAgent?: string },
): Promise<StartResult> {
	const exam = await getExam(examId);
	if (!exam.is_published)
		throw new OfficialExamError("시험을 찾을 수 없습니다.", 404);

	const { rows: prev } = await pool.query<AttemptRow>(
		`SELECT * FROM exam_attempts WHERE user_id = $1 AND exam_set_id = $2 AND is_official AND status <> 'invalidated'
     ORDER BY started_at DESC LIMIT 1`,
		[userId, examId],
	);
	const existing = prev[0];
	if (existing) {
		if (existing.status !== "in_progress" || isTimeExpired(existing)) {
			await autoSubmitIfExpired(existing.id);
			throw new OfficialExamError(
				"이미 응시를 마친 시험입니다.",
				409,
				"ALREADY_SUBMITTED",
			);
		}
		if (!existing.device_token_hash) {
			// 관리자가 기기 잠금을 풀어 준 경우 — 지금 기기에 새 토큰을 준다.
			const fresh = randomBytes(32).toString("base64url");
			const { rows: claimed } = await pool.query<AttemptRow>(
				"UPDATE exam_attempts SET device_token_hash = $2 WHERE id = $1 AND device_token_hash IS NULL AND status = 'in_progress' RETURNING *",
				[existing.id, hashToken(fresh)],
			);
			if (!claimed[0])
				throw new OfficialExamError(
					DEVICE_LOCKED_MESSAGE,
					409,
					"DEVICE_LOCKED",
				);
			return startPayload(exam, claimed[0], fresh);
		}
		if (!deviceMatches(existing, token)) {
			await pool.query(
				"INSERT INTO exam_proctor_events (attempt_id, event_type, detail) VALUES ($1, 'second_device', $2)",
				[
					existing.id,
					JSON.stringify({
						ip: meta.ip ?? null,
						userAgent: (meta.userAgent ?? "").slice(0, 200),
					}),
				],
			);
			await pool.query(
				"UPDATE exam_attempts SET flagged_for_review = true WHERE id = $1",
				[existing.id],
			);
			throw new OfficialExamError(DEVICE_LOCKED_MESSAGE, 409, "DEVICE_LOCKED");
		}
		return startPayload(exam, existing);
	}

	const status = examStatus(exam);
	if (status === "upcoming") {
		throw new OfficialExamError(
			`아직 응시 기간이 아닙니다. 시작: ${new Date(exam.scheduled_start).toLocaleString("ko-KR")}`,
			409,
			"NOT_OPEN",
		);
	}
	if (status === "closed")
		throw new OfficialExamError("응시 기간이 끝났습니다.", 409, "CLOSED");

	const approved = await fetchApprovedQuestions(exam.question_ids, {
		includeExamOnly: true,
	});
	const ordered = exam.question_ids.filter((id) => approved.has(id));
	if (ordered.length !== exam.question_ids.length)
		throw new OfficialExamError(
			"시험 문항 구성이 변경되었습니다. 선생님께 문의하세요.",
		);
	// 문항 순서와 보기 순서를 학생마다 다르게 섞는다(옆 사람과 화면이 다르다).
	const shuffled = shuffleIndices(ordered.length).map((i) => ordered[i]);
	const choiceOrder: Record<number, number[]> = {};
	for (const qid of shuffled)
		choiceOrder[qid] = buildChoiceOrder(approved.get(qid)!).order;

	const now = Date.now();
	const deadline = new Date(
		Math.min(
			now + exam.duration_minutes * 60_000,
			new Date(exam.scheduled_end).getTime(),
		),
	);
	const deviceToken = randomBytes(32).toString("base64url");
	let attempt: AttemptRow;
	try {
		const { rows } = await pool.query<AttemptRow>(
			`INSERT INTO exam_attempts (exam_set_id, user_id, question_ids, choice_order, time_limit_minutes, is_official,
                                  deadline_at, device_token_hash, last_heartbeat_at, start_ip, start_user_agent)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7, now(), $8, $9) RETURNING *`,
			[
				examId,
				userId,
				shuffled,
				JSON.stringify(choiceOrder),
				exam.duration_minutes,
				deadline,
				hashToken(deviceToken),
				meta.ip?.slice(0, 64) ?? null,
				meta.userAgent?.slice(0, 300) ?? null,
			],
		);
		attempt = rows[0];
	} catch (err) {
		// 같은 학생의 시작 요청이 거의 동시에 두 번 들어와 다른 쪽이 먼저 만든 경우(학생당 1회 유니크 인덱스).
		if ((err as { code?: string }).code === "23505")
			throw new OfficialExamError(DEVICE_LOCKED_MESSAGE, 409, "DEVICE_LOCKED");
		throw err;
	}
	return startPayload(exam, attempt, deviceToken);
}

export async function answerOfficial(
	userId: number,
	attemptId: number,
	token: string | undefined,
	body: unknown,
) {
	await myOfficialAttempt(userId, attemptId, token);
	const b = (body ?? {}) as Record<string, unknown>;
	const questionId = Number(b.questionId);
	if (!Number.isInteger(questionId))
		throw new OfficialExamError("questionId가 필요합니다.");
	const selectedIndex =
		typeof b.selectedIndex === "number" && Number.isInteger(b.selectedIndex)
			? b.selectedIndex
			: undefined;
	const answerText =
		typeof b.answerText === "string" ? b.answerText.slice(0, 5000) : undefined;
	if (selectedIndex === undefined && answerText === undefined)
		throw new OfficialExamError("답이 필요합니다.");
	try {
		await submitAnswer({
			attemptId,
			userId,
			questionId,
			selectedDisplayIndex: selectedIndex,
			answerText,
			official: true,
		});
	} catch (err) {
		throw new OfficialExamError(
			err instanceof Error ? err.message : String(err),
		);
	}
	// 정오답은 절대 돌려주지 않는다.
	return { recorded: true };
}

export async function submitOfficial(
	userId: number,
	attemptId: number,
	token: string | undefined,
) {
	await myOfficialAttempt(userId, attemptId, token);
	try {
		await submitAttempt(attemptId, userId, { official: true });
	} catch (err) {
		throw new OfficialExamError(
			err instanceof Error ? err.message : String(err),
			409,
		);
	}
	return { submitted: true };
}

export async function heartbeatOfficial(
	userId: number,
	attemptId: number,
	token: string | undefined,
) {
	const attempt = await myOfficialAttempt(userId, attemptId, token);
	await autoSubmitIfExpired(attemptId);
	const current = (await getAttempt(attemptId))!;
	if (current.status === "in_progress") {
		// 신호가 한동안 끊겼다면(창을 닫았다 다시 열었거나, 다른 일을 했거나) 위반으로 센다.
		const last = attempt.last_heartbeat_at
			? new Date(attempt.last_heartbeat_at).getTime()
			: null;
		const gapSec = last ? Math.round((Date.now() - last) / 1000) : 0;
		await pool.query(
			"UPDATE exam_attempts SET last_heartbeat_at = now() WHERE id = $1",
			[attemptId],
		);
		if (gapSec > HEARTBEAT_GAP_SECONDS) {
			await logProctorEvent(
				attemptId,
				userId,
				"heartbeat_gap",
				{ gapSec },
				{ official: true },
			);
		}
	}
	const after = (await getAttempt(attemptId))!;
	return {
		status: after.status,
		deadlineAt: new Date(attemptDeadline(after)!).toISOString(),
		serverNow: new Date().toISOString(),
		violations: await violationCount(attemptId),
	};
}

const RECORD_ONLY_EVENTS = new Set([
	"copy",
	"cut",
	"paste",
	"right_click",
	"print",
	"shortcut",
	"select",
	"drag",
	"fullscreen_unsupported",
	"resume",
]);

export async function proctorEventOfficial(
	userId: number,
	attemptId: number,
	token: string | undefined,
	body: unknown,
) {
	await myOfficialAttempt(userId, attemptId, token);
	const b = (body ?? {}) as Record<string, unknown>;
	const eventType = typeof b.eventType === "string" ? b.eventType : "";
	if (
		!OFFICIAL_VIOLATION_TYPES.has(eventType) &&
		!RECORD_ONLY_EVENTS.has(eventType)
	) {
		throw new OfficialExamError("알 수 없는 이벤트입니다.");
	}
	// heartbeat_gap은 서버만 기록한다(화면이 마음대로 위반을 지어내거나 숨길 수 없게).
	if (eventType === "heartbeat_gap")
		throw new OfficialExamError("알 수 없는 이벤트입니다.");
	const result = await logProctorEvent(
		attemptId,
		userId,
		eventType,
		b.detail ?? {},
		{ official: true },
	);
	return {
		autoSubmitted: result.autoSubmit,
		violations: result.violations ?? 0,
		maxViolations: result.maxViolations ?? 0,
	};
}

export async function resultForStudent(userId: number, examId: number) {
	const exam = await getExam(examId);
	if (!exam.is_published)
		throw new OfficialExamError("시험을 찾을 수 없습니다.", 404);
	const { rows } = await pool.query<AttemptRow>(
		`SELECT * FROM exam_attempts WHERE user_id = $1 AND exam_set_id = $2 AND is_official AND status <> 'invalidated'
     ORDER BY started_at DESC LIMIT 1`,
		[userId, examId],
	);
	const attempt = rows[0];
	if (!attempt) throw new OfficialExamError("응시 기록이 없습니다.", 404);
	if (attempt.status === "in_progress") await autoSubmitIfExpired(attempt.id);
	const current = (await getAttempt(attempt.id))!;
	if (current.status === "in_progress")
		throw new OfficialExamError("아직 응시 중인 시험입니다.", 409);
	if (!exam.results_released) {
		return {
			released: false as const,
			title: exam.title,
			status: current.status,
			submittedAt: current.submitted_at,
		};
	}
	const result = await buildResultItems(current);
	let rank: { rank: number; participants: number } | null = null;
	if (exam.rank_released) {
		const { rows: r } = await pool.query<{
			rank: string;
			participants: string;
		}>(
			`WITH valid AS (
         SELECT id, score FROM exam_attempts
         WHERE exam_set_id = $1 AND is_official AND status IN ('submitted','auto_submitted') AND score IS NOT NULL
       )
       SELECT (SELECT count(*) FROM valid WHERE score > (SELECT score FROM valid WHERE id = $2)) + 1 AS rank,
              (SELECT count(*) FROM valid) AS participants`,
			[examId, current.id],
		);
		if (r[0])
			rank = {
				rank: Number(r[0].rank),
				participants: Number(r[0].participants),
			};
	}
	return {
		released: true as const,
		title: exam.title,
		status: current.status,
		submittedAt: current.submitted_at,
		score: current.score === null ? null : Number(current.score),
		correctCount: result.correctCount,
		total: result.total,
		items: result.items,
		rank,
	};
}
