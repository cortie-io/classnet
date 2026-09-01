import { Router } from "express";
import { pool } from "../db/pool.js";
import { answerQuestion, type RequesterContext } from "../pipeline/answerPipeline.js";
import { requireAuth } from "../auth/middleware.js";
import { decryptSecret } from "../auth/crypto.js";
import type { ProviderChoice } from "../llm/provider.js";

export const problemRouter = Router();

const CHOICE_MARKS = ["①", "②", "③", "④", "⑤"];

problemRouter.post("/problem/explain", requireAuth, async (req, res) => {
  const { stem, choices, extraQuestion, imageBase64, useOwnKey } = req.body ?? {};
  if (typeof stem !== "string" || stem.trim().length === 0) {
    return res.status(400).json({ error: "stem(문제 지문)이 필요합니다." });
  }
  const choiceLines =
    Array.isArray(choices) && choices.length > 0
      ? choices.map((c: unknown, i: number) => `${CHOICE_MARKS[i] ?? `(${i + 1})`} ${String(c)}`).join("\n")
      : "";
  const ask = typeof extraQuestion === "string" && extraQuestion.trim() ? extraQuestion.trim() : "이 문제의 정답과 해설을 근거와 함께 알려줘.";

  const composed = [
    "[학생이 직접 입력한 문제]",
    stem.trim(),
    choiceLines,
    "",
    `[요청] ${ask}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    let provider: ProviderChoice = { provider: "default" };
    if (useOwnKey !== false && req.user!.hasOpenaiKey) {
      const { rows } = await pool.query<{ openai_api_key_encrypted: string | null }>(
        "SELECT openai_api_key_encrypted FROM users WHERE id = $1",
        [req.user!.id],
      );
      const encrypted = rows[0]?.openai_api_key_encrypted;
      if (encrypted) provider = { provider: "openai", openaiApiKey: decryptSecret(encrypted) };
    }
    const ctx: RequesterContext = {
      userId: req.user!.id,
      level: req.user!.level,
      provider,
      imageBase64: typeof imageBase64 === "string" ? imageBase64 : undefined,
    };
    const result = await answerQuestion(composed, ctx);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
