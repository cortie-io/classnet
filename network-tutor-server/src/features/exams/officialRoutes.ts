import { isArchivePeriod } from "../../infrastructure/db/pool.js";
import { Router, type Request, type Response } from "express";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import { pool } from "../../infrastructure/db/pool.js";
import {
	attemptStartLimiter,
	examWriteLimiter,
	limitPerUser,
} from "../auth/rateLimit.js";

const writeLimit = limitPerUser(
	examWriteLimiter,
	"요청이 너무 잦아요. 잠시 후 다시 시도해 주세요.",
);
const startLimit = limitPerUser(
	attemptStartLimiter,
	"요청이 너무 잦아요. 잠시 후 다시 시도해 주세요.",
);
import {
	OfficialExamError,
	activeOfficialAttempt,
	answerOfficial,
	attemptDetailAdmin,
	autoPickQuestionIds,
	createExamOnlyQuestion,
	createOfficialExam,
	deleteOfficialExam,
	exportCsv,
	forceSubmit,
	heartbeatOfficial,
	invalidateAttempt,
	listOfficialExamsAdmin,
	listOfficialExamsForStudent,
	officialExamDetailAdmin,
	proctorEventOfficial,
	resetDeviceLock,
	resultForStudent,
	setPublished,
	setRelease,
	startOfficialExam,
	submitOfficial,
	updateOfficialExam,
} from "./services/officialExam.js";

export const officialExamRouter = Router();
officialExamRouter.use("/admin/official-exams", (_req, res, next) => {
	if (isArchivePeriod())
		return res
			.status(404)
			.json({
				error:
					"이 기능은 2차부터 제공됩니다. 1차 기존 학습 기록은 학생 관리에서 조회해 주세요.",
			});
	next();
});

function idParam(req: Request, name: string): number {
	const raw = req.params[name];
	if (!/^\d{1,9}$/.test(raw ?? ""))
		throw new OfficialExamError("잘못된 번호입니다.", 400);
	return Number(raw);
}

function examToken(req: Request): string | undefined {
	const t = req.get("x-exam-token");
	return t && /^[A-Za-z0-9_-]{20,100}$/.test(t) ? t : undefined;
}

// 웹 서버(Next)를 거쳐 온 요청이면 실제 학생 IP는 웹이 x-client-ip로 넘겨 준다 — 내부 시크릿이 검증된
// 요청(attachUser가 internalCall을 세운 경우)에서만 이 헤더를 믿는다.
function clientIp(req: Request): string | undefined {
	if (req.internalCall) return req.get("x-client-ip")?.slice(0, 64);
	return req.ip;
}

type Handler = (req: Request, res: Response) => Promise<unknown>;
function handle(fn: Handler) {
	return async (req: Request, res: Response) => {
		try {
			const data = await fn(req, res);
			if (!res.headersSent) res.json(data ?? { ok: true });
		} catch (err) {
			if (err instanceof OfficialExamError) {
				res
					.status(err.status)
					.json({
						error: err.message,
						...(err.code ? { code: err.code } : {}),
					});
				return;
			}
			throw err;
		}
	};
}

