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

import {
	limitPerUser,
	llmLimiter,
	oneInFlightPerUser,
} from "../../auth/rateLimit.js";

export const problemRouter = Router();

const CHOICE_MARKS = ["①", "②", "③", "④", "⑤"];

problemRouter.post(
	"/problem/explain",
	requireAuth,
	limitPerUser(
		llmLimiter,
		"질문을 너무 자주 보내고 있어요. 잠시 후 다시 시도해 주세요.",
	),
	oneInFlightPerUser(
		"이전 질문의 답을 만드는 중이에요. 답이 나온 뒤에 다시 보내 주세요.",
	),
	async (req, res) => {
		const { stem, choices, extraQuestion, imageBase64, imageMime, useOwnKey } =
			req.body ?? {};
		if (typeof stem !== "string" || stem.trim().length === 0) {
			return res.status(400).json({ error: "stem(문제 지문)이 필요합니다." });
		}
		if (
			stem.length > 3000 ||
			(Array.isArray(choices) &&
				(choices.length > 6 ||
					choices.some((c: unknown) => String(c).length > 500))) ||
			(typeof extraQuestion === "string" && extraQuestion.length > 500) ||
			(typeof imageBase64 === "string" && imageBase64.length > 8000000)
		)
			return res
				.status(400)
				.json({
					error:
						"입력이 너무 깁니다(지문 3000자, 보기 6개·각 500자, 추가 질문 500자, 이미지 약 6MB 이하).",
				});
		const choiceLines =
			Array.isArray(choices) && choices.length > 0
				? choices
						.map(
							(c: unknown, i: number) =>
								`${CHOICE_MARKS[i] ?? `(${i + 1})`} ${String(c)}`,
						)
						.join("\n")
				: "";
		const ask =
			typeof extraQuestion === "string" && extraQuestion.trim()
				? extraQuestion.trim()
				: "이 문제의 정답과 해설을 근거와 함께 알려줘.";

		const composed = [
			"[학생이 직접 입력한 문제]",
			stem.trim(),
			choiceLines,
			"",
			`[요청] ${ask}`,
		]
			.filter(Boolean)
			.join("\n");

		if (useOwnKey === true && !req.user!.hasOpenaiKey) {
			return res.status(400).json({
				error:
					"개인 OpenAI 키가 등록되어 있지 않습니다. 학교 제공 AI를 선택하거나 설정에서 키를 등록해 주세요.",
			});
		}
		try {
			let provider: ProviderChoice = { provider: "default" };
			if (useOwnKey === true && req.user!.hasOpenaiKey) {
				const { rows } = await pool.query<{
					openai_api_key_encrypted: string | null;
				}>("SELECT openai_api_key_encrypted FROM users WHERE id = $1", [
					req.user!.id,
				]);
				const encrypted = rows[0]?.openai_api_key_encrypted;
				if (encrypted)
					provider = {
						provider: "openai",
						openaiApiKey: decryptSecret(encrypted),
					};
			}
			const ctx: RequesterContext = {
				userId: req.user!.id,
				level: req.user!.level,
				provider,
				imageBase64: typeof imageBase64 === "string" ? imageBase64 : undefined,
				imageMime: typeof imageMime === "string" ? imageMime : undefined,
			};
			const result = await answerQuestion(composed, ctx);
			res.json(result);
		} catch (err) {
			sendAskError(res, err, "problem/explain");
		}
	},
);
