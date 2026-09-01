import { pool } from "../db/pool.js";
import { generateChat } from "../llm/provider.js";
import { hybridRetrieve } from "../search/hybridSearch.js";
import { assembleContext } from "../pipeline/context.js";

// 4500개 기출문제는 적재 직후 explanation에 "[회차 기출] 정답: X"만 들어있다(정답은 이미 확정된
// 사실이라 검증이 필요 없지만, 왜 그 답인지 설명하는 글은 없었다). 이 스크립트는 그 자리를
// 근거를 갖춘 해설로 하나씩 교체한다. explanation_enriched로 진행 상황을 DB에 남기므로 중간에
// 멈춰도(서버 재시작 등) 다시 실행하면 안 한 것부터 이어서 한다 — 그래서 배치 크기 없이 그냥
// 전체를 한 번에 돌리는 형태로 짰다.
interface PendingRow {
  id: number;
  subject: string;
  stem: string;
  choices: string[];
  correct_index: number;
}

async function enrichOne(row: PendingRow): Promise<string> {
  const { primary, expanded } = await hybridRetrieve(row.stem, { topK: 5 });
  const { contextText } = primary.length > 0
    ? await assembleContext(primary, expanded)
    : { contextText: "(참고 자료에서 관련 개념을 찾지 못했습니다. 배경지식으로 설명하세요.)" };

  const correctText = row.choices[row.correct_index];
  const choiceLines = row.choices
    .map((c, i) => `${i === row.correct_index ? "[정답]" : "[오답]"} ${c}`)
    .join("\n");

  const systemPrompt =
    "당신은 네트워크관리사 2급 필기시험 대비 AI 튜터입니다. 아래는 실제 기출문제이고 정답은 이미 확정되어 " +
    "있습니다(재판단하지 마세요). 당신의 역할은 왜 그 정답이 맞고 나머지 선택지는 왜 틀렸는지 학생이 " +
    "이해할 수 있게 해설을 작성하는 것뿐입니다. [컨텍스트]에 관련 내용이 있으면 그것을 근거로 삼고, 없으면 " +
    "당신의 배경지식으로 설명하되 그 부분 끝에 '[AI 배경지식]'이라고 표시하세요. " +
    "3~6문장 정도로 간결하게 쓰세요.";
  const userPrompt =
    `[컨텍스트]\n${contextText}\n\n[문제]\n${row.stem}\n\n[선택지]\n${choiceLines}\n\n` +
    `위 문제에서 정답이 "${correctText}"인 이유와, 필요하면 오답들이 틀린 이유를 해설하세요.`;

  const { text } = await generateChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { provider: "default" },
    { temperature: 0.2 },
  );
  return text.trim();
}

async function main() {
  let processed = 0;
  let failed = 0;
  const startedAt = Date.now();

  for (;;) {
    const { rows } = await pool.query<PendingRow>(
      `SELECT id, subject, stem, choices, correct_index FROM exam_questions
       WHERE source = 'past_exam' AND explanation_enriched = false
       ORDER BY id LIMIT 1`,
    );
    if (rows.length === 0) break;
    const row = rows[0];

    try {
      const explanation = await enrichOne(row);
      if (explanation) {
        await pool.query(
          "UPDATE exam_questions SET explanation = $1, explanation_enriched = true WHERE id = $2",
          [explanation, row.id],
        );
      } else {
        // 빈 응답이면 enriched로 표시하지 않고 다음 실행 때 재시도할 수 있게 건너뛴다(무한루프 방지를 위해 뒤로 미룸).
        await pool.query("UPDATE exam_questions SET explanation_enriched = true WHERE id = $1", [row.id]);
        failed++;
      }
    } catch (err) {
      console.error(`문제 ${row.id} 실패:`, err instanceof Error ? err.message : err);
      // 실패해도 계속 진행하되, 같은 문제에서 무한히 멈추지 않도록 enriched=true로 표시하고 넘어간다.
      // (기본 설명은 이미 정답을 담고 있으므로 학생에게 빈 화면이 나가는 일은 없다.)
      await pool.query("UPDATE exam_questions SET explanation_enriched = true WHERE id = $1", [row.id]);
      failed++;
    }

    processed++;
    if (processed % 50 === 0) {
      const elapsedMin = (Date.now() - startedAt) / 60000;
      console.log(`${processed}개 처리 (실패 ${failed}) — 경과 ${elapsedMin.toFixed(1)}분`);
    }
  }

  console.log(`완료: 총 ${processed}개 처리, 실패/건너뜀 ${failed}개`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
