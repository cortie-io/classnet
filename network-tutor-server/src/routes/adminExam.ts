import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAdmin } from "../auth/middleware.js";

export const adminExamRouter = Router();

// ---------- 문제 검수 큐 ----------
adminExamRouter.get("/admin/exam/questions", requireAdmin, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "pending_review";
  const source = typeof req.query.source === "string" ? req.query.source : null;
  const subject = typeof req.query.subject === "string" && req.query.subject ? req.query.subject : null;
  const q = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim() : null;
  const params: unknown[] = [status];
  let where = "status = $1";
  if (source) {
    params.push(source);
    where += ` AND source = $${params.length}`;
  }
  if (subject) {
    params.push(subject);
    where += ` AND subject = $${params.length}`;
  }
  if (q) {
    // 대량으로 일괄 적재된 기출문제는 created_at이 전부 동일해서(수입 배치 시각) "최근 200개"가
    // 사실상 임의의 200개나 다름없다 — "새 시험 만들기"에서 4,600여 개를 그냥 스크롤하며 찾아야 했던
    // 문제(실사용 피드백)를 검색어/과목 필터로 해결한다.
    params.push(`%${q}%`);
    where += ` AND stem ILIKE $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT id, source, subject, stem, question_type, choices, correct_index, accepted_answers, model_answer, max_score,
            explanation, status, created_at, stem_image_url
     FROM exam_questions WHERE ${where} ORDER BY created_at DESC LIMIT 200`,
    params,
  );
  res.json(rows);
});

adminExamRouter.get("/admin/exam/questions/:id", requireAdmin, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM exam_questions WHERE id = $1", [Number(req.params.id)]);
  if (rows.length === 0) return res.status(404).json({ error: "문제를 찾을 수 없습니다." });
  res.json(rows[0]);
});

const QUESTION_TYPES = new Set(["multiple_choice", "short_answer", "subjective", "essay"]);

/** 문제 유형별로 필요한 필드가 다 있는지 검증하고, DB에 넣을 형태로 정리한다. */
function validateQuestionFields(body: Record<string, unknown>): { error: string } | {
  questionType: string;
  choices: string[] | null;
  correctIndex: number | null;
  acceptedAnswers: string[] | null;
  modelAnswer: string | null;
} {
  const questionType = typeof body.questionType === "string" ? body.questionType : "multiple_choice";
  if (!QUESTION_TYPES.has(questionType)) return { error: "questionType은 multiple_choice/short_answer/subjective/essay 중 하나여야 합니다." };

  if (questionType === "multiple_choice") {
    const { choices, correctIndex } = body;
    if (!Array.isArray(choices) || choices.length < 2 || !choices.every((c) => typeof c === "string" && c.trim())) {
      return { error: "객관식은 choices(2개 이상의 문자열 배열)가 필요합니다." };
    }
    if (typeof correctIndex !== "number" || correctIndex < 0 || correctIndex >= choices.length) {
      return { error: "객관식은 correctIndex(0 ~ choices.length-1)가 필요합니다." };
    }
    return { questionType, choices, correctIndex, acceptedAnswers: null, modelAnswer: null };
  }

  if (questionType === "short_answer") {
    const { acceptedAnswers } = body;
    if (!Array.isArray(acceptedAnswers) || acceptedAnswers.length === 0 || !acceptedAnswers.every((a) => typeof a === "string" && a.trim())) {
      return { error: "단답식은 acceptedAnswers(정답으로 인정할 문자열 배열, 1개 이상)가 필요합니다." };
    }
    return { questionType, choices: null, correctIndex: null, acceptedAnswers, modelAnswer: typeof body.modelAnswer === "string" ? body.modelAnswer : null };
  }

  // subjective / essay: 정답이 하나로 정해지지 않으므로 modelAnswer(모범답안, 참고용)만 선택적으로 받는다.
  return {
    questionType,
    choices: null,
    correctIndex: null,
    acceptedAnswers: null,
    modelAnswer: typeof body.modelAnswer === "string" ? body.modelAnswer : null,
  };
}

