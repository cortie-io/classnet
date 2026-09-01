import { Router } from "express";
import { pool } from "../db/pool.js";
import { getTablesForNode } from "../search/lookupSearch.js";
import { requireAuth } from "../auth/middleware.js";

export const ontologyRouter = Router();

ontologyRouter.get("/ontology/tree", requireAuth, async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT id, subject, category, topic, section_no, title FROM concept_nodes ORDER BY order_index",
  );
  const tree: Record<string, Record<string, { id: number; sectionNo: string; title: string; topic: string }[]>> = {};
  for (const r of rows) {
    tree[r.subject] ??= {};
    tree[r.subject][r.category] ??= [];
    tree[r.subject][r.category].push({ id: r.id, sectionNo: r.section_no, title: r.title, topic: r.topic });
  }
  res.json(tree);
});

ontologyRouter.get("/ontology/node/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "id는 숫자여야 합니다." });
  const { rows } = await pool.query("SELECT * FROM concept_nodes WHERE id = $1", [id]);
  if (rows.length === 0) return res.status(404).json({ error: "노드를 찾을 수 없습니다." });
  const node = rows[0];
  const tables = await getTablesForNode(id);
  const { rows: siblings } = await pool.query(
    "SELECT id, section_no, title, topic FROM concept_nodes WHERE subject = $1 AND category = $2 AND id != $3 ORDER BY order_index",
    [node.subject, node.category, id],
  );
  res.json({ node, tables, siblings });
});
