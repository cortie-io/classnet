import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { pool } from "../db/pool.js";
import { reembedConceptNodes } from "../db/reembedNodes.js";
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

/**
 * 이 스크립트는 concept_nodes를 TRUNCATE ... CASCADE로 통째로 다시 만든다. Postgres의 CASCADE는 외래키로
 * 걸린 테이블을 ON DELETE 규칙과 상관없이 전부 비우므로, 문제은행(exam_questions)과 거기 달린 학생 답안
 * (exam_answers)·북마크(bookmarks)까지 함께 사라진다. 그런 데이터가 하나라도 있으면 시작하지 않는다.
 * 임베딩만 바꾸려면 이 스크립트가 아니라 `npm run embed:nodes`를 쓴다(concept_nodes를 건드리지 않음).
 * 노드를 지우지 않고 section_no로 갱신하는 재작성은 별도 작업으로 남겨 둔다.
 */
export async function assertSafeToReingest(db: Pick<typeof pool, "query"> = pool): Promise<void> {
  const { rows } = await db.query<{ questions: number; bookmarks: number }>(
    `SELECT (SELECT count(*) FROM exam_questions)::int AS questions,
            (SELECT count(*) FROM bookmarks)::int AS bookmarks`,
  );
  const { questions, bookmarks } = rows[0];
  if (questions > 0 || bookmarks > 0) {
    throw new Error(
      `[ingest] 중단: 문제은행 ${questions}문항, 북마크 ${bookmarks}건이 있어 concept_nodes를 다시 만들 수 없습니다 ` +
        "(TRUNCATE ... CASCADE가 문제·학생 답안까지 지웁니다). 임베딩만 바꾸려면 npm run embed:nodes를 쓰세요.",
    );
  }
}

async function main() {
  await assertSafeToReingest();
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

  // embeddings pass (after commit, so failures here don't roll back the content). 재임베딩과 같은 코드를
  // 쓴다 — 실패하면 내용은 그대로 두고 npm run embed:nodes로 이어서 돌리면 된다.
  await reembedConceptNodes({ all: true });

  await pool.end();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
