import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireAdmin } from "../auth/middleware.js";

export const settingsRouter = Router();

// 지금은 시험일 D-day 하나만 쓰지만, 나중에 다른 전역 설정이 필요해지면 같은 key-value 테이블로 확장한다.
settingsRouter.get("/settings/exam-date", requireAuth, async (_req, res) => {
  const { rows } = await pool.query("SELECT value FROM app_settings WHERE key = 'exam_date'");
  res.json({ examDate: rows[0]?.value ?? null });
});

settingsRouter.post("/admin/settings/exam-date", requireAdmin, async (req, res) => {
  const { examDate } = req.body ?? {};
  if (examDate !== null && typeof examDate !== "string") {
    return res.status(400).json({ error: "examDate(YYYY-MM-DD 문자열 또는 null)가 필요합니다." });
  }
  if (examDate === null) {
    await pool.query("DELETE FROM app_settings WHERE key = 'exam_date'");
  } else {
    await pool.query(
      "INSERT INTO app_settings (key, value) VALUES ('exam_date', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [examDate],
    );
  }
  res.json({ ok: true });
});
