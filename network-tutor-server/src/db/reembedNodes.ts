import { embed, embedModelId, nodeEmbedInput } from "../llm/embedding.js";
import { pool } from "./pool.js";

// 개념 노드 전체를 지금 임베딩 모델(embedding.ts의 embedModelId)로 다시 임베딩한다. 임베딩 공급자를
// 바꾼 뒤 한 번 돌리고, 서버를 재시작해야 메모리에 올린 corpus에 반영된다.
//   npm run embed:nodes
async function main() {
  const { rows } = await pool.query<{ id: number; title: string; topic: string; subject: string; body_text: string }>(
    "SELECT id, title, topic, subject, body_text FROM concept_nodes ORDER BY id",
  );
  console.log(`embedding ${rows.length} nodes via ${embedModelId}...`);
  let done = 0;
  for (const row of rows) {
    const vector = await embed(nodeEmbedInput(row));
    await pool.query(
      `INSERT INTO node_embeddings (node_id, model, embedding) VALUES ($1,$2,$3)
       ON CONFLICT (node_id) DO UPDATE SET model = EXCLUDED.model, embedding = EXCLUDED.embedding, created_at = now()`,
      [row.id, embedModelId, JSON.stringify(vector)],
    );
    done++;
    if (done % 10 === 0) console.log(`  ${done}/${rows.length}`);
  }
  console.log(`embedded ${done} nodes`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