adminExamRouter.post("/admin/exam/questions", requireAdmin, async (req, res) => {
  const body = req.body ?? {};
  const { subject, stem, explanation, conceptNodeId, maxScore } = body;
  if (typeof subject !== "string" || typeof stem !== "string" || !stem.trim()) {
    return res.status(400).json({ error: "subject, stem이 필요합니다." });
  }
  const validated = validateQuestionFields(body);
  if ("error" in validated) return res.status(400).json({ error: validated.error });

  const { rows } = await pool.query(
    `INSERT INTO exam_questions
      (source, subject, concept_node_id, stem, question_type, choices, correct_index, accepted_answers, model_answer, max_score, explanation, status, created_by)
     VALUES ('admin_authored', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'approved', $11) RETURNING id`,
    [
      subject,
      conceptNodeId ?? null,
      stem,
      validated.questionType,
      validated.choices ? JSON.stringify(validated.choices) : null,
      validated.correctIndex,
      validated.acceptedAnswers ? JSON.stringify(validated.acceptedAnswers) : null,
      validated.modelAnswer,
      typeof maxScore === "number" && maxScore > 0 ? maxScore : 1,
      explanation ?? null,
      req.user!.id,
    ],
  );
  res.status(201).json({ id: rows[0].id });
});

adminExamRouter.patch("/admin/exam/questions/:id", requireAdmin, async (req, res) => {
  const { stem, choices, correctIndex, acceptedAnswers, modelAnswer, explanation, subject, maxScore } = req.body ?? {};
  const fields: string[] = [];
  const params: unknown[] = [];
  if (typeof stem === "string") { params.push(stem); fields.push(`stem = $${params.length}`); }
  if (Array.isArray(choices)) { params.push(JSON.stringify(choices)); fields.push(`choices = $${params.length}`); }
  if (typeof correctIndex === "number") { params.push(correctIndex); fields.push(`correct_index = $${params.length}`); }
  if (Array.isArray(acceptedAnswers)) { params.push(JSON.stringify(acceptedAnswers)); fields.push(`accepted_answers = $${params.length}`); }
  if (typeof modelAnswer === "string") { params.push(modelAnswer); fields.push(`model_answer = $${params.length}`); }
  if (typeof explanation === "string") { params.push(explanation); fields.push(`explanation = $${params.length}`); }
  if (typeof subject === "string") { params.push(subject); fields.push(`subject = $${params.length}`); }
  if (typeof maxScore === "number" && maxScore > 0) { params.push(maxScore); fields.push(`max_score = $${params.length}`); }
  if (fields.length === 0) return res.status(400).json({ error: "수정할 필드가 없습니다." });
  params.push(Number(req.params.id));
  const { rows: updated } = await pool.query(
    `UPDATE exam_questions SET ${fields.join(", ")} WHERE id = $${params.length} RETURNING id`,
    params,
  );
  if (updated.length === 0) return res.status(404).json({ error: "문제를 찾을 수 없습니다." });
  res.json({ ok: true });
});

adminExamRouter.delete("/admin/exam/questions/:id", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query("DELETE FROM exam_questions WHERE id = $1 RETURNING id", [Number(req.params.id)]);
    if (rows.length === 0) return res.status(404).json({ error: "문제를 찾을 수 없습니다." });
    res.json({ ok: true });
  } catch (err: any) {
    // 이 문제를 이미 한 번이라도 푼 학생이 있으면(exam_answers에 기록이 남아있으면) 응시 기록의
    // 무결성을 지키기 위해 삭제가 거부된다 — 대신 반려 처리(status='rejected')로 노출만 막는 걸 권한다.
    if (err.code === "23503") {
      return res.status(409).json({ error: "이미 학생이 풀어본 기록이 있는 문제라 삭제할 수 없습니다. 대신 반려 처리하면 더 이상 출제되지 않습니다." });
    }
    throw err;
  }
});

adminExamRouter.post("/admin/exam/questions/:id/approve", requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    "UPDATE exam_questions SET status = 'approved', reviewed_by = $1, reviewed_at = now() WHERE id = $2 RETURNING id",
    [req.user!.id, Number(req.params.id)],
  );
  if (rows.length === 0) return res.status(404).json({ error: "문제를 찾을 수 없습니다." });
  res.json({ ok: true });
});

