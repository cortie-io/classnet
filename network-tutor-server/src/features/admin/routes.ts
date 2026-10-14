import { updateStudentProfile } from "./studentProfile.js";
import { isArchivePeriod } from "../../infrastructure/db/pool.js";
import { getFairRanking } from "./fairRanking.js";
import { replacePassword } from "../auth/passwordReset.js";
import { Router } from "express";
import { pool } from "../../infrastructure/db/pool.js";
import { requireAdmin } from "../auth/middleware.js";
import { hashPassword } from "../auth/password.js";
import { parseStudentCsv } from "./csv.js";
import { getWeakAreas, getWeakTopics } from "../tutor/pipeline/personalization.js";

export const adminRouter = Router();

// ---------- 학교 전체(전 학생) 현황 대시보드 ----------
// 교사가 가장 먼저 필요로 하는 것은 "우리 반이 전반적으로 어떤지"다 — 학생 한 명씩 들여다보기 전에
// 과목별로 반 전체가 어디서 자주 틀리는지, 어떤 문제가 유독 정답률이 낮은지(출제 오류 가능성 포함)를
// 한눈에 보여준다.
adminRouter.get("/admin/analytics/overview", requireAdmin, async (_req, res) => {
  const [studentCount, overallAccuracy, bySubject, mostMissed, activity, mostActive] = await Promise.all([
    pool.query<{ count: string }>("SELECT count(*) FROM users WHERE role = 'student'"),
    pool.query<{ correct: string; total: string }>(
      "SELECT count(*) FILTER (WHERE is_correct = true) AS correct, count(*) AS total FROM exam_answers WHERE is_correct IS NOT NULL",
    ),
    pool.query<{ subject: string; correct: string; total: string }>(
      `SELECT q.subject, count(*) FILTER (WHERE a.is_correct = true) AS correct, count(*) AS total
       FROM exam_answers a JOIN exam_questions q ON q.id = a.question_id
       WHERE a.is_correct IS NOT NULL GROUP BY q.subject ORDER BY q.subject`,
    ),
    pool.query<{ id: number; stem: string; subject: string; correct: string; total: string }>(
      `SELECT q.id, q.stem, q.subject,
              count(*) FILTER (WHERE a.is_correct = true) AS correct, count(*) AS total
       FROM exam_answers a JOIN exam_questions q ON q.id = a.question_id
       WHERE a.is_correct IS NOT NULL
       GROUP BY q.id, q.stem, q.subject
       HAVING count(*) >= 5
       ORDER BY (count(*) FILTER (WHERE a.is_correct = true))::float / count(*) ASC
       LIMIT 10`,
    ),
    pool.query<{ day: string; count: string }>(
      `SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day, count(*)
       FROM exam_attempts WHERE started_at > now() - interval '14 days'
       GROUP BY 1 ORDER BY 1`,
    ),
    pool.query<{ id: number; name: string; email: string; attempt_count: string }>(
      `SELECT u.id, u.name, u.email, count(att.id) AS attempt_count
       FROM users u JOIN exam_attempts att ON att.user_id = u.id
       WHERE att.started_at > now() - interval '14 days'
       GROUP BY u.id ORDER BY attempt_count DESC LIMIT 5`,
    ),
  ]);

  res.json({
    studentCount: Number(studentCount.rows[0].count),
    overallAccuracy: overallAccuracy.rows[0],
    bySubject: bySubject.rows,
    mostMissed: mostMissed.rows,
    recentActivity: activity.rows,
    mostActiveStudents: mostActive.rows,
  });
});

// Phase1 ranking is a frozen snapshot; phase2 uses actual assessment results only.
adminRouter.get("/admin/analytics/ranking", requireAdmin, async (_req, res) => {
  if (isArchivePeriod()) {
    const snapshot = await pool.query("SELECT payload FROM phase_archive_snapshot WHERE key='ranking'");
    if (!snapshot.rows[0]) return res.status(503).json({ error: "1차 순위 보관 자료가 없습니다." });
    return res.json(snapshot.rows[0].payload);
  }
  return res.json(await getFairRanking());
});

