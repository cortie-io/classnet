export const STUDENT_CLASSES = [
	{ code: "1-A", grade: 1, label: "1학년 A반" },
	{ code: "1-B", grade: 1, label: "1학년 B반" },
	{ code: "1-C", grade: 1, label: "1학년 C반" },
	{ code: "2", grade: 2, label: "2학년" },
	{ code: "3", grade: 3, label: "3학년" },
	{ code: "4", grade: 4, label: "4학년" },
] as const;
export type ClassCode = (typeof STUDENT_CLASSES)[number]["code"];
export function isClassCode(value: unknown): value is ClassCode {
	return (
		typeof value === "string" && STUDENT_CLASSES.some((c) => c.code === value)
	);
}
export function gradeForClass(value: unknown): number | null {
	return STUDENT_CLASSES.find((c) => c.code === value)?.grade ?? null;
}
export interface RankingScope {
	classCode?: ClassCode | "unassigned";
	grade?: number;
}
export function parseRankingScope(
	query: Record<string, unknown>,
): RankingScope | null {
	if (query.classCode !== undefined && query.grade !== undefined) return null;
	if (query.classCode !== undefined) {
		if (!isClassCode(query.classCode) && query.classCode !== "unassigned")
			return null;
		return { classCode: query.classCode };
	}
	if (query.grade !== undefined) {
		if (typeof query.grade !== "string" || !/^[1-4]$/.test(query.grade))
			return null;
		return { grade: Number(query.grade) };
	}
	return {};
}
