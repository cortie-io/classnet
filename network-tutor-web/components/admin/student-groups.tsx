"use client";
import { useAdminPeriod } from "./service-period";
import type { ClassDefinition } from "@/lib/student-groups";
export { groupMatches, rankingScopeQuery } from "@/lib/student-groups";
export type { ClassDefinition } from "@/lib/student-groups";
export function GroupScopeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { classes, readOnly } = useAdminPeriod();
  if (readOnly) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      조회 범위
      <select
        className="rounded-lg border border-border bg-background px-3 py-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="all">전체 학생</option>
        <optgroup label="반별">
          {classes.map((c) => (
            <option key={c.code} value={"class:" + c.code}>
              {c.label} ({c.code})
            </option>
          ))}
          <option value="class:unassigned">반 미배정</option>
        </optgroup>
        <optgroup label="학년별">
          {[...new Set(classes.map((c) => c.grade))].sort().map((grade) => (
            <option key={grade} value={"grade:" + grade}>
              {grade}학년 전체
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}
