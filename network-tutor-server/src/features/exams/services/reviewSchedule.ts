import { pool } from "../../../infrastructure/db/pool.js";
import { lockedQuestionIdsForUser } from "./examService.js";

/**
 * 오답 복습 일정(간단한 간격 반복) — 별도 테이블 없이 지금까지의 풀이 기록(exam_answers)만으로 계산한다.
 * 관리자가 설정할 것도, 학생이 따로 등록할 것도 없다.
 *
 *   틀림            → 다음 날부터 "오늘의 복습"에 나온다
 *   틀린 뒤 1번 맞힘 → 맞힌 날로부터 3일 뒤 한 번 더 확인
 *   틀린 뒤 2번 맞힘 → 극복(복습 목록에서 빠짐). 다시 틀리면 처음부터
 *
 * 날짜는 한국 시간 기준 하루 단위로 센다 — 밤 11시에 틀린 문제가 1시간 뒤 바로 다시 나오지 않게.
 * (2026-10-23, 오답 3,750건 중 다시 풀어 본 것이 14%뿐이라 추가)
 */

export type ReviewState = "due" | "waiting" | "mastered";

export interface ReviewEntry {
	questionId: number;
	wrongCount: number;
	lastWrongAt: Date;
	lastAnsweredAt: Date;
	correctAfterWrong: number;
	state: ReviewState;
	/** 다음에 복습할 때(극복이면 null) */
	dueAt: Date | null;
}

const KST_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const REVIEW_SESSION_LIMIT = 20;
const RECHECK_AFTER_DAYS = 3;
const MASTERED_AFTER_CORRECT = 2;

/** 그 시각이 속한 한국 날짜의 0시(UTC 시각으로) */
export function kstDayStart(t: Date): number {
	return Math.floor((t.getTime() + KST_MS) / DAY_MS) * DAY_MS - KST_MS;
}

/** 한국 날짜 문자열 YYYY-MM-DD */
export function kstDate(t: Date): string {
	return new Date(t.getTime() + KST_MS).toISOString().slice(0, 10);
}

export function scheduleFor(
	entry: Pick<
		ReviewEntry,
		"lastWrongAt" | "lastAnsweredAt" | "correctAfterWrong"
	>,
	now: Date,
): { state: ReviewState; dueAt: Date | null } {
	if (entry.correctAfterWrong >= MASTERED_AFTER_CORRECT)
		return { state: "mastered", dueAt: null };
	const dueAt =
		entry.correctAfterWrong === 0
			? new Date(kstDayStart(entry.lastWrongAt) + DAY_MS)
			: new Date(
					kstDayStart(entry.lastAnsweredAt) + RECHECK_AFTER_DAYS * DAY_MS,
				);
	return { state: dueAt.getTime() <= now.getTime() ? "due" : "waiting", dueAt };
}

/**
 * 한 번이라도 틀린 문제마다 복습 상태. 오답노트와 같은 기준의 답만 센다 — 끝난 응시의 답이거나 연습에서
 * 정답을 공개한 답, 공식 시험·무효 응시 제외, 지금 진행 중인 시험에 들어 있는 문제 제외.
 */
export async function getReviewEntries(
	userId: number,
	now = new Date(),
): Promise<ReviewEntry[]> {
	const locked = [...(await lockedQuestionIdsForUser(userId))];
	const { rows } = await pool.query<{
		question_id: number;
		wrong_count: string;
		last_wrong_at: Date;
		last_answered_at: Date;
		correct_after: string;
	}>(
		`WITH ans AS (
       SELECT a.question_id, a.is_correct, a.answered_at
       FROM exam_answers a
       JOIN exam_attempts att ON att.id = a.attempt_id
       JOIN exam_questions q ON q.id = a.question_id
       WHERE att.user_id = $1 AND NOT att.is_official AND att.status <> 'invalidated'
         AND a.is_correct IS NOT NULL AND a.answered_at IS NOT NULL AND q.status = 'approved'
         AND (att.status IN ('submitted', 'auto_submitted') OR a.revealed_at IS NOT NULL)
         AND NOT (a.question_id = ANY($2::int[]))
     ), wrong AS (
       SELECT question_id, count(*) AS wrong_count, max(answered_at) AS last_wrong_at
       FROM ans WHERE NOT is_correct GROUP BY question_id
     )
     SELECT w.question_id, w.wrong_count, w.last_wrong_at,
            max(x.answered_at) AS last_answered_at,
            count(*) FILTER (WHERE x.is_correct AND x.answered_at > w.last_wrong_at) AS correct_after
     FROM wrong w JOIN ans x ON x.question_id = w.question_id
     GROUP BY w.question_id, w.wrong_count, w.last_wrong_at`,
		[userId, locked],
	);
	return rows.map((r) => {
		const base = {
			questionId: r.question_id,
			wrongCount: Number(r.wrong_count),
			lastWrongAt: r.last_wrong_at,
			lastAnsweredAt: r.last_answered_at,
			correctAfterWrong: Number(r.correct_after),
		};
		return { ...base, ...scheduleFor(base, now) };
	});
}

