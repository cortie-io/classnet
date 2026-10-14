import type { RequestHandler } from "express";
import { isClassCode, gradeForClass } from "../../domain/students/classes.js";
import { pool } from "../../infrastructure/db/pool.js";
export const assignStudentClass: RequestHandler = async (req, res) => {
	const { studentIds, classCode } = req.body ?? {};
	if (
		!Array.isArray(studentIds) ||
		!studentIds.length ||
		studentIds.length > 500 ||
		studentIds.some(
			(id) => !Number.isSafeInteger(id) || id < 1 || id > 2147483647,
		) ||
		new Set(studentIds).size !== studentIds.length ||
		(classCode !== null && !isClassCode(classCode))
	) {
		res.status(400).json({ error: "배정할 학생과 반을 확인해 주세요." });
		return;
	}

	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const targets = await client.query(
			"SELECT id FROM users WHERE role='student' AND id=ANY($1::int[]) ORDER BY id FOR UPDATE",
			[studentIds],
		);
		if (targets.rows.length !== studentIds.length) {
			await client.query("ROLLBACK");
			res
				.status(404)
				.json({
					error:
						"선택한 학생 중 존재하지 않는 계정이 있습니다. 반 배정은 변경하지 않았습니다.",
				});
			return;
		}
		const changed = await client.query(
			"UPDATE users SET class_code=$2 WHERE id=ANY($1::int[]) RETURNING id",
			[studentIds, classCode],
		);
		await client.query("COMMIT");
		res.json({
			ok: true,
			updatedCount: changed.rows.length,
			classCode,
			grade: gradeForClass(classCode),
		});
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
};