adminExamRouter.post("/admin/exam/questions/:id/reject", requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    "UPDATE exam_questions SET status = 'rejected', reviewed_by = $1, reviewed_at = now() WHERE id = $2 RETURNING id",
    [req.user!.id, Number(req.params.id)],
  );
  if (rows.length === 0) return res.status(404).json({ error: "문제를 찾을 수 없습니다." });
  res.json({ ok: true });
});

adminExamRouter.get("/admin/exam/stats", requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT status, count(*)::int AS count FROM exam_questions GROUP BY status",
  );
  res.json({ byStatus: rows });
});

// 문제별 정답률 — 유독 정답률이 낮은 문제는 학생들이 정말 취약해서일 수도 있지만, 지문이 모호하거나
// 정답이 잘못 태깅된 출제 오류일 수도 있다. 표본이 너무 적으면(우연) 판단 근거가 안 되므로 5회 이상
// 응답된 문제만 대상으로 하고, 정답률 낮은 순으로 보여줘서 교사가 직접 검토할 수 있게 한다.
adminExamRouter.get("/admin/exam/question-quality", requireAdmin, async (req, res) => {
  const minAttempts = Math.max(Number(req.query.minAttempts ?? 5), 1);
  const { rows } = await pool.query(
    `SELECT q.id, q.subject, q.stem, q.question_type, q.source,
            count(*)::int AS attempt_count,
            count(*) FILTER (WHERE a.is_correct = true)::int AS correct_count,
            round((count(*) FILTER (WHERE a.is_correct = true))::numeric / count(*) * 100, 1) AS accuracy_pct
     FROM exam_answers a
     JOIN exam_questions q ON q.id = a.question_id
     WHERE a.is_correct IS NOT NULL AND q.status = 'approved'
     GROUP BY q.id
     HAVING count(*) >= $1
     ORDER BY accuracy_pct ASC
     LIMIT 50`,
    [minAttempts],
  );
  res.json(rows);
});

// ---------- 관리자 출제 시험(고정 문항 + 시간제한) ----------
adminExamRouter.post("/admin/exam/sets", requireAdmin, async (req, res) => {
  const { title, questionIds, durationMinutes, scheduledStart, scheduledEnd } = req.body ?? {};
  if (typeof title !== "string" || !Array.isArray(questionIds) || questionIds.length === 0) {
    return res.status(400).json({ error: "title, questionIds(배열)가 필요합니다." });
  }
  const { rows: approvedRows } = await pool.query<{ id: number }>(
    "SELECT id FROM exam_questions WHERE id = ANY($1::int[]) AND status = 'approved'",
    [questionIds],
  );
  if (approvedRows.length !== questionIds.length) {
    return res.status(400).json({ error: "승인되지 않은 문제가 포함되어 있습니다. 검수 큐에서 먼저 승인하세요." });
  }
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO exam_sets (kind, title, created_by, duration_minutes, question_ids, scheduled_start, scheduled_end, is_published)
     VALUES ('admin_timed', $1, $2, $3, $4, $5, $6, false) RETURNING id`,
    [title, req.user!.id, durationMinutes ?? null, questionIds, scheduledStart ?? null, scheduledEnd ?? null],
  );
  res.status(201).json({ id: rows[0].id });
});

adminExamRouter.get("/admin/exam/sets", requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.title, s.duration_minutes, s.scheduled_start, s.scheduled_end, s.is_published,
            array_length(s.question_ids, 1) AS question_count,
            count(a.id)::int AS attempt_count
     FROM exam_sets s LEFT JOIN exam_attempts a ON a.exam_set_id = s.id
     WHERE s.kind = 'admin_timed'
     GROUP BY s.id ORDER BY s.created_at DESC`,
  );
  res.json(rows);
});

adminExamRouter.post("/admin/exam/sets/:id/publish", requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    "UPDATE exam_sets SET is_published = true WHERE id = $1 AND kind = 'admin_timed' RETURNING id",
    [Number(req.params.id)],
  );
  if (rows.length === 0) return res.status(404).json({ error: "시험을 찾을 수 없습니다." });
  res.json({ ok: true });
});

adminExamRouter.post("/admin/exam/sets/:id/unpublish", requireAdmin, async (req, res) => {
  await pool.query("UPDATE exam_sets SET is_published = false WHERE id = $1", [Number(req.params.id)]);
  res.json({ ok: true });
});

