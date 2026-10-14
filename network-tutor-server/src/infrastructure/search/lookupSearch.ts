import { pool } from "../db/pool.js";

export interface LookupRow {
  tableName: string;
  rowData: Record<string, string>;
}

export async function getTablesForNode(nodeId: number): Promise<LookupRow[]> {
  const { rows } = await pool.query<{ table_name: string; row_data: Record<string, string> }>(
    "SELECT table_name, row_data FROM lookup_tables WHERE node_id = $1 ORDER BY table_name, row_order",
    [nodeId],
  );
  return rows.map((r) => ({ tableName: r.table_name, rowData: r.row_data }));
}

export async function getTableByName(tableName: string): Promise<LookupRow[]> {
  const { rows } = await pool.query<{ table_name: string; row_data: Record<string, string> }>(
    "SELECT table_name, row_data FROM lookup_tables WHERE table_name = $1 ORDER BY row_order",
    [tableName],
  );
  return rows.map((r) => ({ tableName: r.table_name, rowData: r.row_data }));
}

export async function listTableNames(): Promise<{ tableName: string; nodeId: number; nodeTitle: string; rowCount: number }[]> {
  const { rows } = await pool.query<{ table_name: string; node_id: number; title: string; row_count: string }>(
    `SELECT lt.table_name, lt.node_id, n.title, count(*) AS row_count
     FROM lookup_tables lt JOIN concept_nodes n ON n.id = lt.node_id
     GROUP BY lt.table_name, lt.node_id, n.title
     ORDER BY lt.table_name`,
  );
  return rows.map((r) => ({ tableName: r.table_name, nodeId: r.node_id, nodeTitle: r.title, rowCount: Number(r.row_count) }));
}

export interface LookupHit {
  nodeId: number;
  tableName: string;
  matchedRows: LookupRow[];
  totalRowsInTable: number;
}

/**
 * 포트 번호·규격 코드처럼 특정 행을 정확히 가리키는 "구별력 있는" 토큰만 추출한다.
 * "포트", "무슨", "특징" 같은 일반 명사는 여러 표에 두루 걸려 오탐(잘못된 표 선택)을 일으키므로 제외한다.
 * 순수 영문 약어(OSI, TCP, RAID 등)도 숫자가 붙지 않으면 제외한다 — "OSI"처럼 여러 표의 설명문에
 * 두루 등장하는 범용 용어를 특정 토큰으로 취급하면 엉뚱한 표를 조회형으로 잘못 확정하게 된다
 * (예: "OSI 7계층이 뭐야?"가 OSI를 언급만 하는 방화벽 표로 잘못 매칭된 사례).
 */
// OSI처럼 숫자 없는 범용 약어는 이미 제외되지만, IPv4/IPv6처럼 숫자가 붙은 채로 "범용 프로토콜/버전
// 이름"인 토큰은 alphaNumCodes 패턴에 걸려버린다 — 다른 표의 설명문에 "예: IPv4↔IPv6" 식으로 그냥
// 스쳐 언급되기만 해도 그 표가 조회형 히트로 오인되는 사례가 실측 평가에서 확인됐다("IPv4랑 IPv6
// 차이점 알려줘"가 게이트웨이 기능 표로 잘못 매칭됨). 이런 범용 토큰은 특정 행을 가리키는 식별자가
// 아니므로 명시적으로 제외한다.
const COMMON_TERM_DENYLIST = new Set(["ipv4", "ipv6"]);

function extractSpecificTokens(question: string): string[] {
  const multiDigitNumbers = question.match(/\d{2,}(?:\.\d+)?/g) ?? [];
  const alphaNumCodes = question.match(/\b[A-Za-z]+\d+[A-Za-z]*\b|\b\d+[A-Za-z]+\b/g) ?? [];
  // "RAID 5"처럼 단어와 숫자가 띄어써진 복합 식별자도 잡는다("CAT6"처럼 붙여쓴 경우는 위에서 이미
  // 잡힘). "OSI" 사례처럼 숫자 없이 단어만으로는 여전히 특정 토큰으로 인정하지 않으므로(범용 용어가
  // 여러 표에 걸쳐 오탐을 일으켰던 문제, extractSpecificTokens 상단 주석 참고) 숫자가 바로 뒤에
  // 붙어야만 하는 이 패턴은 "특정 행 하나를 가리키는 복합 이름"만 골라낸다.
  const spacedCompounds = (question.match(/\b[A-Za-z]{3,}\s\d{1,2}\b/g) ?? []).map((t) => t.replace(/\s+/g, ""));
  const all = [...multiDigitNumbers, ...alphaNumCodes, ...spacedCompounds].map((t) => t.toLowerCase());
  return Array.from(new Set(all.filter((t) => !COMMON_TERM_DENYLIST.has(t))));
}

/**
 * 검색된 상위 노드들을 순서대로 훑어, 질문의 특정 토큰(포트 번호·규격 코드 등)이 표의 일부 행에만
 * 정확히 걸리는 "조회형" 히트를 찾는다. 특정 토큰이 없으면(순수 일반 질문) 조회형으로 취급하지 않고
 * null을 반환해 설명형(RAG) 경로로 넘긴다 — 애매한 단어 중첩만으로 표를 잘못 선택하는 것을 막기 위함이다.
 */
export async function scanForLookupHit(nodeIds: number[], question: string): Promise<LookupHit | null> {
  const specificTokens = extractSpecificTokens(question);
  if (specificTokens.length === 0) return null;

  for (const nodeId of nodeIds) {
    const rows = await getTablesForNode(nodeId);
    if (rows.length === 0) continue;
    const byTable = new Map<string, LookupRow[]>();
    for (const r of rows) {
      if (!byTable.has(r.tableName)) byTable.set(r.tableName, []);
      byTable.get(r.tableName)!.push(r);
    }
    for (const [tableName, tableRows] of byTable) {
      const matched = matchBySpecificTokens(tableRows, specificTokens);
      if (matched.length > 0 && matched.length < tableRows.length) {
        return { nodeId, tableName, matchedRows: matched, totalRowsInTable: tableRows.length };
      }
    }
  }
  return null;
}

function matchBySpecificTokens(rows: LookupRow[], specificTokens: string[]): LookupRow[] {
  return rows.filter((row) => {
    const haystack = Object.values(row.rowData).join(" ").toLowerCase();
    const haystackNoSpace = haystack.replace(/\s+/g, "");
    // "CAT 6"처럼 원본 표기에 공백이 섞인 경우까지 잡기 위해 공백 제거본에도 대조한다.
    return specificTokens.some((t) => haystack.includes(t) || haystackNoSpace.includes(t.replace(/\s+/g, "")));
  });
}
