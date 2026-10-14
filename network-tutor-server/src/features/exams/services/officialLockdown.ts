import type { NextFunction, Request, Response } from "express";
import { pool } from "../../../infrastructure/db/pool.js";
import { autoSubmitIfExpired, getAttempt } from "./examService.js";

// 공식 모의시험·지정 시험을 치르는 동안에는 그 시험 API 말고는 아무것도 쓸 수 없다 — AI 튜터에게 문제를
// 물어보거나, 문제은행·해설·오답노트·개념 카드에서 답을 찾아보는 길을 서버에서 막는다(화면을 고쳐도
// 우회할 수 없게). 로그인·로그아웃·시험일 표시처럼 답을 알려 줄 수 없는 것만 열어 둔다.
// 학생이 스스로 시작하는 모의고사(mock)는 실전 연습일 뿐이라 막지 않는다 — 이어 풀 화면이 없어서, 창을
// 닫으면 60분 동안 아무것도 못 쓰게 되는 문제가 생긴다(그 시험 문항의 해설·연습은 따로 잠겨 있다).
const ALWAYS_ALLOWED = [/^\/auth(\/|$)/, /^\/settings\/exam-date$/];
const ALLOWED_BY_KIND: Record<string, RegExp[]> = {
	official: [/^\/official-exams(\/|$)/],
	admin_timed: [
		/^\/exam\/attempts\/\d+(\/(answer|submit|proctor-event))?$/,
		/^\/exam\/timed(\/\d+\/start)?$/,
	],
};

export const OFFICIAL_LOCKDOWN_MESSAGE =
	"시험 응시 중에는 다른 기능을 사용할 수 없어요. 시험을 제출한 뒤에 이용해 주세요.";

/** 지금 치르고 있는 공식 모의시험·지정 시험 응시(마감이 지났으면 자동 제출하고 없는 것으로 본다). */
export async function activeLockedAttempt(
	userId: number,
): Promise<{ kind: string; attemptId: number; examId: number } | null> {
	const { rows } = await pool.query<{
		id: number;
		exam_set_id: number;
		kind: string;
	}>(
		`SELECT a.id, a.exam_set_id, s.kind FROM exam_attempts a JOIN exam_sets s ON s.id = a.exam_set_id
     WHERE a.user_id = $1 AND a.status = 'in_progress' AND s.kind IN ('official', 'admin_timed')`,
		[userId],
	);
	for (const row of rows) {
		await autoSubmitIfExpired(row.id);
		if ((await getAttempt(row.id))?.status === "in_progress")
			return { kind: row.kind, attemptId: row.id, examId: row.exam_set_id };
	}
	return null;
}

export async function officialExamLockdown(
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> {
	if (
		!req.user ||
		req.user.role !== "student" ||
		ALWAYS_ALLOWED.some((re) => re.test(req.path))
	)
		return next();
	const active = await activeLockedAttempt(req.user.id);
	if (
		!active ||
		(ALLOWED_BY_KIND[active.kind] ?? []).some((re) => re.test(req.path))
	)
		return next();
	res
		.status(423)
		.json({
			error: OFFICIAL_LOCKDOWN_MESSAGE,
			code: "EXAM_IN_PROGRESS",
			kind: active.kind,
			examId: active.examId,
		});
}
