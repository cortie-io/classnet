import type { RetrievedNode } from "../search/hybridSearch.js";
import { getTablesForNode } from "../search/lookupSearch.js";

export interface SourceFootnote {
  nodeId: number;
  subject: string;
  category: string;
  topic: string;
  sectionNo: string;
  title: string;
  score: number | null;
  via: "hybrid" | "graph_expansion";
}

export interface AssembledContext {
  contextText: string;
  sources: SourceFootnote[];
  ontologyPath: string[];
}

function firstSentence(text: string): string {
  const clean = text.split("\n").find((l) => l.trim().length > 0) ?? "";
  return clean.length > 120 ? `${clean.slice(0, 120)}...` : clean;
}

export async function assembleContext(primary: RetrievedNode[], expanded: RetrievedNode[]): Promise<AssembledContext> {
  const blocks: string[] = [];
  const sources: SourceFootnote[] = [];

  for (const r of primary) {
    const n = r.node;
    blocks.push(
      `### [${n.subject} > ${n.category} > ${n.topic}] (${n.sectionNo} ${n.title})\n${n.bodyMd}`,
    );
    const tables = await getTablesForNode(n.id);
    if (tables.length > 0) {
      const grouped = new Map<string, Record<string, string>[]>();
      for (const t of tables) {
        if (!grouped.has(t.tableName)) grouped.set(t.tableName, []);
        grouped.get(t.tableName)!.push(t.rowData);
      }
      for (const [tableName, rows] of grouped) {
        const rendered = rows.map((row) => Object.entries(row).map(([k, v]) => `${k}=${v}`).join(", ")).join("\n");
        blocks.push(`[정규화 표: ${tableName}]\n${rendered}`);
      }
    }
    sources.push({
      nodeId: n.id,
      subject: n.subject,
      category: n.category,
      topic: n.topic,
      sectionNo: n.sectionNo,
      title: n.title,
      score: r.vectorScore ?? r.rrfScore,
      via: r.via,
    });
  }

  if (expanded.length > 0) {
    const lines = expanded.map((r) => `- [${r.node.category} > ${r.node.topic}] ${firstSentence(r.node.bodyText)}`);
    blocks.push(`### 인접 개념(온톨로지 1-hop 확장)\n${lines.join("\n")}`);
    for (const r of expanded) {
      sources.push({
        nodeId: r.node.id,
        subject: r.node.subject,
        category: r.node.category,
        topic: r.node.topic,
        sectionNo: r.node.sectionNo,
        title: r.node.title,
        score: null,
        via: r.via,
      });
    }
  }

  const top = primary[0]?.node;
  const ontologyPath = top ? [top.subject, top.category, top.topic] : [];

  return { contextText: blocks.join("\n\n"), sources, ontologyPath };
}
