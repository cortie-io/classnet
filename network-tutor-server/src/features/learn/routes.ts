import { isArchivePeriod } from "../../infrastructure/db/pool.js";
import { Router } from "express";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import {
	attemptStartLimiter,
	examWriteLimiter,
	limitPerUser,
} from "../auth/rateLimit.js";
import {
	LearnError,
	getProgress,
	markComplete,
	markRead,
	progressOverview,
	startLessonQuiz,
} from "./learnService.js";

// 처음부터 배우기(학습 경로)와 교재 읽기 기록.
export const learnRouter = Router();
learnRouter.use("/admin/learn", (_req, res, next) => {
	if (isArchivePeriod())
		return res
			.status(404)
			.json({
				error:
					"이 기능은 2차부터 제공됩니다. 1차 기존 학습 기록은 학생 관리에서 조회해 주세요.",
			});
	next();
});

const startLimit = limitPerUser(
	attemptStartLimiter,
	"확인 문제를 너무 자주 열고 있어요. 잠시 후 다시 시도해 주세요.",
);
const writeLimit = limitPerUser(
	examWriteLimiter,
	"요청이 너무 잦아요. 잠시 후 다시 시도해 주세요.",
);

function fail(res: import("express").Response, err: unknown) {
	if (err instanceof LearnError)
		return res.status(err.status).json({ error: err.message });
	// 연습 응시를 만들며 서비스가 일부러 던진 안내 문구(잠긴 문제 등)는 그대로, DB 오류 같은 내부 메시지는 감춘다.
	if (
		err instanceof Error &&
		!(typeof (err as { code?: unknown }).code === "string")
	) {
		return res.status(400).json({ error: err.message });
	}
	console.error("[learn] 처리 중 오류:", err);
	return res
		.status(500)
		.json({ error: "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요." });
}

learnRouter.get("/learn/progress", requireAuth, async (req, res) => {
	try {
		res.json(await getProgress(req.user!.id));
	} catch (err) {
		fail(res, err);
	}
});

learnRouter.post(
	"/learn/progress",
	requireAuth,
	writeLimit,
	async (req, res) => {
		const { slug, action, attemptId } = req.body ?? {};
		try {
			if (action === "read")
				return res.json(await markRead(req.user!.id, slug));
			if (action === "complete") {
				return res.json(
					await markComplete(
						req.user!.id,
						slug,
						typeof attemptId === "number" ? attemptId : null,
					),
				);
			}
			return res.status(400).json({ error: "잘못된 요청입니다." });
		} catch (err) {
			fail(res, err);
		}
	},
);

learnRouter.post("/learn/quiz", requireAuth, startLimit, async (req, res) => {
	const { slug, subject, terms, title } = req.body ?? {};
	try {
		res.json(
			await startLessonQuiz(req.user!.id, { slug, subject, terms, title }),
		);
	} catch (err) {
		fail(res, err);
	}
});

learnRouter.get("/admin/learn/progress", requireAdmin, async (_req, res) => {
	try {
		res.json(await progressOverview());
	} catch (err) {
		fail(res, err);
	}
});
