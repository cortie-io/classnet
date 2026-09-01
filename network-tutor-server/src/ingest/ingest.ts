import { readFileSync, readdirSync } from "node:fs";
import { pool } from "../db/pool.js";
import { embed } from "../llm/ollama.js";
import { parseReferenceDoc } from "./parseDoc.js";

const REF_DIR = "/home/ubuntu/ref";

function findRefFile(): string {
  const files = readdirSync(REF_DIR);
  const target = files.find((f) => f.normalize("NFC").includes("정규화") && f.normalize("NFC").includes("final"));
  if (!target) throw new Error("could not locate 정규화_참조데이터_final.md in ref/");
  return `${REF_DIR}/${target}`;
}

function tableName(subjectNum: string, sectionNo: string, index: number, total: number): string {
  const base = `t${subjectNum}_${sectionNo.replace(".", "_")}`;
  if (total <= 1) return base;
  return `${base}${String.fromCharCode(97 + index)}`; // a, b, c...
}

async function main() {
  const path = findRefFile();
  console.log(`parsing ${path}`);
  const raw = readFileSync(path, "utf8");
  const nodes = parseReferenceDoc(raw);
  console.log(`parsed ${nodes.length} concept nodes`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE concept_nodes CASCADE");

    for (const node of nodes) {
      const nodeRes = await client.query<{ id: number }>(
        `INSERT INTO concept_nodes (subject, category, topic, tag_path, section_no, title, body_md, body_text, order_index)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          node.subject,
          node.category,
          node.topic,
          node.tagPath,
          node.sectionNo,
          node.title,
          node.bodyMd,
          node.bodyText,
          node.orderIndex,
        ],
      );
      const nodeId = nodeRes.rows[0].id;

      for (let t = 0; t < node.tables.length; t++) {
        const table = node.tables[t];
        const tname = tableName(node.subjectNum, node.sectionNo, t, node.tables.length);
        for (let r = 0; r < table.rows.length; r++) {
          await client.query(
            `INSERT INTO lookup_tables (node_id, table_name, row_order, row_data, col_order) VALUES ($1,$2,$3,$4,$5)`,
            [nodeId, tname, r, JSON.stringify(table.rows[r]), JSON.stringify(table.headers)],
          );
        }
      }
    }

    await client.query("COMMIT");
    console.log("concept_nodes + lookup_tables committed");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // embeddings pass (after commit, so failures here don't roll back the content)
  const { rows } = await pool.query<{ id: number; title: string; topic: string; subject: string; body_text: string }>(
    "SELECT id, title, topic, subject, body_text FROM concept_nodes ORDER BY id",
  );
  console.log(`embedding ${rows.length} nodes via bge-m3...`);
  let done = 0;
  for (const row of rows) {
    const embedInput = `${row.subject} > ${row.topic} > ${row.title}\n${row.body_text}`.slice(0, 6000);
    const vector = await embed(embedInput);
    await pool.query(
      `INSERT INTO node_embeddings (node_id, model, embedding) VALUES ($1,$2,$3)
       ON CONFLICT (node_id) DO UPDATE SET model = EXCLUDED.model, embedding = EXCLUDED.embedding`,
      [row.id, "bge-m3:latest", JSON.stringify(vector)],
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
