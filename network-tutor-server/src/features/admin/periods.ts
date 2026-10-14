import type { RequestHandler } from "express";
import { config } from "../../config.js";
import { periodContext } from "../../infrastructure/db/pool.js";

/** Runs after active-database authentication; students cannot select another database. */
export const selectAdminPeriod: RequestHandler = (req, res, next) => {
	const period = req.query.period ?? config.activePeriod;
	if (period !== "1" && period !== "2") {
		res.status(400).json({ error: "차수는 1 또는 2여야 합니다." });
		return;
	}
	if (period === "2" && config.activePeriod !== "2") {
		res.status(409).json({ error: "2차 서비스는 아직 시작되지 않았습니다." });
		return;
	}
	if (period === "1" && config.activePeriod === "2") {
		if (!["GET", "HEAD"].includes(req.method)) {
			res
				.status(403)
				.json({
					error: "1차 기록은 보관된 조회 전용 자료로 수정할 수 없습니다.",
				});
			return;
		}
		if (!config.phase1DatabaseUrl) {
			res
				.status(503)
				.json({ error: "1차 보관 자료의 연결 설정을 확인해 주세요." });
			return;
		}
	}
	res.setHeader("X-Service-Period", period);
	res.setHeader("Cache-Control", "private, no-store");
	periodContext.run(period, next);
};

export const periodMetadata: RequestHandler = (_req, res) => {
	res.json({
		activePeriod: config.activePeriod,
		periods: [
			{
				id: "1",
				name: "1차",
				readOnly: config.activePeriod === "2",
				available:
					config.activePeriod === "1" || Boolean(config.phase1DatabaseUrl),
			},
			{
				id: "2",
				name: "2차",
				readOnly: false,
				available: config.activePeriod === "2",
			},
		],
	});
};
