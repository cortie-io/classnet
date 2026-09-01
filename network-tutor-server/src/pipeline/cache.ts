import { createHash } from "node:crypto";
import { pool } from "../db/pool.js";

export function normalizeQuestion(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, " ");
}

// 답변이 학생 수준(level)·취약 영역(personalizationTag)별로 달라지므로 캐시 키에 함께 포함한다 —
// 같은 질문이라도 서로 다른 학생에게는 다른 설명이 나가야 하고, 캐시가 그걸 뒤섞으면 안 된다.
export function cacheKeyOf(question: string, level: string, personalizationTag = ""): string {
  return createHash("sha256").update(`${normalizeQuestion(question)}::${level}::${personalizationTag}`).digest("hex");
}

export interface CachedAnswer {
  question: string;
  intent: string;
  finalAnswer: string;
  sourceNodeIds: number[];
  confidence: number | null;
}

export async function getCachedAnswer(key: string): Promise<CachedAnswer | null> {
  const { rows } = await pool.query(
    `SELECT question, intent, final_answer, source_node_ids, confidence FROM answer_cache WHERE cache_key = $1`,
    [key],
  );
  if (rows.length === 0) return null;
  await pool.query(`UPDATE answer_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = $1`, [key]);
  const r = rows[0];
  return {
    question: r.question,
    intent: r.intent,
    finalAnswer: r.final_answer,
    sourceNodeIds: r.source_node_ids ?? [],
    confidence: r.confidence !== null ? Number(r.confidence) : null,
  };
}

export async function setCachedAnswer(params: {
  key: string;
  question: string;
  intent: string;
  finalAnswer: string;
  sourceNodeIds: number[];
  confidence: number | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO answer_cache (cache_key, question, intent, final_answer, source_node_ids, confidence)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (cache_key) DO UPDATE SET
       final_answer = EXCLUDED.final_answer, confidence = EXCLUDED.confidence, last_hit_at = now()`,
    [params.key, params.question, params.intent, params.finalAnswer, params.sourceNodeIds, params.confidence],
  );
}
