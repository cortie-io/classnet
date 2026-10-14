import type { RequestHandler } from "express";
import { isClassCode, gradeForClass } from "../../domain/students/classes.js";
import { pool } from "../../infrastructure/db/pool.js";
export const assignStudentClass: RequestHandler = async (req, res) => {
	const { studentIds, classCode } = req.body ?? {};
	if (
		!Array.isArray(studentIds) ||
		!studentIds.length ||
		studentIds.length > 500 ||
		studentIds.some((id) => !Number.isSafeInteger(id) || id < 1) ||
		new Set(studentIds).size !== studentIds.length ||
		(classCode !== null && !isClassCode(classCode))
	) {
		res.status(400).json({ error: "배정할 학생과 반을 확인해 주세요." });
		return;
	}
	const { rows } = await pool.query(
		`WITH targets AS (SELECT id FROM users WHERE role='student' AND id=ANY($1::int[]))
    UPDATE users SET class_code=$2 WHERE id IN (SELECT id FROM targets)
    AND (SELECT count(*) FROM targets)=$3 RETURNING id`,
		[studentIds, classCode, studentIds.length],
	);
	if (rows.length !== studentIds.length) {
		res
			.status(404)
			.json({
				error:
					"선택한 학생 중 존재하지 않는 계정이 있습니다. 반 배정은 변경하지 않았습니다.",
			});
		return;
	}
	res.json({
		ok: true,
		updatedCount: rows.length,
		classCode,
		grade: gradeForClass(classCode),
	});
};