// 응시 가능 시작/마감 일시를 나중에 조정할 수 있게 한다(생성할 때만 정할 수 있으면 한번 발행한 뒤
// 기간을 늘리거나 당길 때마다 시험을 새로 만들어야 해서 불편하다). null을 보내면 해당 제한을 해제한다.
adminExamRouter.patch("/admin/exam/sets/:id", requireAdmin, async (req, res) => {
  const { title, durationMinutes, scheduledStart, scheduledEnd } = req.body ?? {};
  if (
    scheduledStart != null &&
    scheduledEnd != null &&
    new Date(scheduledStart).getTime() >= new Date(scheduledEnd).getTime()
  ) {
    return res.status(400).json({ error: "응시 시작 시각은 마감 시각보다 이전이어야 합니다." });
  }
  const { rows } = await pool.query<{ id: number }>(
    `UPDATE exam_sets SET
       title = COALESCE($2, title),
       duration_minutes = COALESCE($3, duration_minutes),
       scheduled_start = $4,
       scheduled_end = $5
     WHERE id = $1 AND kind = 'admin_timed' RETURNING id`,
    [
      Number(req.params.id),
      typeof title === "string" && title.trim() ? title : null,
      typeof durationMinutes === "number" ? durationMinutes : null,
      scheduledStart ?? null,
      scheduledEnd ?? null,
    ],
  );
  if (rows.length === 0) return res.status(404).json({ error: "시험을 찾을 수 없습니다." });
  res.json({ ok: true });
});

