import { randomUUID } from "node:crypto";
import { Router } from "express";
import { activePool } from "../../infrastructure/db/pool.js";
import { requireAdmin } from "../auth/middleware.js";
import { config } from "../../config.js";

export const launchRouter = Router();
launchRouter.get("/admin/service-launch", requireAdmin, async (_req, res) => {
	const { rows } = await activePool.query(
		"SELECT stage,requested_at,started_at,last_error FROM service_launch WHERE id=1",
	);
	res.setHeader("Cache-Control", "no-store");
	res.json(rows[0]);
});
launchRouter.post(
	"/admin/service-launch/start",
	requireAdmin,
	async (req, res) => {
		if (config.activePeriod !== "2")
			return res
				.status(409)
				.json({ error: "2차 서비스에서만 정식 시작할 수 있습니다." });
		if (req.body?.confirmation !== "2차 정식 시작")
			return res
				.status(400)
				.json({ error: "확인 문구 ‘2차 정식 시작’을 입력해 주세요." });
		const { rows } = await activePool.query(
			`UPDATE service_launch SET stage='starting',request_id=$1,requested_by=$2,requested_at=now(),last_error=NULL WHERE id=1 AND stage='beta' RETURNING stage,requested_at`,
			[randomUUID(), req.user!.id],
		);
		if (!rows.length)
			return res
				.status(409)
				.json({
					error:
						"이미 정식 운영 중이거나 전환을 진행하고 있습니다. 다시 초기화할 수 없습니다.",
				});
		res
			.status(202)
			.json({
				...rows[0],
				message:
					"사전 운영 백업 후 학습 기록을 초기화합니다. 완료 후 다시 로그인해 주세요.",
			});
	},
);
