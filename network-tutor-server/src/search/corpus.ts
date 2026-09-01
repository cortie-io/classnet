import { pool } from "../db/pool.js";

export interface ConceptNode {
  id: number;
  subject: string;
  category: string;
  topic: string;
  tagPath: string;
  sectionNo: string;
  title: string;
  bodyMd: string;
  bodyText: string;
  orderIndex: number;
  embedding: number[];
}

let corpus: ConceptNode[] = [];
let byId = new Map<number, ConceptNode>();

export async function loadCorpus(): Promise<void> {
  const { rows } = await pool.query<{
    id: number;
    subject: string;
    category: string;
    topic: string;
    tag_path: string;
    section_no: string;
    title: string;
    body_md: string;
    body_text: string;
    order_index: number;
    embedding: number[] | null;
  }>(
    `SELECT n.id, n.subject, n.category, n.topic, n.tag_path, n.section_no, n.title,
            n.body_md, n.body_text, n.order_index, e.embedding
     FROM concept_nodes n
     LEFT JOIN node_embeddings e ON e.node_id = n.id
     ORDER BY n.order_index`,
  );
  corpus = rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    category: r.category,
    topic: r.topic,
    tagPath: r.tag_path,
    sectionNo: r.section_no,
    title: r.title,
    bodyMd: r.body_md,
    bodyText: r.body_text,
    orderIndex: r.order_index,
    embedding: r.embedding ?? [],
  }));
  byId = new Map(corpus.map((n) => [n.id, n]));
  console.log(`[corpus] loaded ${corpus.length} concept nodes into memory`);
}

export function getCorpus(): ConceptNode[] {
  return corpus;
}

export function getNode(id: number): ConceptNode | undefined {
  return byId.get(id);
}

export function getSiblings(node: ConceptNode, excludeIds: Set<number>, limit = 2): ConceptNode[] {
  return corpus
    .filter((n) => n.id !== node.id && n.subject === node.subject && n.category === node.category && !excludeIds.has(n.id))
    .slice(0, limit);
}
