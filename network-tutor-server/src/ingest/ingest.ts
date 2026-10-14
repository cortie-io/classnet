import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { pool } from "../infrastructure/db/pool.js";
import { reembedConceptNodes } from "../infrastructure/db/reembedNodes.js";
import { type ParsedNode, parseReferenceDoc } from "./parseDoc.js";

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

/** Updates section identities in place; student and question references remain valid. */
export async function ingestNodes(nodes: ParsedNode[]): Promise<void> {
  if (nodes.length === 0) throw new Error("입력 문서에 개념이 없습니다.");
  const sections = new Set(nodes.map((node) => node.sectionNo));
  if (sections.size !== nodes.length) throw new Error("입력 문서의 절 번호가 중복됩니다.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7240614)");

    for (const node of nodes) {
      const nodeRes = await client.query<{ id: number }>(
        `INSERT INTO concept_nodes (subject, category, topic, tag_path, section_no, title, body_md, body_text, order_index)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (section_no) DO UPDATE SET
           subject=EXCLUDED.subject, category=EXCLUDED.category, topic=EXCLUDED.topic,
           tag_path=EXCLUDED.tag_path, title=EXCLUDED.title, body_md=EXCLUDED.body_md,
           body_text=EXCLUDED.body_text, order_index=EXCLUDED.order_index
         RETURNING id`,
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
      await client.query("DELETE FROM lookup_tables WHERE node_id = $1", [nodeId]);
      await client.query("DELETE FROM node_embeddings WHERE node_id = $1", [nodeId]);
      await client.query("DELETE FROM concept_embeddings WHERE node_id = $1", [nodeId]);

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

}
async function main() {
  const path = findRefFile();
  const nodes = parseReferenceDoc(readFileSync(path, "utf8"));
  await ingestNodes(nodes);
  await reembedConceptNodes({ all: true });
  await pool.end();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
