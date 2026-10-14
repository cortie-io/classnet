import { replacePassword } from "./passwordReset.js";
import { Router } from "express";
import { pool } from "../../infrastructure/db/pool.js";
import { hashPassword, verifyPassword } from "./password.js";
import { encryptSecret } from "./crypto.js";
import { createSession, deleteSession } from "./session.js";
import { setSessionCookie, clearSessionCookie, requireAuth } from "./middleware.js";

import { consumeLoginLimit, UsageLimitError } from "./limits.js";

export const authRouter = Router();

authRouter.post("/auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || email.length > 254 || typeof password !== "string" || password.length > 1024) {
    return res.status(400).json({ error: "email, password가 필요합니다." });
  }
  try {
    await consumeLoginLimit(email);
  } catch (err) {
    if (!(err instanceof UsageLimitError)) throw err;
    res.setHeader("Retry-After", err.retryAfter);
    return res.status(429).json({ error: err.message });
  }
  const { rows } = await pool.query<{ id: number; password_hash: string }>(
    "SELECT id, password_hash FROM users WHERE email = $1",
    [email.trim().toLowerCase()],
  );
  if (rows.length === 0 || !(await verifyPassword(password, rows[0].password_hash))) {
    return res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." });
  }
  const { token, expiresAt } = await createSession(rows[0].id);
  setSessionCookie(res, token, expiresAt);
  res.json({ ok: true });
});

authRouter.post("/auth/logout", requireAuth, async (req, res) => {
  if (req.sessionToken) await deleteSession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get("/auth/me", requireAuth, (req, res) => {
  res.json(req.user);
});

authRouter.post("/auth/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 1024) {
    return res.status(400).json({ error: "currentPassword, newPassword(8자 이상)가 필요합니다." });
  }
  const { rows } = await pool.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [
    req.user!.id,
  ]);
  if (!(await verifyPassword(currentPassword, rows[0].password_hash))) {
    return res.status(401).json({ error: "현재 비밀번호가 올바르지 않습니다." });
  }
  const newHash = await hashPassword(newPassword);
  await replacePassword(req.user!.id, newHash);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.patch("/me/profile", requireAuth, async (req, res) => {
  const { level } = req.body ?? {};
  if (!["beginner", "intermediate", "advanced"].includes(level)) {
    return res.status(400).json({ error: "level은 beginner|intermediate|advanced 중 하나여야 합니다." });
  }
  await pool.query("UPDATE users SET level = $1 WHERE id = $2", [level, req.user!.id]);
  res.json({ ok: true, level });
});

authRouter.put("/me/openai-key", requireAuth, async (req, res) => {
  const { apiKey } = req.body ?? {};
  if (typeof apiKey !== "string" || !apiKey.startsWith("sk-")) {
    return res.status(400).json({ error: "올바른 OpenAI API 키 형식이 아닙니다." });
  }
  await pool.query("UPDATE users SET openai_api_key_encrypted = $1 WHERE id = $2", [encryptSecret(apiKey), req.user!.id]);
  res.json({ ok: true });
});

authRouter.delete("/me/openai-key", requireAuth, async (req, res) => {
  await pool.query("UPDATE users SET openai_api_key_encrypted = NULL WHERE id = $1", [req.user!.id]);
  res.json({ ok: true });
});
