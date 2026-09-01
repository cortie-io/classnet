import { randomInt } from "node:crypto";
import { pool } from "../db/pool.js";
import type { GeneratedQuestion } from "./questionTypes.js";

interface NodeRow {
  id: number;
  subject: string;
  title: string;
  section_no: string;
}

interface LookupRow {
  node_id: number;
  table_name: string;
  row_data: Record<string, string>;
  col_order: string[] | null;
}

function shuffle<T>(items: T[]): { shuffled: T[]; correctIndex: number } {
  const arr = items.map((v, i) => ({ v, key: randomInt(1_000_000), origIndex: i }));
  arr.sort((a, b) => a.key - b.key);
  const correctIndex = arr.findIndex((x) => x.origIndex === 0);
  return { shuffled: arr.map((x) => x.v), correctIndex };
}

/**
 * 표 데이터에서 결정론적으로 4지선다 문제를 만든다. LLM을 전혀 쓰지 않는다 — 정답도 오답도 전부
 * 실제 정규화 표 값 그대로이므로, 문제 생성 단계에서 사실 오류가 들어갈 여지가 구조적으로 없다.
 *
 * 라벨(식별) 컬럼은 반드시 col_order[0](원본 마크다운 표의 첫 헤더)를 써야 한다 — row_data는
 * JSONB라서 키 순서가 보존되지 않고, Object.keys()로 "첫 컬럼"을 추정하면 Postgres가 재정렬한
 * 순서(예: "비고"가 앞으로 옴)를 잘못 집어 "설명문의 무엇은?"처럼 뒤집힌 문제가 나온다(실측 확인됨).
 */
export async function generateLookupQuestions(maxPerTable = 2): Promise<GeneratedQuestion[]> {
  const { rows: nodes } = await pool.query<NodeRow>(
    "SELECT id, subject, title, section_no FROM concept_nodes",
  );
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const { rows: lookupRows } = await pool.query<LookupRow>(
    "SELECT node_id, table_name, row_data, col_order FROM lookup_tables ORDER BY table_name, row_order",
  );

  const byTable = new Map<string, LookupRow[]>();
  for (const r of lookupRows) {
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, []);
    byTable.get(r.table_name)!.push(r);
  }

  const out: GeneratedQuestion[] = [];

  for (const [tableName, rowsInTable] of byTable) {
    if (rowsInTable.length < 2) continue;
    const node = nodeById.get(rowsInTable[0].node_id);
    if (!node) continue;

    const colOrder = rowsInTable[0].col_order;
    const columns = colOrder && colOrder.length > 0 ? colOrder : Object.keys(rowsInTable[0].row_data);
    if (columns.length < 2) continue;
    const labelCol = columns[0];

    // 라벨 컬럼을 제외한 나머지 컬럼 중, 서로 다른 값이 4개 이상 있는 컬럼만 문제로 쓸 수 있다
    // (그래야 오답 선지 3개를 실제 표 값에서 구할 수 있다).
    const candidateCols = columns.slice(1).filter((col) => {
      const distinct = new Set(rowsInTable.map((r) => r.row_data[col]).filter(Boolean));
      return distinct.size >= 4;
    });
    if (candidateCols.length === 0) continue;

    let made = 0;
    for (const row of rowsInTable) {
      if (made >= maxPerTable) break;
      const labelValue = row.row_data[labelCol];
      if (!labelValue) continue;
      const factCol = candidateCols[randomInt(0, candidateCols.length)];
      const correctValue = row.row_data[factCol];
      if (!correctValue) continue;

      const distractorPool = rowsInTable
        .filter((r) => r !== row && r.row_data[factCol] && r.row_data[factCol] !== correctValue)
        .map((r) => r.row_data[factCol]);
      const uniqueDistractors = [...new Set(distractorPool)];
      if (uniqueDistractors.length < 3) continue;

      const picked: string[] = [];
      const pool2 = [...uniqueDistractors];
      while (picked.length < 3 && pool2.length > 0) {
        const idx = randomInt(0, pool2.length);
        picked.push(pool2.splice(idx, 1)[0]);
      }
      if (picked.length < 3) continue;

      const { shuffled, correctIndex } = shuffle([correctValue, ...picked]);
      out.push({
        subject: node.subject,
        conceptNodeId: node.id,
        stem: `다음 중 '${labelValue}'의 ${factCol}(으)로 옳은 것은? (${node.title})`,
        choices: shuffled,
        correctIndex,
        explanation: `${node.title}(${node.section_no}) 기준: ${labelCol}=${labelValue}일 때 ${factCol}=${correctValue}`,
        sourceDetail: { generator: "lookup_table", tableName, labelCol, factCol, labelValue },
      });
      made++;
    }
  }

  return out;
}
