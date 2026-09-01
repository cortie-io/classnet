import { pool } from "../db/pool.js";
import { generateCalcQuestions } from "./generateCalcQuestions.js";
import { generateLookupQuestions } from "./generateLookupQuestions.js";
import { generateConceptQuestions } from "./generateConceptQuestions.js";
import type { GeneratedQuestion } from "./questionTypes.js";

async function insertQuestions(questions: GeneratedQuestion[], verificationDetail: Record<string, unknown>) {
  for (const q of questions) {
    await pool.query(
      `INSERT INTO exam_questions
        (source, source_detail, subject, concept_node_id, stem, choices, correct_index, explanation, status, verification_detail)
       VALUES ('ai_generated', $1, $2, $3, $4, $5, $6, $7, 'pending_review', $8)`,
      [
        JSON.stringify(q.sourceDetail),
        q.subject,
        q.conceptNodeId,
        q.stem,
        JSON.stringify(q.choices),
        q.correctIndex,
        q.explanation,
        JSON.stringify(verificationDetail),
      ],
    );
  }
}

async function main() {
  console.log("=== 계산형 문제 생성(규칙엔진 결정론적) ===");
  const calcQuestions = generateCalcQuestions(30);
  await insertQuestions(calcQuestions, { method: "rule_engine_deterministic" });
  console.log(`${calcQuestions.length}개 생성·저장`);

  console.log("=== 표 기반 조회형 문제 생성(정규화 표 결정론적) ===");
  const lookupQuestions = await generateLookupQuestions(2);
  await insertQuestions(lookupQuestions, { method: "lookup_table_deterministic" });
  console.log(`${lookupQuestions.length}개 생성·저장`);

  console.log("=== 개념 설명형 문제 생성(LLM + 자기검증) ===");
  const { accepted, discarded } = await generateConceptQuestions();
  await insertQuestions(accepted, { method: "llm_generated_grounding_verified" });
  console.log(`${accepted.length}개 생성·저장, ${discarded}개 검증 실패로 폐기`);

  const total = calcQuestions.length + lookupQuestions.length + accepted.length;
  console.log(`\n총 ${total}개 문제가 pending_review 상태로 저장됨 (교사 승인 전까지 시험에 출제되지 않음)`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
