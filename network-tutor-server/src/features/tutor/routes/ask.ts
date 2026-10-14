import { Router } from "express";
import { pool } from "../../../infrastructure/db/pool.js";
import {
	answerQuestion,
	type RequesterContext,
} from "../pipeline/answerPipeline.js";
import { requireAuth } from "../../auth/middleware.js";
import { decryptSecret } from "../../auth/crypto.js";
import type { ProviderChoice } from "../../../infrastructure/llm/provider.js";
import { sendAskError } from "../pipeline/askError.js";

import { requireUsage } from "../../auth/limits.js";

export const askRouter = Router();

function parseHistory(raw: unknown): RequesterContext["history"] {
	if (!Array.isArray(raw)) return undefined;
	const turns = raw
		.filter(
			(t): t is { role: string; content: string } =>
				!!t &&
				(t.role === "user" || t.role === "assistant") &&
				typeof t.content === "string" &&
				t.content.trim().length > 0,
		)
		.map((t) => ({ role: t.role as "user" | "assistant", content: t.content }));
	if (turns.length === 0) return undefined;
	// 프롬프트가 무한정 길어지지 않게 최근 6턴(3왕복)까지만 보낸다 — 꼬리질문은 보통 직전 맥락이면 충분하다.
	return turns.slice(-6);
}

async function buildRequesterContext(
	userId: number,
	level: RequesterContext["level"],
	useOwnKey: boolean,
	imageBase64?: string,
	history?: RequesterContext["history"],
	imageMime?: string,
): Promise<RequesterContext> {
	let provider: ProviderChoice = { provider: "default" };
	if (useOwnKey) {
		const { rows } = await pool.query<{
			openai_api_key_encrypted: string | null;
		}>("SELECT openai_api_key_encrypted FROM users WHERE id = $1", [userId]);
		const encrypted = rows[0]?.openai_api_key_encrypted;
		if (encrypted)
			provider = { provider: "openai", openaiApiKey: decryptSecret(encrypted) };
	}
	return { userId, level, provider, imageBase64, imageMime, history };
}

askRouter.post(
	"/ask",
	requireAuth,
	requireUsage("ai-answer"),
	async (req, res) => {
		const { question, imageBase64, imageMime, useOwnKey, history } =
			req.body ?? {};
		if (typeof question !== "string" || question.trim().length === 0) {
			return res.status(400).json({ error: "question(string)이 필요합니다." });
		}
		if (useOwnKey === true && !req.user!.hasOpenaiKey) {
			return res
				.status(400)
				.json({
					error:
						"개인 OpenAI 키가 등록되어 있지 않습니다. 학교 제공 AI를 선택하거나 설정에서 키를 등록해 주세요.",
				});
		}
		try {
			const ctx = await buildRequesterContext(
				req.user!.id,
				req.user!.level,
				useOwnKey === true && req.user!.hasOpenaiKey,
				typeof imageBase64 === "string" ? imageBase64 : undefined,
				parseHistory(history),
				typeof imageMime === "string" ? imageMime : undefined,
			);
			const result = await answerQuestion(question, ctx);
			res.json(result);
		} catch (err) {
			// 예전에는 err.message를 그대로 돌려줘서 학생 화면에 'fetch failed'나 OpenAI 오류 본문이 떴다.
			sendAskError(res, err, "ask");
		}
	},
);
