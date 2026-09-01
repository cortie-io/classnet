import { randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일

export interface SessionUser {
  id: number;
  role: "admin" | "student";
  studentId: string | null;
  name: string;
  email: string;
  level: "beginner" | "intermediate" | "advanced";
  hasOpenaiKey: boolean;
}

export async function createSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1,$2,$3)", [token, userId, expiresAt]);
  return { token, expiresAt };
}

export async function deleteSession(token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
}

/** network-tutor-web(Next.js 프런트)이 서버 간 신뢰 호출로 사용자를 식별할 때 쓴다 — 세션 쿠키 없이 id로 직접 조회. */
export async function getUserById(userId: number): Promise<SessionUser | null> {
  const { rows } = await pool.query<{
    id: number;
    role: "admin" | "student";
    student_id: string | null;
    name: string;
    email: string;
    level: "beginner" | "intermediate" | "advanced";
    openai_api_key_encrypted: string | null;
  }>(
    `SELECT id, role, student_id, name, email, level, openai_api_key_encrypted FROM users WHERE id = $1`,
    [userId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    role: r.role,
    studentId: r.student_id,
    name: r.name,
    email: r.email,
    level: r.level,
    hasOpenaiKey: !!r.openai_api_key_encrypted,
  };
}

export async function getSessionUser(token: string): Promise<SessionUser | null> {
  const { rows } = await pool.query<{
    id: number;
    role: "admin" | "student";
    student_id: string | null;
    name: string;
    email: string;
    level: "beginner" | "intermediate" | "advanced";
    openai_api_key_encrypted: string | null;
  }>(
    `SELECT u.id, u.role, u.student_id, u.name, u.email, u.level, u.openai_api_key_encrypted
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    role: r.role,
    studentId: r.student_id,
    name: r.name,
    email: r.email,
    level: r.level,
    hasOpenaiKey: !!r.openai_api_key_encrypted,
  };
}
