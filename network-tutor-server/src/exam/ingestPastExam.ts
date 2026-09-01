import { readFileSync } from "node:fs";
import { pool } from "../db/pool.js";

// 이 스크립트는 CSV를 직접 파싱하지 않는다 — 원본 CSV(90회차 x 50문항, 4지선다,
// 컬럼: 연도/월/일/회차/문제번호/문제/보기1-4/정답번호/정답내용/비고/원본파일/이미지파일)를
// Python으로 먼저 검증·변환해 JSON으로 만들어 두고(따옴표 안 콤마 등 CSV 파싱 함정을 피하기 위함),
// 여기서는 그 JSON을 그대로 exam_questions에 적재만 한다.
interface PastExamRow {
  subject: string;
  stem: string;
  choices: string[];
  correct_index: number;
  explanation: string;
  stem_image_url: string | null;
  source_detail: Record<string, unknown>;
}

const JSON_PATH = process.argv[2];
if (!JSON_PATH) {
  console.error("사용법: tsx src/exam/ingestPastExam.ts <past_exam_questions.json>");
  process.exit(1);
}

async function main() {
  const rows: PastExamRow[] = JSON.parse(readFileSync(JSON_PATH, "utf-8"));
  console.log(`${rows.length}개 기출문제 적재 시작...`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let inserted = 0;
    for (const r of rows) {
      await client.query(
        `INSERT INTO exam_questions
          (source, source_detail, subject, stem, choices, correct_index, explanation, status, stem_image_url, reviewed_at)
         VALUES ('past_exam', $1, $2, $3, $4, $5, $6, 'approved', $7, now())`,
        [
          JSON.stringify(r.source_detail),
          r.subject,
          r.stem,
          JSON.stringify(r.choices),
          r.correct_index,
          r.explanation,
          r.stem_image_url,
        ],
      );
      inserted++;
      if (inserted % 500 === 0) console.log(`  ${inserted}/${rows.length}...`);
    }
    await client.query("COMMIT");
    console.log(`완료: ${inserted}개 삽입 (source='past_exam', status='approved')`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
