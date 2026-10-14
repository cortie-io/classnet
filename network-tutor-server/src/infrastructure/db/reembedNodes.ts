import { pathToFileURL } from "node:url";
import {
  activeEmbeddingModelId,
  EMBED_DOCUMENT_BATCH_SIZE,
  embedDocuments,
  nodeEmbedInput,
} from "../llm/embedding.js";
import { pool } from "./pool.js";

// 개념 노드 전체를 지금 임베딩 모델(llm/embedding.ts의 activeEmbeddingModelId)로 임베딩해
// concept_embeddings에 (node_id, model)로 저장한다. 임베딩 공급자·모델을 바꾼 뒤 한 번 돌리고, 서버를
// 재시작해야 메모리에 올린 corpus에 반영된다. 재임베딩 경로는 이 스크립트 하나뿐이다(ingest도 이걸 부른다).
//   npm run embed:nodes            — 이 모델 벡터가 아직 없는 노드만(중간에 끊겼으면 남은 것부터 이어서)
//   npm run embed:nodes -- --all   — 이 모델 벡터를 전부 다시 만든다(개념 노드 본문을 고친 뒤)
// concept_nodes는 읽기만 한다. 예전 버전(39eef2d)은 node_embeddings(PK node_id)를 덮어써서 bge-m3 벡터가
// 사라졌고, 그 전의 유일한 경로(ingest)는 concept_nodes를 TRUNCATE ... CASCADE해 문제은행까지 지울 수 있었다.
// 끝나면 행 수가 개념 노드 수와 같은지, 모든 벡터의 차원이 같은지 확인하고, 아니면 실패로 끝낸다.

interface NodeRow {
  id: number;
  subject: string;
  topic: string;
  title: string;
  body_text: string;
}

export interface ReembedReport {
  model: string;
  corpusSize: number;
  embedded: number;
  stored: number;
  dims: number;
}

export async function reembedConceptNodes(
  opts: {
    all?: boolean;
    /** 테스트에서 실제 API 대신 끼우는 임베딩 함수 */
    embed?: (texts: string[]) => Promise<number[][]>;
    log?: (message: string) => void;
  } = {},
): Promise<ReembedReport> {
  const model = activeEmbeddingModelId();
  if (!model) {
    throw new Error("임베딩 공급자가 꺼져 있습니다(EMBED_PROVIDER=none이거나 OPENAI_API_KEY 없음) — 만들 벡터가 없습니다.");
  }
  const embed = opts.embed ?? embedDocuments;
  const log = opts.log ?? console.log;

  const { rows: nodes } = await pool.query<NodeRow>(
    `SELECT n.id, n.subject, n.topic, n.title, n.body_text
     FROM concept_nodes n
     WHERE $2::boolean
        OR NOT EXISTS (SELECT 1 FROM concept_embeddings ce WHERE ce.node_id = n.id AND ce.model = $1)
     ORDER BY n.id`,
    [model, opts.all === true],
  );
  log(`[embed:nodes] ${model}: ${nodes.length}개 노드를 임베딩합니다${opts.all ? " (--all)" : " (없는 것만)"}.`);

  let embedded = 0;
  for (let i = 0; i < nodes.length; i += EMBED_DOCUMENT_BATCH_SIZE) {
    const batch = nodes.slice(i, i + EMBED_DOCUMENT_BATCH_SIZE);
    const vectors = await embed(batch.map(nodeEmbedInput));
    if (vectors.length !== batch.length) {
      throw new Error(`임베딩 결과 수가 맞지 않습니다: 입력 ${batch.length}개, 결과 ${vectors.length}개`);
    }
    // 묶음마다 바로 저장한다 — 중간에 끊겨도 다시 돌리면 저장된 노드는 건너뛰고 남은 것부터 이어 간다.
    for (let j = 0; j < batch.length; j++) {
      const vector = vectors[j];
      if (!Array.isArray(vector) || vector.length === 0 || vector.some((x) => typeof x !== "number" || !Number.isFinite(x))) {
        throw new Error(`노드 ${batch[j].id}의 임베딩이 올바른 숫자 배열이 아닙니다.`);
      }
      await pool.query(
        `INSERT INTO concept_embeddings (node_id, model, dims, embedding) VALUES ($1, $2, $3, $4)
         ON CONFLICT (node_id, model) DO UPDATE
           SET dims = EXCLUDED.dims, embedding = EXCLUDED.embedding, created_at = now()`,
        [batch[j].id, model, vector.length, JSON.stringify(vector)],
      );
    }
    embedded += batch.length;
    log(`  ${embedded}/${nodes.length}`);
  }

  const { rows } = await pool.query<{ corpus: number; stored: number; dim_kinds: number; dims: number | null; bad_len: number }>(
    `SELECT (SELECT count(*) FROM concept_nodes)::int AS corpus,
            count(ce.node_id)::int AS stored,
            count(DISTINCT ce.dims)::int AS dim_kinds,
            min(ce.dims)::int AS dims,
            (count(*) FILTER (WHERE jsonb_array_length(ce.embedding) <> ce.dims))::int AS bad_len
     FROM concept_embeddings ce
     JOIN concept_nodes n ON n.id = ce.node_id
     WHERE ce.model = $1`,
    [model],
  );
  const check = rows[0];
  if (check.stored !== check.corpus || check.dim_kinds !== 1 || check.bad_len > 0) {
    throw new Error(
      `[embed:nodes] 확인 실패 — 개념 노드 ${check.corpus}개, ${model} 벡터 ${check.stored}개, ` +
        `차원 종류 ${check.dim_kinds}개, 길이가 dims와 다른 벡터 ${check.bad_len}개`,
    );
  }
  log(`[embed:nodes] 완료 — ${check.stored}/${check.corpus}개, ${check.dims}차원. 서버를 재시작해야 검색에 반영됩니다.`);
  return { model, corpusSize: check.corpus, embedded, stored: check.stored, dims: check.dims! };
}

async function main() {
  await reembedConceptNodes({ all: process.argv.includes("--all") });
  await pool.end();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(async (err) => {
    console.error(err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
}