/** 오늘 복습할 문제 — 가장 오래 기다린 것부터 */
export function pickDueQuestions(
	entries: ReviewEntry[],
	limit = REVIEW_SESSION_LIMIT,
): number[] {
	return entries
		.filter((e) => e.state === "due")
		.sort(
			(a, b) =>
				(a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0) ||
				a.lastWrongAt.getTime() - b.lastWrongAt.getTime(),
		)
		.slice(0, limit)
		.map((e) => e.questionId);
}

export interface StudySummary {
	streakDays: number;
	studiedToday: boolean;
	todayAnswered: number;
	todayCorrect: number;
	/** 풀다 만 연습·기출(최근 3일) — 홈에서 "이어서 풀기" */
	unfinished: {
		attemptId: number;
		title: string;
		kind: string;
		answered: number;
		total: number;
	} | null;
	review: {
		dueCount: number;
		waitingCount: number;
		masteredCount: number;
		nextDueAt: Date | null;
	};
}

/** 연속 학습일 — 오늘(아직 안 했으면 어제)부터 거꾸로, 문제를 풀었거나 교재를 읽은 날이 이어진 만큼 */
export function countStreak(days: Set<string>, now: Date): number {
	let cursor = kstDayStart(now);
	if (!days.has(kstDate(new Date(cursor)))) cursor -= DAY_MS;
	let streak = 0;
	while (days.has(kstDate(new Date(cursor)))) {
		streak += 1;
		cursor -= DAY_MS;
	}
	return streak;
}

/** 홈 화면 "오늘의 학습" 카드용 — 가벼운 쿼리 몇 개라 캐시하지 않는다. */
export async function getStudySummary(
	userId: number,
	now = new Date(),
): Promise<StudySummary> {
	const since = new Date(kstDayStart(now) - 60 * DAY_MS);
	const todayStart = new Date(kstDayStart(now));
	const [entries, { rows: dayRows }, { rows: todayRows }, { rows: openRows }] = await Promise.all([
		getReviewEntries(userId, now),
		pool.query<{ t: Date }>(
			`SELECT a.answered_at AS t FROM exam_answers a JOIN exam_attempts att ON att.id = a.attempt_id
       WHERE att.user_id = $1 AND a.answered_at >= $2
       UNION ALL
       SELECT unnest(ARRAY[first_read_at, last_read_at, completed_at]) FROM learn_progress
       WHERE user_id = $1 AND last_read_at >= $2`,
			[userId, since],
		),
		pool.query<{ answered: string; correct: string }>(
			`SELECT count(*) AS answered, count(*) FILTER (WHERE a.is_correct) AS correct
       FROM exam_answers a JOIN exam_attempts att ON att.id = a.attempt_id
       WHERE att.user_id = $1 AND NOT att.is_official AND a.answered_at >= $2
         AND (att.status IN ('submitted', 'auto_submitted') OR a.revealed_at IS NOT NULL)`,
			[userId, todayStart],
		),
		pool.query<{ id: number; title: string; kind: string; total: number; answered: string }>(
			`SELECT att.id, s.title, s.kind, array_length(att.question_ids, 1) AS total,
              (SELECT count(*) FROM exam_answers a WHERE a.attempt_id = att.id
                 AND (a.selected_index IS NOT NULL OR a.answer_text IS NOT NULL)) AS answered
       FROM exam_attempts att JOIN exam_sets s ON s.id = att.exam_set_id
       WHERE att.user_id = $1 AND att.status = 'in_progress' AND NOT att.is_official
         AND s.kind IN ('practice_custom', 'past_exam_round') AND att.started_at > $2
       ORDER BY att.started_at DESC LIMIT 1`,
			[userId, new Date(now.getTime() - 3 * DAY_MS)],
		),
	]);
	const days = new Set(
		dayRows.filter((r) => r.t).map((r) => kstDate(new Date(r.t))),
	);
	const waiting = entries.filter((e) => e.state === "waiting");
	const nextDue = waiting
		.map((e) => e.dueAt?.getTime() ?? Number.POSITIVE_INFINITY)
		.reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
	return {
		streakDays: countStreak(days, now),
		studiedToday: days.has(kstDate(now)),
		todayAnswered: Number(todayRows[0]?.answered ?? 0),
		todayCorrect: Number(todayRows[0]?.correct ?? 0),
		unfinished: openRows[0]
			? {
					attemptId: openRows[0].id,
					title: openRows[0].title,
					kind: openRows[0].kind,
					answered: Number(openRows[0].answered),
					total: openRows[0].total,
				}
			: null,
		review: {
			dueCount: entries.filter((e) => e.state === "due").length,
			waitingCount: waiting.length,
			masteredCount: entries.filter((e) => e.state === "mastered").length,
			nextDueAt: Number.isFinite(nextDue) ? new Date(nextDue) : null,
		},
	};
}
