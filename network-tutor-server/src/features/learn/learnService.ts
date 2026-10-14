import { pool } from "../../infrastructure/db/pool.js";
import {
	createAttempt,
	getAttempt,
	lockedQuestionIdsForUser,
	resumeAttempt,
	isTimeExpired,
} from "../exams/services/examService.js";
import {
	buildTopicTerms,
	searchBankByPatterns,
	searchBankBySubject,
} from "../tutor/pipeline/practiceTopic.js";

// 처음부터 배우기 — 단원 진도와 단원 확인 문제.
// 단원 목록은 웹의 curriculum.ts가 정하므로 서버는 slug 모양만 검사한다(모르는 단원을 저장해도 화면에 안 나올 뿐).

export class LearnError extends Error {
	constructor(
		message: string,
		readonly status = 400,
	) {
		super(message);
	}
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+){0,9}$/;
// 확인 문제 묶음(웹 curriculum.ts의 quiz.topic) → 문제은행의 subject 값.
export const TOPIC_BUCKET: Record<string, string> = {
	general: "1과목_네트워크_일반",
	tcpip: "2과목_TCP_IP",
	nos: "3과목_NOS",
	devices: "4과목_네트워크_운용기기",
};
export const LESSON_QUIZ_SIZE = 5;

export function validSlug(slug: unknown): slug is string {
	return typeof slug === "string" && slug.length <= 60 && SLUG_RE.test(slug);
}

export interface LessonProgress {
	slug: string;
	firstReadAt: string | null;
	lastReadAt: string | null;
	completedAt: string | null;
	quizCorrect: number | null;
	quizTotal: number | null;
}

interface ProgressRow {
	lesson_slug: string;
	first_read_at: Date | null;
	last_read_at: Date | null;
	completed_at: Date | null;
	quiz_correct: number | null;
	quiz_total: number | null;
}

function toView(r: ProgressRow): LessonProgress {
	return {
		slug: r.lesson_slug,
		firstReadAt: r.first_read_at?.toISOString() ?? null,
		lastReadAt: r.last_read_at?.toISOString() ?? null,
		completedAt: r.completed_at?.toISOString() ?? null,
		quizCorrect: r.quiz_correct,
		quizTotal: r.quiz_total,
	};
}

export async function getProgress(
	userId: number,
): Promise<{ lessons: LessonProgress[]; lastSlug: string | null }> {
	const { rows } = await pool.query<ProgressRow & { updated_at: Date }>(
		`SELECT lesson_slug, first_read_at, last_read_at, completed_at, quiz_correct, quiz_total, updated_at
     FROM learn_progress WHERE user_id = $1 ORDER BY updated_at DESC`,
		[userId],
	);
	return { lessons: rows.map(toView), lastSlug: rows[0]?.lesson_slug ?? null };
}

export async function markRead(
	userId: number,
	slug: string,
): Promise<LessonProgress> {
	if (!validSlug(slug)) throw new LearnError("잘못된 단원입니다.");
	const { rows } = await pool.query<ProgressRow>(
		`INSERT INTO learn_progress (user_id, lesson_slug, first_read_at, last_read_at, updated_at)
     VALUES ($1, $2, now(), now(), now())
     ON CONFLICT (user_id, lesson_slug) DO UPDATE
       SET first_read_at = COALESCE(learn_progress.first_read_at, now()), last_read_at = now(), updated_at = now()
     RETURNING lesson_slug, first_read_at, last_read_at, completed_at, quiz_correct, quiz_total`,
		[userId, slug],
	);
	return toView(rows[0]);
}

