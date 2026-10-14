import { isClassCode } from "../../domain/students/classes.js";
import type { RequestHandler } from "express";
import { pool } from "../../infrastructure/db/pool.js";

const allowed = new Set([
	"name",
	"studentId",
	"email",
	"birthdate",
	"department",
	"level",
	"classCode",
]);
export const updateStudentProfile: RequestHandler = async (req, res) => {
	const id = Number(req.params.id),
		raw = req.body;
	const body =
		raw && typeof raw === "object" && !Array.isArray(raw)
			? Object.fromEntries(
					Object.entries(raw).filter(([key]) => key !== "userId"),
				)
			: null;
	if (
		!Number.isSafeInteger(id) ||
		id < 1 ||
		!body ||
		typeof body !== "object" ||
		Array.isArray(body) ||
		!Object.keys(body).length ||
		Object.keys(body).some((k) => !allowed.has(k))
	) {
		res.status(400).json({ error: "수정할 학생 정보 항목을 확인해 주세요." });
		return;
	}
	const changes: Record<string, string | null> = {};
	for (const [key, raw] of Object.entries(body)) {
		if (key === "classCode") {
			if (raw !== null && !isClassCode(raw)) {
				res
					.status(400)
					.json({ error: "반은 1-A, 1-B, 1-C, 2, 3, 4 중 선택해 주세요." });
				return;
			}
			changes.class_code = raw as string | null;
			continue;
		}
		if (
			(key === "birthdate" || key === "department") &&
			(raw === null || raw === "")
		) {
			changes[key] = null;
			continue;
		}
		if (typeof raw !== "string") {
			res.status(400).json({ error: "학생 정보의 입력 형식을 확인해 주세요." });
			return;
		}
		const value = raw.trim();
		if (key === "name" && (!value || value.length > 100)) {
			res.status(400).json({ error: "이름은 1~100자로 입력해 주세요." });
			return;
		}
		if (
			key === "studentId" &&
			(!value || value.length > 64 || /\s/.test(value))
		) {
			res
				.status(400)
				.json({ error: "학번은 공백 없이 1~64자로 입력해 주세요." });
			return;
		}
		if (
			key === "email" &&
			(value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
		) {
			res.status(400).json({ error: "이메일 주소를 확인해 주세요." });
			return;
		}
		if (key === "department" && value.length > 120) {
			res.status(400).json({ error: "학과는 120자 이내로 입력해 주세요." });
			return;
		}
		if (
			key === "level" &&
			!["beginner", "intermediate", "advanced"].includes(value)
		) {
			res.status(400).json({ error: "학습 수준을 확인해 주세요." });
			return;
		}
		if (key === "birthdate") {
			const date = new Date(value + "T00:00:00Z");
			if (
				!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
				!Number.isFinite(date.getTime()) ||
				date.toISOString().slice(0, 10) !== value ||
				value > new Date().toISOString().slice(0, 10)
			) {
				res.status(400).json({ error: "올바른 생년월일을 입력해 주세요." });
				return;
			}
		}
		changes[key === "studentId" ? "student_id" : key] =
			key === "email" ? value.toLowerCase() : value || null;
	}
	const values = Object.values(changes);
	const fields = Object.keys(changes).map(
		(key, index) => key + "=$" + (index + 1),
	);
	try {
		const { rows } = await pool.query(
			`WITH changed AS (
      UPDATE users SET ${fields.join(",")},auth_version=auth_version+1
      WHERE id=$${values.length + 1} AND role='student'
      RETURNING id,role,student_id,name,birthdate,department,email,level,class_code,created_at
    ), revoked AS (DELETE FROM sessions WHERE user_id IN (SELECT id FROM changed)) SELECT * FROM changed`,
			[...values, id],
		);
		if (!rows[0]) {
			res.status(404).json({ error: "학생을 찾을 수 없습니다." });
			return;
		}
		res.json({ ok: true, user: rows[0] });
	} catch (error) {
		if ((error as { code?: string }).code === "23505") {
			res.status(409).json({ error: "이미 사용 중인 학번 또는 이메일입니다." });
			return;
		}
		throw error;
	}
};
