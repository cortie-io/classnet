import { consumeLimit, UsageLimitError } from "./limits.js";
import type { NextFunction, Request, Response } from "express";

// 요청 횟수 제한(서버 메모리). 이 서비스는 백엔드 프로세스가 하나뿐이라 메모리로 충분하고, 재시작하면 초기화된다.
// 키는 사용자 id다 — 웹(Next)을 거쳐 오는 요청은 전부 웹 서버 IP로 보이므로 IP로 세면 의미가 없다.
// 보안 감사(2026-10-14)에서 AI 호출 경로에 아무 제한이 없어 학교 OpenAI 예산을 한 학생이 바닥낼 수 있다는
// 지적이 있었다.

export interface Rule {
	windowMs: number;
	max: number;
}

export interface Limiter {
	rules: Rule[];
	/** 이번 요청을 세고, 넘었으면 몇 초 뒤에 다시 하면 되는지 돌려준다. */
	hit(key: string): { ok: true } | { ok: false; retryAfterSec: number };
	reset(key: string): void;
}

const ALL_LIMITERS: Map<string, number[]>[] = [];

export function createLimiter(rules: Rule[]): Limiter {
	const hits = new Map<string, number[]>();
	ALL_LIMITERS.push(hits);
	const longest = Math.max(...rules.map((r) => r.windowMs));
	return {
		rules,
		hit(key) {
			const now = Date.now();
			const list = (hits.get(key) ?? []).filter((t) => now - t < longest);
			for (const r of rules) {
				const inWindow = list.filter((t) => now - t < r.windowMs);
				if (inWindow.length >= r.max) {
					hits.set(key, list);
					return {
						ok: false,
						retryAfterSec: Math.max(
							1,
							Math.ceil((inWindow[0] + r.windowMs - now) / 1000),
						),
					};
				}
			}
			list.push(now);
			hits.set(key, list);
			return { ok: true };
		},
		reset(key) {
			hits.delete(key);
		},
	};
}

// 오래된 기록 정리(메모리가 끝없이 늘지 않게).
setInterval(() => {
	const now = Date.now();
	for (const hits of ALL_LIMITERS) {
		for (const [k, list] of hits) {
			if (list.length === 0 || now - list[list.length - 1] > 24 * 3600_000)
				hits.delete(k);
		}
	}
}, 10 * 60_000).unref();

export function resetAllLimitersForTests(): void {
	for (const hits of ALL_LIMITERS) hits.clear();
}

/** 로그인한 사용자 id 기준 제한 미들웨어. */
export function limitPerUser(limiter: Limiter, message: string) {
	return async (req: Request, res: Response, next: NextFunction) => {
		if (!req.user) return next();
		const name =
			limiter === attemptStartLimiter
				? "attempt-start"
				: limiter === examWriteLimiter
					? "exam-write"
					: limiter === analysisLimiter
						? "analysis"
						: limiter === explainLimiter
							? "explain"
							: "llm";
		try {
			for (const rule of limiter.rules)
				await consumeLimit(
					`user:${req.user.id}:${name}:${rule.windowMs}`,
					rule.max,
					Math.ceil(rule.windowMs / 1000),
				);
			next();
		} catch (error) {
			if (!(error instanceof UsageLimitError)) return next(error);
			res.setHeader("Retry-After", error.retryAfter);
			res
				.status(429)
				.json({
					error: message,
					code: "RATE_LIMITED",
					retryAfterSec: error.retryAfter,
				});
		}
	};
}

/** 한 사용자가 동시에 하나만 — 답을 기다리는 동안 같은 요청을 겹쳐 보내 비용을 몇 배로 쓰는 것을 막는다. */
export function oneInFlightPerUser(message: string) {
	const inFlight = new Set<number>();
	return (req: Request, res: Response, next: NextFunction) => {
		if (!req.user) return next();
		const id = req.user.id;
		if (inFlight.has(id)) {
			res.status(429).json({ error: message, code: "IN_FLIGHT" });
			return;
		}
		inFlight.add(id);
		res.on("close", () => inFlight.delete(id));
		next();
	};
}

// ---------- 서비스 전반에서 쓰는 제한 ----------
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** AI 답변(/ask, /problem/explain): 1분 8회, 1시간 120회, 하루 400회. */
export const llmLimiter = createLimiter([
	{ windowMs: MIN, max: 8 },
	{ windowMs: HOUR, max: 120 },
	{ windowMs: DAY, max: 400 },
]);
/** 학습 리포트 AI 분석 다시 만들기: 10분 1회, 하루 10회. */
export const analysisLimiter = createLimiter([
	{ windowMs: 10 * MIN, max: 1 },
	{ windowMs: DAY, max: 10 },
]);
/** 연습·모의고사·회차 응시 만들기: 1분 20회, 하루 400회(문제은행 정답을 통째로 긁어 가는 것도 늦춘다). */
export const attemptStartLimiter = createLimiter([
	{ windowMs: MIN, max: 20 },
	{ windowMs: DAY, max: 400 },
]);
/** 문제 해설 조회: 1시간 120회, 하루 400회. */
export const explainLimiter = createLimiter([
	{ windowMs: HOUR, max: 120 },
	{ windowMs: DAY, max: 400 },
]);
/** 시험 중 답 저장·감독 신호: 1분 120회. */
export const examWriteLimiter = createLimiter([{ windowMs: MIN, max: 120 }]);
