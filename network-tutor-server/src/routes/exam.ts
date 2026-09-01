import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import {
  createAttempt,
  getAttempt,
  submitAnswer,
  submitAttempt,
  getAttemptResults,
  listMyAttempts,
  logProctorEvent,
  autoSubmitIfExpired,
  listPastExamRounds,
  MOCK_EXAM_SUBJECT_DISTRIBUTION,
  MOCK_EXAM_DURATION_MINUTES,
} from "../exam/examService.js";
import { getWrongAnswers, getStudentReport, getOrCreateReportAnalysis } from "../exam/studentReport.js";
import { getWeakAreas, getWeakTopics } from "../pipeline/personalization.js";
import { pool } from "../db/pool.js";

export const examRouter = Router();

// 사이드바 "오늘의 추천 학습" 위젯용 — 가장 취약한 세부 주제(없으면 과목)를 하나 골라준다.
// 매번 새로 계산해도 가벼운 쿼리라 캐싱하지 않는다.
examRouter.get("/exam/recommended-topic", requireAuth, async (req, res) => {
  const weakTopics = await getWeakTopics(req.user!.id);
  if (weakTopics.length > 0) {
    const top = weakTopics[0];
    return res.json({
      hasSuggestion: true,
      level: "topic" as const,
      label: top.topic,
      subject: top.subject,
      accuracy: Math.round(top.accuracy * 100),
    });
  }
  const weakAreas = await getWeakAreas(req.user!.id);
  if (weakAreas.length > 0) {
    const top = weakAreas[0];
    return res.json({
      hasSuggestion: true,
      level: "subject" as const,
      label: top.subject.replace(/^\d과목_/, ""),
      subject: top.subject,
      accuracy: Math.round(top.accuracy * 100),
    });
  }
  res.json({ hasSuggestion: false });
});

const QUESTION_TYPES = new Set(["multiple_choice", "short_answer", "subjective", "essay"]);
const SOURCES = new Set(["ai_generated", "admin_authored", "past_exam"]);

// 학생이 문제은행을 직접 검색/필터해서 훑어보는 화면용 — 정답은 절대 노출하지 않는다(풀어보기를 눌러
// 실제로 응시할 때만 채점 결과로 알 수 있다).
examRouter.get("/exam/bank", requireAuth, async (req, res) => {
  const { subject, questionType, source, q } = req.query;
  const limit = Math.min(Number(req.query.limit ?? 30), 100);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);

  const conditions = ["status = 'approved'"];
  const params: unknown[] = [];
  if (typeof subject === "string" && subject) {
    params.push(subject);
    conditions.push(`subject = $${params.length}`);
  }
  if (typeof questionType === "string" && QUESTION_TYPES.has(questionType)) {
    params.push(questionType);
    conditions.push(`question_type = $${params.length}`);
  }
  if (typeof source === "string" && SOURCES.has(source)) {
    params.push(source);
    conditions.push(`source = $${params.length}`);
  }
  if (typeof q === "string" && q.trim()) {
    params.push(`%${q.trim()}%`);
    conditions.push(`stem ILIKE $${params.length}`);
  }
  const where = conditions.join(" AND ");

  const { rows: countRows } = await pool.query<{ total: string }>(
    `SELECT count(*) AS total FROM exam_questions WHERE ${where}`,
    params,
  );
  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT id, subject, question_type, source, stem, stem_image_url
     FROM exam_questions WHERE ${where} ORDER BY id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  res.json({ total: Number(countRows[0].total), items: rows });
});

