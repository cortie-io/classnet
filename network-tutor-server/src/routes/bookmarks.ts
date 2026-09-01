import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../auth/middleware.js";

export const bookmarksRouter = Router();

bookmarksRouter.get("/bookmarks", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT b.concept_node_id, b.created_at, n.subject, n.category, n.topic, n.section_no, n.title
     FROM bookmarks b JOIN concept_nodes n ON n.id = b.concept_node_id
     WHERE b.user_id = $1 ORDER BY b.created_at DESC`,
    [req.user!.id],
  );
  res.json(rows);
});

bookmarksRouter.post("/bookmarks/:nodeId", requireAuth, async (req, res) => {
  const nodeId = Number(req.params.nodeId);
  if (!Number.isFinite(nodeId)) return res.status(400).json({ error: "nodeId는 숫자여야 합니다." });
  const { rows: nodeRows } = await pool.query("SELECT id FROM concept_nodes WHERE id = $1", [nodeId]);
  if (nodeRows.length === 0) return res.status(404).json({ error: "존재하지 않는 개념 노드입니다." });
  await pool.query(
    "INSERT INTO bookmarks (user_id, concept_node_id) VALUES ($1,$2) ON CONFLICT (user_id, concept_node_id) DO NOTHING",
    [req.user!.id, nodeId],
  );
  res.status(201).json({ ok: true });
});

bookmarksRouter.delete("/bookmarks/:nodeId", requireAuth, async (req, res) => {
  await pool.query("DELETE FROM bookmarks WHERE user_id = $1 AND concept_node_id = $2", [
    req.user!.id,
    Number(req.params.nodeId),
  ]);
  res.json({ ok: true });
});
