import "express-async-errors";
import express, { type ErrorRequestHandler } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { loadCorpus, getCorpus } from "./search/corpus.js";
import { bm25Index } from "./search/textIndex.js";
import { attachUser } from "./auth/middleware.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { askRouter } from "./routes/ask.js";
import { problemRouter } from "./routes/problem.js";
import { calcRouter } from "./routes/calc.js";
import { ontologyRouter } from "./routes/ontology.js";
import { lookupRouter } from "./routes/lookup.js";
import { auditRouter } from "./routes/audit.js";
import { examRouter } from "./routes/exam.js";
import { adminExamRouter } from "./routes/adminExam.js";
import { bookmarksRouter } from "./routes/bookmarks.js";
import { settingsRouter } from "./routes/settings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  await loadCorpus();
  bm25Index.build(getCorpus());

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

  app.use("/api", authRouter);
  app.use("/api", adminRouter);
  app.use("/api", askRouter);
  app.use("/api", problemRouter);
  app.use("/api", calcRouter);
  app.use("/api", ontologyRouter);
  app.use("/api", lookupRouter);
  app.use("/api", auditRouter);
  app.use("/api", examRouter);
  app.use("/api", adminExamRouter);
  app.use("/api", bookmarksRouter);
  app.use("/api", settingsRouter);

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

  app.listen(config.port, () => {
    console.log(`network-tutor-server listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Express 라우트 바깥(타이머, 콜백 등)에서 발생하는 에러까지 잡는 마지막 안전판 — 로그만 남기고
// 서버는 계속 살려둔다(요청 하나 처리 중 발생한 것도 아닌데 전체 서비스를 내릴 이유가 없다).
process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});