adminRouter.post("/admin/users", requireAdmin, async (req, res) => {
  const { role, studentId, name, birthdate, department, email, password } = req.body ?? {};
  if (typeof name !== "string" || typeof email !== "string" || typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "name, email, password(8자 이상)가 필요합니다." });
  }
  const finalRole = role === "admin" ? "admin" : "student";
  // 학생은 학번으로 로그인한다(web auth.ts) — 학번 없이 만들면 영영 로그인할 수 없는 계정이 된다.
  if (finalRole === "student" && (typeof studentId !== "string" || !studentId.trim())) {
    return res.status(400).json({ error: "학생 계정에는 학번이 필요합니다(학번으로 로그인합니다)." });
  }
  try {
    const passwordHash = await hashPassword(password);
    const { rows } = await pool.query(
      `INSERT INTO users (role, student_id, name, birthdate, department, email, password_hash, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, role, student_id, name, department, email, created_at`,
      [finalRole, (typeof studentId === "string" && studentId.trim()) || null, name, birthdate || null, department || null, email.trim().toLowerCase(), passwordHash, req.user!.id],
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    if (err.code === "23505") return res.status(409).json({ error: "이미 존재하는 학번 또는 이메일입니다." });
    throw err;
  }
});

adminRouter.post("/admin/users/bulk-csv", requireAdmin, async (req, res) => {
  const { csvText } = req.body ?? {};
  if (typeof csvText !== "string" || csvText.trim().length === 0) {
    return res.status(400).json({ error: "csvText가 필요합니다. (컬럼: 학번,이름,생년월일,메일,비밀번호)" });
  }
  const { rows, errors } = parseStudentCsv(csvText);
  const created: { rowNumber: number; email: string }[] = [];
  const failed: { rowNumber: number; message: string }[] = [...errors];

  for (const row of rows) {
    try {
      const passwordHash = await hashPassword(row.password);
      await pool.query(
        `INSERT INTO users (role, student_id, name, birthdate, department, email, password_hash, created_by)
         VALUES ('student', $1, $2, $3, $4, $5, $6, $7)`,
        [row.studentId, row.name, row.birthdate || null, row.department || null, row.email, passwordHash, req.user!.id],
      );
      created.push({ rowNumber: row.rowNumber, email: row.email });
    } catch (err: any) {
      failed.push({
        rowNumber: row.rowNumber,
        message: err.code === "23505" ? `이미 존재하는 학번 또는 이메일: ${row.email}` : String(err.message ?? err),
      });
    }
  }
  res.json({ createdCount: created.length, failedCount: failed.length, created, failed });
});