// ---------- 관리자 ----------
officialExamRouter.get(
	"/admin/official-exams",
	requireAdmin,
	handle(() => listOfficialExamsAdmin()),
);
officialExamRouter.post(
	"/admin/official-exams",
	requireAdmin,
	handle((req) => createOfficialExam(req.user!.id, req.body)),
);
officialExamRouter.post(
	"/admin/official-exams/questions",
	requireAdmin,
	handle((req) => createExamOnlyQuestion(req.body)),
);
officialExamRouter.post(
	"/admin/official-exams/auto-pick",
	requireAdmin,
	handle(async (req) => {
		const exclude = Array.isArray(req.body?.excludeIds)
			? req.body.excludeIds.slice(0, 500).map(Number).filter(Number.isInteger)
			: [];
		const questionIds = await autoPickQuestionIds(exclude);
		const { rows } = await pool.query<{
			id: number;
			subject: string;
			stem: string;
			status: string;
		}>(
			"SELECT id, subject, stem, status FROM exam_questions WHERE id = ANY($1::int[])",
			[questionIds],
		);
		const byId = new Map(rows.map((r) => [r.id, r]));
		return { questions: questionIds.map((id) => byId.get(id)).filter(Boolean) };
	}),
);
officialExamRouter.get(
	"/admin/official-exams/:id",
	requireAdmin,
	handle((req) => officialExamDetailAdmin(idParam(req, "id"))),
);
officialExamRouter.patch(
	"/admin/official-exams/:id",
	requireAdmin,
	handle((req) => updateOfficialExam(idParam(req, "id"), req.body)),
);
officialExamRouter.delete(
	"/admin/official-exams/:id",
	requireAdmin,
	handle((req) => deleteOfficialExam(idParam(req, "id"))),
);
officialExamRouter.post(
	"/admin/official-exams/:id/publish",
	requireAdmin,
	handle((req) => setPublished(idParam(req, "id"), true)),
);
officialExamRouter.post(
	"/admin/official-exams/:id/unpublish",
	requireAdmin,
	handle((req) => setPublished(idParam(req, "id"), false)),
);
officialExamRouter.post(
	"/admin/official-exams/:id/release",
	requireAdmin,
	handle((req) => setRelease(idParam(req, "id"), req.body)),
);
officialExamRouter.get(
	"/admin/official-exams/:id/export",
	requireAdmin,
	handle(async (req) => ({ csv: await exportCsv(idParam(req, "id")) })),
);
officialExamRouter.get(
	"/admin/official-exams/:id/attempts/:attemptId",
	requireAdmin,
	handle((req) =>
		attemptDetailAdmin(idParam(req, "id"), idParam(req, "attemptId")),
	),
);
officialExamRouter.post(
	"/admin/official-exams/:id/attempts/:attemptId/reset-device",
	requireAdmin,
	handle((req) =>
		resetDeviceLock(
			idParam(req, "id"),
			idParam(req, "attemptId"),
			req.user!.id,
		),
	),
);
officialExamRouter.post(
	"/admin/official-exams/:id/attempts/:attemptId/force-submit",
	requireAdmin,
	handle((req) =>
		forceSubmit(idParam(req, "id"), idParam(req, "attemptId"), req.user!.id),
	),
);
officialExamRouter.post(
	"/admin/official-exams/:id/attempts/:attemptId/invalidate",
	requireAdmin,
	handle((req) =>
		invalidateAttempt(
			idParam(req, "id"),
			idParam(req, "attemptId"),
			req.user!.id,
		),
	),
);

// ---------- 학생 ----------
officialExamRouter.get(
	"/official-exams",
	requireAuth,
	handle((req) => listOfficialExamsForStudent(req.user!.id)),
);
officialExamRouter.get(
	"/official-exams/active",
	requireAuth,
	handle(async (req) => ({
		active: await activeOfficialAttempt(req.user!.id),
	})),
);
officialExamRouter.post(
	"/official-exams/:id/start",
	requireAuth,
	startLimit,
	handle((req) =>
		startOfficialExam(req.user!.id, idParam(req, "id"), examToken(req), {
			ip: clientIp(req),
			userAgent:
				(req.internalCall ? req.get("x-client-user-agent") : undefined) ??
				req.get("user-agent"),
		}),
	),
);
officialExamRouter.get(
	"/official-exams/:id/result",
	requireAuth,
	handle((req) => resultForStudent(req.user!.id, idParam(req, "id"))),
);
officialExamRouter.post(
	"/official-exams/attempts/:attemptId/answer",
	requireAuth,
	writeLimit,
	handle((req) =>
		answerOfficial(
			req.user!.id,
			idParam(req, "attemptId"),
			examToken(req),
			req.body,
		),
	),
);
officialExamRouter.post(
	"/official-exams/attempts/:attemptId/submit",
	requireAuth,
	writeLimit,
	handle((req) =>
		submitOfficial(req.user!.id, idParam(req, "attemptId"), examToken(req)),
	),
);
officialExamRouter.post(
	"/official-exams/attempts/:attemptId/heartbeat",
	requireAuth,
	writeLimit,
	handle((req) =>
		heartbeatOfficial(req.user!.id, idParam(req, "attemptId"), examToken(req)),
	),
);
officialExamRouter.post(
	"/official-exams/attempts/:attemptId/event",
	requireAuth,
	writeLimit,
	handle((req) =>
		proctorEventOfficial(
			req.user!.id,
			idParam(req, "attemptId"),
			examToken(req),
			req.body,
		),
	),
);