examRouter.post("/exam/bank/:id/start", requireAuth, async (req, res) => {
  try {
    const result = await createAttempt({
      userId: req.user!.id,
      kind: "practice_custom",
      questionIds: [Number(req.params.id)],
      title: "문제은행에서 바로 풀기",
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// 플래시카드에서 개념을 보다가 바로 "이 개념 문제 풀어보기"로 넘어갈 수 있게 한다 — 학습 기능들이
// 서로 단절돼 있지 않고 이어지게 해달라는 요구사항 반영.
examRouter.post("/exam/concept/:nodeId/practice-start", requireAuth, async (req, res) => {
  const nodeId = Number(req.params.nodeId);
  const { title } = req.body ?? {};
  const { rows } = await pool.query<{ id: number }>(
    "SELECT id FROM exam_questions WHERE status = 'approved' AND concept_node_id = $1 ORDER BY random() LIMIT 5",
    [nodeId],
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: "이 개념과 연결된 문제를 아직 찾지 못했어요." });
  }
  try {
    const result = await createAttempt({
      userId: req.user!.id,
      kind: "practice_custom",
      questionIds: rows.map((r) => r.id),
      title: typeof title === "string" && title ? `${title} 관련 문제` : "개념 관련 문제",
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

examRouter.get("/exam/meta", requireAuth, async (_req, res) => {
  const { rows } = await pool.query<{ subject: string; count: string }>(
    "SELECT subject, count(*) FROM exam_questions WHERE status = 'approved' GROUP BY subject ORDER BY subject",
  );
  res.json({
    subjects: rows.map((r) => ({ subject: r.subject, count: Number(r.count) })),
    mockExam: { subjectDistribution: MOCK_EXAM_SUBJECT_DISTRIBUTION, durationMinutes: MOCK_EXAM_DURATION_MINUTES },
  });
});

examRouter.post("/exam/practice/start", requireAuth, async (req, res) => {
  const { subject, count } = req.body ?? {};
  try {
    const result = await createAttempt({
      userId: req.user!.id,
      kind: "practice_custom",
      subject: typeof subject === "string" ? subject : null,
      count: typeof count === "number" ? Math.min(Math.max(count, 1), 50) : 10,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

examRouter.post("/exam/mock/start", requireAuth, async (req, res) => {
  try {
    const result = await createAttempt({ userId: req.user!.id, kind: "mock" });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

examRouter.get("/exam/rounds", requireAuth, async (_req, res) => {
  res.json(await listPastExamRounds());
});

examRouter.post("/exam/round/:roundLabel/start", requireAuth, async (req, res) => {
  try {
    const result = await createAttempt({
      userId: req.user!.id,
      kind: "past_exam_round",
      roundLabel: req.params.roundLabel,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// 관리자가 출제해 공개한 지정 시험 목록 — 학생이 이 화면 자체를 볼 방법이 없었다(관리자 페이지에서
// 만들고 공개할 수는 있었지만, 학생 쪽에는 그 목록을 보여주는 화면이 아예 없었음). 응시 가능 기간이
// 지났거나 아직 시작 전인 시험도 목록에는 보이되(언제 열리는지 알아야 하니), 시작 가능 여부를 함께
// 내려줘서 프런트가 버튼을 막을 수 있게 한다.
examRouter.get("/exam/timed", requireAuth, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.title, s.duration_minutes, s.scheduled_start, s.scheduled_end,
            array_length(s.question_ids, 1) AS question_count
     FROM exam_sets s
     WHERE s.kind = 'admin_timed' AND s.is_published = true
     ORDER BY COALESCE(s.scheduled_start, s.created_at) DESC`,
  );
  const now = Date.now();
  res.json(
    rows.map((r) => {
      const startsAt = r.scheduled_start ? new Date(r.scheduled_start).getTime() : null;
      const endsAt = r.scheduled_end ? new Date(r.scheduled_end).getTime() : null;
      const status = startsAt && now < startsAt ? "upcoming" : endsAt && now > endsAt ? "closed" : "open";
      return { ...r, status };
    }),
  );
});

examRouter.post("/exam/timed/:examSetId/start", requireAuth, async (req, res) => {
  try {
    const result = await createAttempt({
      userId: req.user!.id,
      kind: "admin_timed",
      examSetId: Number(req.params.examSetId),
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

examRouter.get("/exam/attempts", requireAuth, async (req, res) => {
  res.json(await listMyAttempts(req.user!.id));
});

examRouter.get("/exam/wrong-answers", requireAuth, async (req, res) => {
  res.json(await getWrongAnswers(req.user!.id));
});

// 오답노트에서 한 문제씩 "다시 풀어보기"는 이미 있지만(문제은행 라우트 재사용), 지금까지 틀린 문제
// 전체를 한 번에 모아 복습하는 응시(진짜 오답 복습 세트)는 없었다 — 같은 문제를 여러 번 틀렸으면
// 한 번만 포함한다.
const RETRY_ALL_LIMIT = 20;

examRouter.post("/exam/wrong-answers/retry-all", requireAuth, async (req, res) => {
  const wrongAnswers = await getWrongAnswers(req.user!.id, 200);
  const allQuestionIds = [...new Set(wrongAnswers.map((w) => w.questionId))];

  // 오답이 RETRY_ALL_LIMIT개보다 많으면 한 번에 다 담을 수 없다. 누를 때마다 같은 것만 계속 나오면
  // 나머지는 영영 "전체 복습" 세트로 못 묶으므로, 바로 직전 "오답 복습" 응시에 포함됐던 문제는 이번엔
  // 제외하고 나머지에서 채운다 — 두 번 누르면 처음 것과 나머지를 번갈아 보게 되어 결국 다 돌게 된다.
  const { rows: prevRows } = await pool.query<{ question_ids: number[] }>(
    `SELECT att.question_ids FROM exam_attempts att JOIN exam_sets s ON s.id = att.exam_set_id
     WHERE att.user_id = $1 AND s.kind = 'practice_custom' AND s.title = '오답 복습'
     ORDER BY att.started_at DESC LIMIT 1`,
    [req.user!.id],
  );
  const previousIds = new Set(prevRows[0]?.question_ids ?? []);
  const remainingIds = allQuestionIds.filter((id) => !previousIds.has(id));
  const candidateIds = remainingIds.length > 0 ? remainingIds : allQuestionIds;
  const questionIds = candidateIds.slice(0, RETRY_ALL_LIMIT);
  if (questionIds.length === 0) {
    return res.status(400).json({ error: "복습할 오답이 없습니다." });
  }
  try {
    const result = await createAttempt({
      userId: req.user!.id,
      kind: "practice_custom",
      questionIds,
      title: "오답 복습",
    });
    // "오답 전체 복습하기" 버튼은 실제로는 한 응시에 최대 RETRY_ALL_LIMIT개까지만 담을 수 있다 —
    // 넘는 만큼 조용히 빠지면 학생이 "전체"라는 말만 믿고 다 봤다고 착각하게 되므로, 총 오답 수 대비
    // 이번에 포함된 수를 함께 내려줘서 프런트가 넘겼을 때 정직하게 안내할 수 있게 한다.
    res.json({ ...result, totalWrongCount: allQuestionIds.length, includedCount: questionIds.length });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

examRouter.get("/exam/my-report", requireAuth, async (req, res) => {
  res.json(await getStudentReport(req.user!.id));
});

examRouter.get("/exam/my-report/analysis", requireAuth, async (req, res) => {
  try {
    res.json(await getOrCreateReportAnalysis(req.user!.id));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

examRouter.post("/exam/my-report/analysis/regenerate", requireAuth, async (req, res) => {
  try {
    res.json(await getOrCreateReportAnalysis(req.user!.id, true));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

examRouter.get("/exam/attempts/:id", requireAuth, async (req, res) => {
  const attemptId = Number(req.params.id);
  await autoSubmitIfExpired(attemptId);
  const attempt = await getAttempt(attemptId);
  if (!attempt || attempt.user_id !== req.user!.id) return res.status(404).json({ error: "응시 기록을 찾을 수 없습니다." });
  if (attempt.status === "in_progress") {
    const deadline = attempt.time_limit_minutes
      ? new Date(attempt.started_at).getTime() + attempt.time_limit_minutes * 60_000
      : null;
    return res.json({ status: attempt.status, deadline, questionCount: attempt.question_ids.length });
  }
  const results = await getAttemptResults(attemptId, req.user!.id);
  res.json(results);
});

examRouter.post("/exam/attempts/:id/answer", requireAuth, async (req, res) => {
  const { questionId, selectedIndex, answerText } = req.body ?? {};
  if (typeof questionId !== "number" || (typeof selectedIndex !== "number" && typeof answerText !== "string")) {
    return res.status(400).json({ error: "questionId와, selectedIndex(객관식) 또는 answerText(단답식/주관식/서술형) 중 하나가 필요합니다." });
  }
  try {
    const result = await submitAnswer({
      attemptId: Number(req.params.id),
      userId: req.user!.id,
      questionId,
      selectedDisplayIndex: typeof selectedIndex === "number" ? selectedIndex : undefined,
      answerText: typeof answerText === "string" ? answerText : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

examRouter.post("/exam/attempts/:id/submit", requireAuth, async (req, res) => {
  try {
    const result = await submitAttempt(Number(req.params.id), req.user!.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

examRouter.post("/exam/attempts/:id/proctor-event", requireAuth, async (req, res) => {
  const { eventType, detail } = req.body ?? {};
  if (typeof eventType !== "string") return res.status(400).json({ error: "eventType(string)이 필요합니다." });
  try {
    const result = await logProctorEvent(Number(req.params.id), req.user!.id, eventType, detail);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

examRouter.get("/exam/questions/:id/explain", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, subject, stem, choices, correct_index, explanation, stem_image_url FROM exam_questions WHERE id = $1 AND status = 'approved'",
    [Number(req.params.id)],
  );
  if (rows.length === 0) return res.status(404).json({ error: "문제를 찾을 수 없습니다." });
  res.json(rows[0]);
});