adminRouter.get("/admin/users", requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.role, u.student_id, u.name, u.email, u.level, u.created_at,
            count(a.id)::int AS question_count,
            count(a.id) FILTER (WHERE a.verification_status = 'verified')::int AS verified_count,
            count(a.id) FILTER (WHERE a.verification_status = 'flagged')::int AS flagged_count,
            max(a.created_at) AS last_active_at
     FROM users u
     LEFT JOIN audit_log a ON a.user_id = u.id
     GROUP BY u.id
     ORDER BY u.created_at DESC`,
  );
  res.json(rows);
});

adminRouter.patch("/admin/users/:id",requireAdmin,updateStudentProfile);

adminRouter.get("/admin/users/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query(
    "SELECT id, role, student_id, name, birthdate, department, email, level, created_at FROM users WHERE id = $1",
    [id],
  );
  if (rows.length === 0) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });

  const [{ rows: categoryStats }, weakAreas, weakTopics, { rows: examStats }, { rows: attempts }] = await Promise.all([
    pool.query(
      `SELECT n.subject, count(*)::int AS count
       FROM audit_log a, unnest(a.retrieved_node_ids) AS nid
       JOIN concept_nodes n ON n.id = nid
       WHERE a.user_id = $1
       GROUP BY n.subject ORDER BY count DESC`,
      [id],
    ),
    getWeakAreas(id),
    getWeakTopics(id),
    pool.query<{ correct: string; total: string }>(
      "SELECT count(*) FILTER (WHERE is_correct = true) AS correct, count(*) AS total FROM exam_answers a JOIN exam_attempts att ON att.id = a.attempt_id WHERE att.user_id = $1 AND a.is_correct IS NOT NULL",
      [id],
    ),
    pool.query(
      `SELECT att.id, att.status, att.score, att.started_at, att.submitted_at, att.flagged_for_review,
              s.kind AS set_kind, s.title AS set_title
       FROM exam_attempts att LEFT JOIN exam_sets s ON s.id = att.exam_set_id
       WHERE att.user_id = $1 ORDER BY att.started_at DESC LIMIT 20`,
      [id],
    ),
  ]);

  // 사전/사후테스트(제목이 정확히 "사전테스트"/"사후테스트"인 지정 시험) 점수와 향상률 — 학습 순위
  // 상단 요약과 동일한 방식으로 계산한 참고용 정보. 위 attempts 목록에도 이미 나오지만, 한눈에
  // 바로 보이도록 별도로 뽑아준다. 둘 다 사이트 밖에서 치르는 경우가 많아 관리자가 직접 입력한
  // manual_pre_test_score/manual_post_test_score를 우선하고, 없을 때만 사이트에서 치른 기록을 쓴다.
  const { rows: prePostRows } = await pool.query<{
    pre_test_score: string | null;
    post_test_score: string | null;
    manual_pre_test_score: string | null;
    manual_post_test_score: string | null;
  }>(
    `SELECT
       (SELECT att.score FROM exam_attempts att JOIN exam_sets s ON s.id = att.exam_set_id
        WHERE att.user_id = $1 AND s.kind = 'admin_timed' AND s.title = '사전테스트'
          AND att.status IN ('submitted', 'auto_submitted')
        ORDER BY att.submitted_at DESC LIMIT 1) AS pre_test_score,
       (SELECT att.score FROM exam_attempts att JOIN exam_sets s ON s.id = att.exam_set_id
        WHERE att.user_id = $1 AND s.kind = 'admin_timed' AND s.title = '사후테스트'
          AND att.status IN ('submitted', 'auto_submitted')
        ORDER BY att.submitted_at DESC LIMIT 1) AS post_test_score,
       (SELECT manual_pre_test_score FROM users WHERE id = $1) AS manual_pre_test_score,
       (SELECT manual_post_test_score FROM users WHERE id = $1) AS manual_post_test_score`,
    [id],
  );
  const autoPreTestScore = prePostRows[0]?.pre_test_score != null ? Number(prePostRows[0].pre_test_score) : null;
  const autoPostTestScore = prePostRows[0]?.post_test_score != null ? Number(prePostRows[0].post_test_score) : null;
  const manualPreTestScore = prePostRows[0]?.manual_pre_test_score != null ? Number(prePostRows[0].manual_pre_test_score) : null;
  const manualPostTestScore = prePostRows[0]?.manual_post_test_score != null ? Number(prePostRows[0].manual_post_test_score) : null;
  const preTestScore = manualPreTestScore ?? autoPreTestScore;
  const postTestScore = manualPostTestScore ?? autoPostTestScore;
  const prePostTest = {
    preTestScore,
    postTestScore,
    manualPreTestScore,
    manualPostTestScore,
    improvement: preTestScore != null && postTestScore != null ? Math.round((postTestScore - preTestScore) * 10) / 10 : null,
  };

  res.json({
    user: rows[0],
    categoryStats,
    weakAreas,
    weakTopics,
    examStats: examStats[0],
    attempts,
    prePostTest,
  });
});

adminRouter.get("/admin/users/:id/history", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const requestedLimit = Number(req.query.limit ?? 100);
  const beforeId = req.query.beforeId == null ? null : Number(req.query.beforeId);
  if (!Number.isSafeInteger(id) || id <= 0 ||
      !Number.isSafeInteger(requestedLimit) || requestedLimit <= 0 ||
      (beforeId !== null && (!Number.isSafeInteger(beforeId) || beforeId <= 0))) {
    res.status(400).json({ error: "Invalid history pagination" });
    return;
  }
  const limit = Math.min(requestedLimit, 500);
  const paginated = req.query.paginated === "true";
  const { rows } = await pool.query(
    `SELECT id, question, intent, verification_status, confidence, final_answer, created_at
     FROM audit_log WHERE user_id = $1
       AND ($3::int IS NULL OR (created_at, id) <
         (SELECT created_at, id FROM audit_log WHERE id = $3 AND user_id = $1))
     ORDER BY created_at DESC, id DESC LIMIT $2`,
    [id, paginated ? limit + 1 : limit, beforeId],
  );
  if (!paginated) {
    res.json(rows);
    return;
  }
  const count = await pool.query<{ total: number }>(
    "SELECT count(*)::int AS total FROM audit_log WHERE user_id = $1", [id],
  );
  const items = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  res.json({
    items, total: count.rows[0].total, hasMore,
    nextCursor: hasMore ? items[items.length - 1].id : null,
  });
});

// 사전/사후테스트를 사이트 밖에서 치른 경우 관리자가 점수를 직접 입력/수정/삭제(null)할 수 있게 한다.
adminRouter.patch("/admin/users/:id/pre-test-score", requireAdmin, async (req, res) => {
  const { score } = req.body ?? {};
  let normalized: number | null;
  if (score === null || score === undefined || score === "") {
    normalized = null;
  } else {
    normalized = Number(score);
    if (!Number.isFinite(normalized) || normalized < 0 || normalized > 100) {
      return res.status(400).json({ error: "score는 0~100 사이 숫자이거나 null이어야 합니다." });
    }
  }
  const { rows } = await pool.query(
    "UPDATE users SET manual_pre_test_score = $1 WHERE id = $2 AND role = 'student' RETURNING id, manual_pre_test_score",
    [normalized, Number(req.params.id)],
  );
  if (rows.length === 0) return res.status(404).json({ error: "학생을 찾을 수 없습니다." });
  res.json({ ok: true, manualPreTestScore: rows[0].manual_pre_test_score != null ? Number(rows[0].manual_pre_test_score) : null });
});

adminRouter.patch("/admin/users/:id/post-test-score", requireAdmin, async (req, res) => {
  const { score } = req.body ?? {};
  let normalized: number | null;
  if (score === null || score === undefined || score === "") {
    normalized = null;
  } else {
    normalized = Number(score);
    if (!Number.isFinite(normalized) || normalized < 0 || normalized > 100) {
      return res.status(400).json({ error: "score는 0~100 사이 숫자이거나 null이어야 합니다." });
    }
  }
  const { rows } = await pool.query(
    "UPDATE users SET manual_post_test_score = $1 WHERE id = $2 AND role = 'student' RETURNING id, manual_post_test_score",
    [normalized, Number(req.params.id)],
  );
  if (rows.length === 0) return res.status(404).json({ error: "학생을 찾을 수 없습니다." });
  res.json({ ok: true, manualPostTestScore: rows[0].manual_post_test_score != null ? Number(rows[0].manual_post_test_score) : null });
});

adminRouter.post("/admin/users/:id/reset-password", requireAdmin, async (req, res) => {
  const { newPassword } = req.body ?? {};
  if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 1024) {
    return res.status(400).json({ error: "newPassword(8자 이상)가 필요합니다." });
  }
  const hash = await hashPassword(newPassword);
  const changed = await replacePassword(Number(req.params.id), hash);
  if (!changed) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
  res.json({ ok: true, email: changed.email });
});

adminRouter.delete("/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query("DELETE FROM users WHERE id = $1 RETURNING id", [Number(req.params.id)]);
    if (rows.length === 0) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    res.json({ ok: true });
  } catch (err: any) {
    // exam_attempts.user_id 등 여러 외래키가 ON DELETE를 지정하지 않아(기본 NO ACTION), 응시/작성
    // 기록이 하나라도 있는 계정은 삭제가 그냥 실패한다 — 실사용 학생 계정은 거의 다 응시 기록이 있으므로
    // 이 경로를 그대로 두면 매번 원인 불명의 500으로 보였을 것이다. 명확한 이유를 알려준다.
    if (err.code === "23503") {
      return res.status(409).json({ error: "이 계정은 응시·채점 기록이 남아 있어 삭제할 수 없습니다." });
    }
    throw err;
  }
});
