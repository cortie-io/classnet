import { Router } from "express";
import { listTableNames, getTableByName } from "../search/lookupSearch.js";
import { requireAuth } from "../auth/middleware.js";

export const lookupRouter = Router();

lookupRouter.get("/lookup/tables", requireAuth, async (_req, res) => {
  res.json(await listTableNames());
});

lookupRouter.get("/lookup/tables/:tableName", requireAuth, async (req, res) => {
  const rows = await getTableByName(req.params.tableName);
  if (rows.length === 0) return res.status(404).json({ error: "해당 이름의 테이블이 없습니다." });
  res.json(rows);
});
