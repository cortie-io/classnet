import { pool } from "../db/pool.js";

export interface AuditEntry {
  userId: number;
  question: string;
  intent: string;
  retrievedNodeIds: number[];
  ruleEngineTrace: unknown;
  llmRawAnswer: string | null;
  verificationStatus: "verified" | "flagged" | "cached" | "rule_only";
  verificationDetail: unknown;
  finalAnswer: string;
  confidence: number | null;
}

// 검증(팩트체크)을 백그라운드로 돌릴 때 쓴다 — 학생 응답은 낙관적 상태로 먼저 나가고, 검증이 끝나면
// 같은 행을 실제 결과로 갱신한다(교사 검수 큐/캐시는 이 갱신된 값을 본다).
export async function updateAuditLogVerification(
  id: number,
  update: {
    verificationStatus: "verified" | "flagged";
    verificationDetail: unknown;
    finalAnswer: string;
    confidence: number | null;
  },
): Promise<void> {
  await pool.query(
    `UPDATE audit_log SET verification_status = $1, verification_detail = $2, final_answer = $3, confidence = $4 WHERE id = $5`,
    [
      update.verificationStatus,
      update.verificationDetail ? JSON.stringify(update.verificationDetail) : null,
      update.finalAnswer,
      update.confidence,
      id,
    ],
  );
}

export async function writeAuditLog(entry: AuditEntry): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO audit_log
      (user_id, question, intent, retrieved_node_ids, rule_engine_trace, llm_raw_answer,
       verification_status, verification_detail, final_answer, confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      entry.userId,
      entry.question,
      entry.intent,
      entry.retrievedNodeIds,
      entry.ruleEngineTrace ? JSON.stringify(entry.ruleEngineTrace) : null,
      entry.llmRawAnswer,
      entry.verificationStatus,
      entry.verificationDetail ? JSON.stringify(entry.verificationDetail) : null,
      entry.finalAnswer,
      entry.confidence,
    ],
  );
  return rows[0].id;
}