/** 단원을 끝낸 것으로 기록한다. 확인 문제를 풀었다면 그 응시(제출된 것)의 점수를 함께 남긴다. */
export async function markComplete(
	userId: number,
	slug: string,
	attemptId?: number | null,
): Promise<LessonProgress> {
	if (!validSlug(slug)) throw new LearnError("잘못된 단원입니다.");
	let correct: number | null = null;
	let total: number | null = null;
	if (attemptId != null) {
		if (!Number.isInteger(attemptId) || attemptId <= 0)
			throw new LearnError("잘못된 응시입니다.");
		const { rows: own } = await pool.query<{ attempt_id: number }>(
			"SELECT quiz_attempt_id AS attempt_id FROM learn_progress WHERE user_id = $1 AND lesson_slug = $2",
			[userId, slug],
		);
		// 이 단원에서 시작한 확인 문제만 점수로 인정한다(다른 연습 응시 번호를 끼워 넣지 못하게).
		if (own[0]?.attempt_id !== attemptId)
			throw new LearnError("이 단원의 확인 문제가 아닙니다.");
		const att = await getAttempt(attemptId);
		if (!att || att.user_id !== userId)
			throw new LearnError("이 단원의 확인 문제가 아닙니다.");
		if (att.status !== "submitted" && att.status !== "auto_submitted")
			throw new LearnError("확인 문제를 먼저 제출해 주세요.");
		const { rows } = await pool.query<{ correct: string }>(
			"SELECT count(*) FILTER (WHERE is_correct) AS correct FROM exam_answers WHERE attempt_id = $1",
			[attemptId],
		);
		correct = Number(rows[0]?.correct ?? 0);
		total = att.question_ids.length;
	}
	const { rows } = await pool.query<ProgressRow>(
		`INSERT INTO learn_progress (user_id, lesson_slug, first_read_at, last_read_at, completed_at, quiz_correct, quiz_total, updated_at)
     VALUES ($1, $2, now(), now(), now(), $3, $4, now())
     ON CONFLICT (user_id, lesson_slug) DO UPDATE
       SET completed_at = COALESCE(learn_progress.completed_at, now()),
           first_read_at = COALESCE(learn_progress.first_read_at, now()),
           last_read_at = now(),
           quiz_correct = COALESCE($3, learn_progress.quiz_correct),
           quiz_total = COALESCE($4, learn_progress.quiz_total),
           updated_at = now()
     RETURNING lesson_slug, first_read_at, last_read_at, completed_at, quiz_correct, quiz_total`,
		[userId, slug, correct, total],
	);
	return toView(rows[0]);
}

function cleanTerms(terms: unknown): string[] {
	if (!Array.isArray(terms)) return [];
	return terms
		.filter((t): t is string => typeof t === "string")
		.map((t) => t.trim())
		.filter((t) => t.length > 0 && t.length <= 30)
		.slice(0, 12);
}

/**
 * 단원 확인 문제를 연다. 단원의 주제어가 지문에 나오는 문제은행 문제를 먼저(안 풀어 본 것 우선), 모자라면
 * 같은 과목에서 채운다. 이 단원에서 열어 둔 확인 문제가 아직 진행 중이면 새로 만들지 않고 그대로 이어 준다.
 */
