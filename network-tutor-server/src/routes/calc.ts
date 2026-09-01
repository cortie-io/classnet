import { Router } from "express";
import { subnetCalculate, classifyIp, convertBase, shannonCapacity, nyquistCapacity } from "../rules/calculators.js";
import { requireAuth } from "../auth/middleware.js";

export const calcRouter = Router();

function handle(fn: () => unknown, res: import("express").Response) {
  try {
    res.json(fn());
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

calcRouter.post("/calc/subnet", requireAuth, (req, res) => {
  const { ip, prefix, mask } = req.body ?? {};
  if (typeof ip !== "string" || (prefix === undefined && mask === undefined)) {
    return res.status(400).json({ error: "ip와 prefix(숫자) 또는 mask(문자열)가 필요합니다." });
  }
  handle(() => subnetCalculate(ip, prefix !== undefined ? Number(prefix) : String(mask)), res);
});

calcRouter.post("/calc/ip-class", requireAuth, (req, res) => {
  const { ip } = req.body ?? {};
  if (typeof ip !== "string") return res.status(400).json({ error: "ip(string)가 필요합니다." });
  handle(() => classifyIp(ip), res);
});

calcRouter.post("/calc/base-convert", requireAuth, (req, res) => {
  const { value, from, to } = req.body ?? {};
  if (typeof value !== "string" || ![2, 10, 16].includes(Number(from)) || ![2, 10, 16].includes(Number(to))) {
    return res.status(400).json({ error: "value(string), from(2|10|16), to(2|10|16)가 필요합니다." });
  }
  handle(() => convertBase(value, Number(from) as 2 | 10 | 16, Number(to) as 2 | 10 | 16), res);
});

calcRouter.post("/calc/channel-capacity", requireAuth, (req, res) => {
  const { type, bandwidthHz, snr, snrIsDb, levels } = req.body ?? {};
  if (type === "shannon") {
    if (typeof bandwidthHz !== "number" || typeof snr !== "number") {
      return res.status(400).json({ error: "shannon: bandwidthHz(number), snr(number)가 필요합니다." });
    }
    handle(() => shannonCapacity(bandwidthHz, snr, !!snrIsDb), res);
  } else if (type === "nyquist") {
    if (typeof bandwidthHz !== "number" || typeof levels !== "number") {
      return res.status(400).json({ error: "nyquist: bandwidthHz(number), levels(number)가 필요합니다." });
    }
    handle(() => nyquistCapacity(bandwidthHz, levels), res);
  } else {
    res.status(400).json({ error: "type은 'shannon' 또는 'nyquist'여야 합니다." });
  }
});
