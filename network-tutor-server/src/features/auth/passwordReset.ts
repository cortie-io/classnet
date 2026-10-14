import { pool } from "../../infrastructure/db/pool.js";

/** Password version and cookie sessions change atomically. JWT readers check this version. */
export async function replacePassword(
	userId: number,
	passwordHash: string,
): Promise<{ id: number; email: string } | null> {
	const { rows } = await pool.query<{ id: number; email: string }>(
		`WITH updated AS (
       UPDATE users SET password_hash=$2, auth_version=auth_version+1 WHERE id=$1 RETURNING id,email
     ), revoked AS (
       DELETE FROM sessions WHERE user_id IN (SELECT id FROM updated)
     ) SELECT id,email FROM updated`,
		[userId, passwordHash],
	);
	return rows[0] ?? null;
}
