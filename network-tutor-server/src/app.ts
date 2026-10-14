import { officialExamLockdown } from "./features/exams/services/officialLockdown.js";
import { officialExamRouter } from "./features/exams/officialRoutes.js";
import { learnRouter } from "./features/learn/routes.js";
import "express-async-errors";
import express, { type ErrorRequestHandler } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCorpus } from "./infrastructure/search/corpus.js";
import { periodMetadata, selectAdminPeriod } from "./features/admin/periods.js";
import { requireAdmin } from "./features/auth/middleware.js";
import { attachUser } from "./features/auth/middleware.js";
import { authRouter } from "./features/auth/routes.js";
import { adminChatHistory } from "./features/admin/chatHistory.js";
import { adminRouter } from "./features/admin/routes.js";
import { askRouter } from "./features/tutor/routes/ask.js";
import { problemRouter } from "./features/tutor/routes/problem.js";
import { calcRouter } from "./features/tutor/routes/calc.js";
import { ontologyRouter } from "./features/tutor/routes/ontology.js";
import { lookupRouter } from "./features/tutor/routes/lookup.js";
import { auditRouter } from "./features/audit/routes.js";
import { examRouter } from "./features/exams/routes.js";
import { adminExamRouter } from "./features/exams/adminRoutes.js";
import { bookmarksRouter } from "./features/bookmarks/routes.js";
import { launchRouter } from "./features/settings/launch.js";
import { settingsRouter } from "./features/settings/routes.js";
import { readyHandler } from "./infrastructure/health/ready.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
	const app = express();
	app.use(express.json({ limit: "15mb" })); // 이미지 질문(base64) 수용을 위해 기본 100kb보다 크게
	app.use(attachUser);

	app.get(["/admin", "/admin/", "/admin/index.html"], (_req, res) => {
		res.sendFile(path.join(__dirname, "public", "admin", "index.html"));
	});

	app.use(express.static(path.join(__dirname, "public")));

	app.get("/health", (_req, res) => {
		res.json({ status: "ok", nodesLoaded: getCorpus().length });
	});
	// 실제로 답을 만들 수 있는지(DB·답변 공급자·검색 모드) — routes/ready.ts
	app.get("/ready", readyHandler);

	app.use("/api", officialExamLockdown);
	app.get("/api/admin/periods", requireAdmin, periodMetadata);
	app.use("/api/admin", requireAdmin, selectAdminPeriod);
	app.use("/api", authRouter);
	app.use("/api", adminRouter);
	app.use("/api", adminChatHistory);
	app.use("/api", askRouter);
	app.use("/api", problemRouter);
	app.use("/api", calcRouter);
	app.use("/api", ontologyRouter);
	app.use("/api", lookupRouter);
	app.use("/api", auditRouter);
	app.use("/api", examRouter);
	app.use("/api", officialExamRouter);
	app.use("/api", learnRouter);
	app.use("/api", adminExamRouter);
	app.use("/api", bookmarksRouter);
	app.use("/api", settingsRouter);
	app.use("/api", launchRouter);

	// express-async-errors가 async 핸들러에서 던진/reject된 에러를 여기로 넘겨준다(Express 4는 기본적으로
	// async 에러를 못 잡아서 이 미들웨어 없이는 라우트 하나의 에러가 프로세스 전체를 죽인다 — 실제로 겪은 버그).
	// 학생이 잘못된 id를 보내는 것처럼 흔한 실수 하나가 전체 서비스를 몇 초씩 끊기게 만들면 안 되므로,
	// 여기서 항상 깨끗한 JSON 오류로 응답하고 서버는 절대 죽지 않게 한다.
	const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
		console.error(err);
		if (res.headersSent) return;
		res.status(500).json({ error: "서버 오류가 발생했습니다." });
	};
	app.use(errorHandler);

	return app;
}
