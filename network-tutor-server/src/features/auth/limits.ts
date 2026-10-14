import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { pool } from "../../infrastructure/db/pool.js";

export class UsageLimitError extends Error {
	constructor(public readonly retryAfter: number) {
		super("요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.");
		this.name = "UsageLimitError";
	}
}

/** PostgreSQL arbitrates concurrent admissions across every application instance. */
export async function consumeLimit(
	key: string,
	maximum: number,
	windowSeconds: number,
): Promise<void> {
	const { rows } = await pool.query<{ admitted: boolean; retry_after: number }>(
		`WITH clock AS (
       SELECT floor(extract(epoch FROM now()) / $3)::bigint AS bucket,
              ($3 - mod(floor(extract(epoch FROM now()))::bigint, $3))::int AS retry_after
     ), admitted AS (
       INSERT INTO request_limits (key, bucket, count)
       SELECT $1, bucket, 1 FROM clock
       ON CONFLICT (key) DO UPDATE
         SET bucket = EXCLUDED.bucket,
             count = CASE WHEN request_limits.bucket = EXCLUDED.bucket THEN request_limits.count + 1 ELSE 1 END
       WHERE request_limits.bucket <> EXCLUDED.bucket OR request_limits.count < $2
       RETURNING key
     ) SELECT EXISTS(SELECT 1 FROM admitted) AS admitted, retry_after FROM clock`,
		[key, maximum, windowSeconds],
	);
	if (!rows[0].admitted) throw new UsageLimitError(rows[0].retry_after);
}

export function loginLimitKey(identifier: string): string {
	return (
		"login:" +
		createHash("sha256").update(identifier.trim().toLowerCase()).digest("hex")
	);
}

export async function consumeLoginLimit(identifier: string): Promise<void> {
	await consumeLimit(loginLimitKey(identifier), 8, 15 * 60);
}

export function requireUsage(
	action: string,
	maximum = 60,
	windowSeconds = 3600,
): RequestHandler {
	return async (req, res, next) => {
		try {
			await consumeLimit(
				`user:${req.user!.id}:${action}`,
				maximum,
				windowSeconds,
			);
			next();
		} catch (err) {
			if (!(err instanceof UsageLimitError)) return next(err);
			res.setHeader("Retry-After", err.retryAfter);
			res.status(429).json({ error: "rate_limited", message: err.message });
		}
	};
}