// ---------- 채점 대기 큐(주관식/서술형은 자동채점이 안 돼 교사가 직접 채점해야 한다) ----------
adminExamRouter.get("/admin/exam/grading-queue", requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT a.id AS answer_id, a.attempt_id, a.question_id, a.answer_text, a.answered_at,
            q.subject, q.stem, q.question_type, q.model_answer, q.max_score, q.explanation,
            u.id AS user_id, u.name AS user_name, u.email AS user_email
     FROM exam_answers a
     JOIN exam_questions q ON q.id = a.question_id
     JOIN exam_attempts att ON att.id = a.attempt_id
     JOIN users u ON u.id = att.user_id
     WHERE q.question_type IN ('subjective','essay') AND a.answer_text IS NOT NULL AND a.score IS NULL
       AND att.status IN ('submitted','auto_submitted')
     ORDER BY a.answered_at ASC LIMIT 200`,
  );
  res.json(rows);
});

adminExamRouter.post("/admin/exam/answers/:id/grade", requireAdmin, async (req, res) => {
  const { score, feedback } = req.body ?? {};
  if (typeof score !== "number" || score < 0) return res.status(400).json({ error: "score(0 이상 숫자)가 필요합니다." });
  const { rows } = await pool.query<{ max_score: string }>(
    `SELECT q.max_score FROM exam_answers a JOIN exam_questions q ON q.id = a.question_id WHERE a.id = $1`,
    [Number(req.params.id)],
  );
  if (rows.length === 0) return res.status(404).json({ error: "답안을 찾을 수 없습니다." });
  const maxScore = Number(rows[0].max_score);
  if (score > maxScore) return res.status(400).json({ error: `score는 이 문제의 배점(${maxScore})을 넘을 수 없습니다.` });

  const { rows: updated } = await pool.query(
    `UPDATE exam_answers SET score = $1, is_correct = $2, graded_by = $3, graded_at = now(), grader_feedback = $4
     WHERE id = $5 RETURNING attempt_id`,
    [score, score >= maxScore * 0.6, req.user!.id, feedback ?? null, Number(req.params.id)],
  );
  if (updated.length === 0) return res.status(404).json({ error: "답안을 찾을 수 없습니다." });

  // 채점이 끝나 최종 점수가 바뀌었을 수 있으니 해당 응시의 score를 다시 계산해 반영한다.
  const { rows: attemptRows } = await pool.query<{ question_ids: number[] }>(
    "SELECT question_ids FROM exam_attempts WHERE id = $1",
    [updated[0].attempt_id],
  );
  if (attemptRows.length > 0) {
    const { rows: scoreRows } = await pool.query<{ score_sum: string | null; max_sum: string | null }>(
      `SELECT sum(a.score) AS score_sum, sum(q.max_score) AS max_sum
       FROM exam_answers a JOIN exam_questions q ON q.id = a.question_id
       WHERE a.attempt_id = $1`,
      [updated[0].attempt_id],
    );
    const scoreSum = Number(scoreRows[0]?.score_sum ?? 0);
    const maxSum = Number(scoreRows[0]?.max_sum ?? 0);
    const finalScore = maxSum > 0 ? Math.round((scoreSum / maxSum) * 1000) / 10 : 0;
    await pool.query("UPDATE exam_attempts SET score = $1 WHERE id = $2", [finalScore, updated[0].attempt_id]);
  }

  res.json({ ok: true });
});

// 성적 기록용 CSV 내보내기. 값에 쉼표/줄바꿈/따옴표가 섞여도 깨지지 않게 표준 CSV 이스케이프(큰따옴표로
// 감싸고 내부 큰따옴표는 두 번 반복)를 적용하고, 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM을 앞에 붙인다.
function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

adminExamRouter.get("/admin/exam/attempts-export", requireAdmin, async (req, res) => {
  const examSetId = req.query.examSetId ? Number(req.query.examSetId) : null;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (examSetId) { params.push(examSetId); conditions.push(`a.exam_set_id = $${params.length}`); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT u.student_id, u.name AS user_name, u.email AS user_email,
            s.title AS set_title, s.kind AS set_kind, a.status, a.score,
            a.started_at, a.submitted_at, a.flagged_for_review
     FROM exam_attempts a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN exam_sets s ON s.id = a.exam_set_id
     ${where}
     ORDER BY a.started_at DESC`,
    params,
  );
  const header = ["학번", "이름", "이메일", "시험명", "종류", "상태", "점수", "시작시각", "제출시각", "검토대상"];
  const kindLabel: Record<string, string> = {
    mock: "모의고사",
    admin_timed: "지정 시험",
    practice_custom: "연습",
    past_exam_round: "기출 회차",
  };
  const lines = rows.map((r) =>
    [
      r.student_id,
      r.user_name,
      r.user_email,
      r.set_title ?? "연습",
      kindLabel[r.set_kind] ?? r.set_kind ?? "-",
      r.status,
      r.score ?? "",
      r.started_at ? new Date(r.started_at).toLocaleString("ko-KR") : "",
      r.submitted_at ? new Date(r.submitted_at).toLocaleString("ko-KR") : "",
      r.flagged_for_review ? "Y" : "",
    ]
      .map(csvEscape)
      .join(","),
  );
  const csv = `﻿${[header.join(","), ...lines].join("\n")}`;
  res.json({ csv });
});

// ---------- 응시 모니터링 / 부정행위 검토 ----------
adminExamRouter.get("/admin/exam/attempts", requireAdmin, async (req, res) => {
  const examSetId = req.query.examSetId ? Number(req.query.examSetId) : null;
  const flaggedOnly = req.query.flagged === "true";
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (examSetId) { params.push(examSetId); conditions.push(`a.exam_set_id = $${params.length}`); }
  if (flaggedOnly) conditions.push("a.flagged_for_review = true");
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT a.id, a.user_id, u.name AS user_name, u.email AS user_email, a.status, a.score,
            a.started_at, a.submitted_at, a.flagged_for_review, s.title AS set_title, s.kind AS set_kind
     FROM exam_attempts a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN exam_sets s ON s.id = a.exam_set_id
     ${where}
     ORDER BY a.started_at DESC LIMIT 200`,
    params,
  );
  res.json(rows);
});

adminExamRouter.get("/admin/exam/attempts/:id/proctor-events", requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT event_type, detail, created_at FROM exam_proctor_events WHERE attempt_id = $1 ORDER BY created_at",
    [Number(req.params.id)],
  );
  res.json(rows);
});

adminExamRouter.post("/admin/exam/attempts/:id/invalidate", requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    "UPDATE exam_attempts SET status = 'invalidated' WHERE id = $1 RETURNING id",
    [Number(req.params.id)],
  );
  if (rows.length === 0) return res.status(404).json({ error: "응시 기록을 찾을 수 없습니다." });
  res.json({ ok: true });
});
