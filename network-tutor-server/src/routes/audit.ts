import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAdmin, requireAuth } from "../auth/middleware.js";

export const auditRouter = Router();

// 학생이 채팅 답변 아래 "이 답변이 이상해요" 버튼을 눌렀을 때 호출된다. 본인의 질문 기록만 신고할 수 있고,
// verification_status를 강제로 flagged로 바꿔 관리자 검수 큐(자동 검증에서 걸린 것과 동일한 큐)에 올린다.
auditRouter.post("/audit/:id/report", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE audit_log SET verification_status = 'flagged', student_reported = true
     WHERE id = $1 AND user_id = $2 RETURNING id`,
    [Number(req.params.id), req.user!.id],
  );
  if (rows.length === 0) return res.status(404).json({ error: "해당 기록을 찾을 수 없습니다." });
  res.json({ ok: true });
});

auditRouter.get("/audit", requireAdmin, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const reviewed = req.query.reviewed === "true" ? true : req.query.reviewed === "false" ? false : null;
  // 주의: `userId`는 attachUser가 내부 호출자(관리자 본인)를 식별하는 데 이미 쓰는 쿼리 파라미터라서,
  // 여기서 같은 이름을 학생 필터로 쓰면 관리자 자신의 user_id로 감사로그가 걸러져 버린다
  // (실제로 채팅을 거의 안 쓴 관리자 계정은 감사로그가 통째로 비어 보이는 버그가 있었음). 별도 이름을 쓴다.
  const studentId = req.query.studentId ? Number(req.query.studentId) : null;
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const offset = Number(req.query.offset ?? 0);

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (status) {
    params.push(status);
    conditions.push(`a.verification_status = $${params.length}`);
  }
  if (reviewed !== null) {
    params.push(reviewed);
    conditions.push(`a.reviewed = $${params.length}`);
  }
  if (studentId !== null) {
    params.push(studentId);
    conditions.push(`a.user_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT a.id, a.user_id, u.name AS user_name, u.email AS user_email, a.question, a.intent,
            a.verification_status, a.confidence, a.reviewed, a.created_at
     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     ${where}
     ORDER BY a.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const { rows: countRows } = await pool.query(
    `SELECT count(*)::int AS total FROM audit_log a ${where}`,
    params.slice(0, -2),
  );
  res.json({ total: countRows[0].total, items: rows });
});

auditRouter.get("/audit/:id", requireAdmin, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM audit_log WHERE id = $1", [Number(req.params.id)]);
  if (rows.length === 0) return res.status(404).json({ error: "해당 로그가 없습니다." });
  res.json(rows[0]);
});

auditRouter.post("/audit/:id/review", requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    "UPDATE audit_log SET reviewed = true WHERE id = $1 RETURNING id, reviewed",
    [Number(req.params.id)],
  );
  if (rows.length === 0) return res.status(404).json({ error: "해당 로그가 없습니다." });
  res.json(rows[0]);
});

auditRouter.get("/audit-summary/stats", requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT verification_status, count(*)::int AS count FROM audit_log GROUP BY verification_status`,
  );
  const { rows: pending } = await pool.query(
    `SELECT count(*)::int AS count FROM audit_log WHERE verification_status = 'flagged' AND reviewed = false`,
  );
  res.json({ byStatus: rows, pendingReview: pending[0].count });
});