export async function startLessonQuiz(
	userId: number,
	input: { slug: unknown; topic: unknown; terms: unknown; title?: unknown },
) {
	const { slug, topic } = input;
	if (!validSlug(slug)) throw new LearnError("잘못된 단원입니다.");
	const subject =
		typeof topic === "string" && Object.hasOwn(TOPIC_BUCKET, topic)
			? TOPIC_BUCKET[topic]
			: null;
	if (!subject) throw new LearnError("잘못된 과목입니다.");
	const terms = cleanTerms(input.terms);
	if (terms.length === 0)
		throw new LearnError("확인 문제를 고를 주제어가 없습니다.");

	const { rows: prev } = await pool.query<{ attempt_id: number | null }>(
		"SELECT quiz_attempt_id AS attempt_id FROM learn_progress WHERE user_id = $1 AND lesson_slug = $2",
		[userId, slug],
	);
	if (prev[0]?.attempt_id) {
		const att = await getAttempt(prev[0].attempt_id);
		if (
			att &&
			att.user_id === userId &&
			att.status === "in_progress" &&
			!isTimeExpired(att)
		) {
			return resumeAttempt(att);
		}
	}

	const locked = [...(await lockedQuestionIdsForUser(userId))];
	const { patterns } = buildTopicTerms(terms);
	// 같은 과목 묶음에서 주제어가 나오는 문제 → 모자라면 다른 과목에서도 주제어 문제 → 그래도 모자라면 같은 묶음에서 채운다.
	const picked = await searchBankByPatterns({
		userId,
		patterns,
		excludeIds: locked,
		subject,
		limit: LESSON_QUIZ_SIZE,
	});
	if (picked.length < LESSON_QUIZ_SIZE) {
		picked.push(
			...(await searchBankByPatterns({
				userId,
				patterns,
				excludeIds: [...locked, ...picked],
				subject: null,
				limit: LESSON_QUIZ_SIZE - picked.length,
			})),
		);
	}
	if (picked.length < LESSON_QUIZ_SIZE) {
		picked.push(
			...(await searchBankBySubject({
				userId,
				subject,
				excludeIds: [...locked, ...picked],
				limit: LESSON_QUIZ_SIZE - picked.length,
			})),
		);
	}
	if (picked.length === 0)
		throw new LearnError("이 단원에 맞는 문제를 찾지 못했어요.");

	const title =
		typeof input.title === "string" ? input.title.slice(0, 60) : slug;
	const result = await createAttempt({
		userId,
		kind: "practice_custom",
		questionIds: picked,
		title: `단원 확인 · ${title}`,
	});
	await pool.query(
		`INSERT INTO learn_progress (user_id, lesson_slug, first_read_at, last_read_at, quiz_attempt_id, updated_at)
     VALUES ($1, $2, now(), now(), $3, now())
     ON CONFLICT (user_id, lesson_slug) DO UPDATE SET quiz_attempt_id = $3, last_read_at = now(), updated_at = now()`,
		[userId, slug, result.attemptId],
	);
	return result;
}

/** 관리자: 학생별 진도 요약. */
export async function progressOverview() {
	const { rows } = await pool.query<{
		id: number;
		name: string;
		student_id: string | null;
		completed: string;
		read: string;
		last_slug: string | null;
		last_at: Date | null;
		quiz_correct: string | null;
		quiz_total: string | null;
	}>(
		`SELECT u.id, u.name, u.student_id,
            count(p.completed_at) AS completed,
            count(p.first_read_at) AS read,
            (SELECT lesson_slug FROM learn_progress l WHERE l.user_id = u.id ORDER BY updated_at DESC LIMIT 1) AS last_slug,
            max(p.updated_at) AS last_at,
            sum(p.quiz_correct) AS quiz_correct,
            sum(p.quiz_total) AS quiz_total
     FROM users u LEFT JOIN learn_progress p ON p.user_id = u.id
     WHERE u.role = 'student'
     GROUP BY u.id
     ORDER BY max(p.updated_at) DESC NULLS LAST, u.name`,
	);
	const { rows: perLesson } = await pool.query<{
		lesson_slug: string;
		completed: string;
		read: string;
	}>(
		`SELECT lesson_slug, count(completed_at) AS completed, count(first_read_at) AS read
     FROM learn_progress p JOIN users u ON u.id = p.user_id AND u.role = 'student'
     GROUP BY lesson_slug`,
	);
	return {
		students: rows.map((r) => ({
			userId: r.id,
			name: r.name,
			studentId: r.student_id,
			completed: Number(r.completed),
			read: Number(r.read),
			lastSlug: r.last_slug,
			lastAt: r.last_at?.toISOString() ?? null,
			quizCorrect: r.quiz_correct == null ? null : Number(r.quiz_correct),
			quizTotal: r.quiz_total == null ? null : Number(r.quiz_total),
		})),
		lessons: perLesson.map((r) => ({
			slug: r.lesson_slug,
			completed: Number(r.completed),
			read: Number(r.read),
		})),
	};
}
