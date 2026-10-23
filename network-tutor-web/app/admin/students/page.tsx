"use client";
import {
  GroupScopeSelect,
  groupMatches,
} from "@/components/admin/student-groups";
import {
  useAdminPeriod,
  PeriodButton,
} from "@/components/admin/service-period";
import { adminFetch } from "@/lib/admin-period";

import { useEffect, useState } from "react";
import { UsersIcon } from "lucide-react";
import { PageIntro } from "@/components/chat/page-intro";
import { AdminLink as Link } from "@/components/admin/service-period";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/chat/toast";
import { loadJson } from "@/components/load-json";

interface StudentRow {
  id: number;
  role: string;
  student_id: string | null;
  name: string;
  email: string | null;
  level: string;
  class_code?: string | null;
  question_count: number;
  verified_count: number;
  last_active_at: string | null;
}

export default function StudentsPage() {
  const { readOnly, classes } = useAdminPeriod();
  const [scope, setScope] = useState("all");
  const [selected, setSelected] = useState<number[]>([]);
  const [assignment, setAssignment] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    studentId: "",
    name: "",
    birthdate: "",
    email: "",
    password: "",
    classCode: "",
  });
  const [creating, setCreating] = useState(false);
  const [csvResult, setCsvResult] = useState<{
    createdCount: number;
    failedCount: number;
    failed: { rowNumber: number; message: string }[];
  } | null>(null);

  const load = () => {
    setLoading(true);
    loadJson("/api/admin/users", setStudents).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const createStudent = async () => {
    // 학생은 학번으로 로그인하므로 학번이 없으면 만들어도 로그인할 수 없다.
    if (
      !form.studentId.trim() ||
      !form.name ||
      !form.email ||
      form.password.length < 8
    ) {
      toast({
        type: "error",
        description: "학번, 이름, 이메일, 비밀번호(8자 이상)를 입력하세요.",
      });
      return;
    }
    setCreating(true);
    try {
      const res = await adminFetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, classCode: form.classCode || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "생성 실패");
      toast({
        type: "success",
        description: `${form.name} 계정이 생성되었습니다.`,
      });
      setForm({
        studentId: "",
        name: "",
        birthdate: "",
        email: "",
        password: "",
        classCode: "",
      });
      load();
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "오류가 발생했습니다.",
      });
    } finally {
      setCreating(false);
    }
  };

  const uploadCsv = async (file: File) => {
    const csvText = await file.text();
    try {
      const res = await adminFetch("/api/admin/users/bulk-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "업로드 실패");
      setCsvResult(data);
      load();
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "오류가 발생했습니다.",
      });
    }
  };

  const visibleStudents = students.filter(
    (student) =>
      scope === "all" ||
      (student.role === "student" &&
        groupMatches(student.class_code, scope, classes))
  );
  const visibleIds = visibleStudents
    .filter((student) => student.role === "student")
    .map((student) => student.id);
  const assignClass = async () => {
    setAssigning(true);
    try {
      const r = await adminFetch("/api/admin/users/class-assignment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentIds: selected,
          classCode: assignment || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error ?? "반 배정에 실패했어요.");
      toast({
        type: "success",
        description: `${d.updatedCount}명의 반 배정을 저장했어요.`,
      });
      setSelected([]);
      load();
    } catch (e) {
      toast({
        type: "error",
        description: e instanceof Error ? e.message : "반 배정에 실패했어요.",
      });
    } finally {
      setAssigning(false);
    }
  };
  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        description="학생 계정을 만들고, 학생별 학습 현황을 확인해요."
        icon={UsersIcon}
        title="학생 관리"
      />

      <div className="surface p-5">
        <h2 className="mb-3 font-semibold text-[14px]">계정 추가</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Input
            onChange={(e) => setForm({ ...form, studentId: e.target.value })}
            placeholder="학번"
            value={form.studentId}
          />
          <Input
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="이름"
            value={form.name}
          />
          <Input
            onChange={(e) => setForm({ ...form, birthdate: e.target.value })}
            type="date"
            value={form.birthdate}
          />
          <Input
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="학교 이메일"
            type="email"
            value={form.email}
          />
          <Input
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="초기 비밀번호(8자 이상)"
            value={form.password}
          />
          <select
            aria-label="학생 반"
            disabled={readOnly}
            value={form.classCode}
            onChange={(e) => setForm({ ...form, classCode: e.target.value })}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">반 미배정</option>
            {classes.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label} ({c.code})
              </option>
            ))}
          </select>
          <PeriodButton disabled={creating} onClick={createStudent}>
            {creating ? "생성 중..." : "계정 생성"}
          </PeriodButton>
        </div>
      </div>

      <div className="surface p-5">
        <h2 className="mb-1 font-semibold text-[14px]">CSV 일괄 등록</h2>
        <p className="mb-3 text-muted-foreground text-xs">
          필수: 학번,이름,비밀번호 · 선택: 생년월일,학과,반,메일 (헤더 필수 · 메일 열 생략 또는 빈 값 가능 · 반은 선택
          입력)
        </p>
        <input
          accept=".csv,text/csv"
          disabled={readOnly}
          onChange={(e) => e.target.files?.[0] && uploadCsv(e.target.files[0])}
          type="file"
        />
        {csvResult && (
          <div className="mt-3 text-[13px]">
            <p>
              생성 {csvResult.createdCount}건, 실패 {csvResult.failedCount}건
            </p>
            {csvResult.failed.length > 0 && (
              <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-muted/50 p-2 text-xs">
                {csvResult.failed
                  .map((f) => `행 ${f.rowNumber}: ${f.message}`)
                  .join("\n")}
              </pre>
            )}
          </div>
        )}
      </div>

      <GroupScopeSelect
        value={scope}
        onChange={(value) => {
          setScope(value);
          setSelected([]);
        }}
      />
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm">
          <span>선택한 학생 {selected.length}명</span>
          <select
            aria-label="일괄 배정할 반"
            value={assignment}
            onChange={(e) => setAssignment(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2"
          >
            <option value="">미배정으로 변경</option>
            {classes.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label} ({c.code})
              </option>
            ))}
          </select>
          <PeriodButton
            disabled={!selected.length || assigning}
            onClick={() => void assignClass()}
          >
            {assigning ? "저장 중…" : "선택 학생 반 배정"}
          </PeriodButton>
        </div>
      )}
      <div className="surface">
        <div className="overflow-x-auto">
          <table className="table w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-border border-b bg-muted/50 text-[12px] text-muted-foreground">
                {!readOnly && (
                  <th className="px-4 py-2.5">
                    <input
                      aria-label="현재 목록의 학생 전체 선택"
                      type="checkbox"
                      checked={
                        visibleIds.length > 0 &&
                        visibleIds.every((id) => selected.includes(id))
                      }
                      onChange={(e) =>
                        setSelected(e.target.checked ? visibleIds : [])
                      }
                    />
                  </th>
                )}
                <th className="px-4 py-2.5 text-left font-semibold">학번</th>
                <th className="px-4 py-2.5 text-left font-semibold">이름</th>
                {!readOnly && (
                  <th className="px-4 py-2.5 text-left font-semibold">
                    반 · 학년
                  </th>
                )}
                <th className="px-4 py-2.5 text-left font-semibold">이메일</th>
                <th className="px-4 py-2.5 text-left font-semibold">수준</th>
                <th className="px-4 py-2.5 text-left font-semibold">질문 수</th>
                <th className="px-4 py-2.5 text-left font-semibold">
                  최근 활동
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td
                    className="px-4 py-4 text-muted-foreground"
                    colSpan={readOnly ? 6 : 8}
                  >
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && visibleStudents.length === 0 && (
                <tr>
                  <td
                    className="px-4 py-4 text-muted-foreground"
                    colSpan={readOnly ? 6 : 8}
                  >
                    등록된 학생이 없습니다.
                  </td>
                </tr>
              )}
              {visibleStudents.map((s) => (
                <tr
                  className="border-border border-b last:border-0 hover:bg-accent/50"
                  key={s.id}
                >
                  {!readOnly && (
                    <td className="px-4 py-2">
                      {s.role === "student" && (
                        <input
                          type="checkbox"
                          aria-label={`${s.name} 선택`}
                          checked={selected.includes(s.id)}
                          onChange={(e) =>
                            setSelected((current) =>
                              e.target.checked
                                ? [...current, s.id]
                                : current.filter((id) => id !== s.id)
                            )
                          }
                        />
                      )}
                    </td>
                  )}
                  <td className="px-4 py-2">
                    <Link className="block" href={`/admin/students/${s.id}`}>
                      {s.student_id ?? "-"}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <Link href={`/admin/students/${s.id}`}>
                      {s.name}{" "}
                      {s.role === "admin" && (
                        <span className="text-muted-foreground text-xs">
                          (관리자)
                        </span>
                      )}
                    </Link>
                  </td>
                  {!readOnly && (
                    <td className="px-4 py-2">
                      {s.role === "student"
                        ? (classes.find((c) => c.code === s.class_code)
                            ?.label ?? "미배정")
                        : "—"}
                    </td>
                  )}
                  <td className="px-4 py-2 text-muted-foreground">{s.email || "—"}</td>
                  <td className="px-4 py-2">{s.level}</td>
                  <td className="px-4 py-2">{s.question_count}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {s.last_active_at
                      ? new Date(s.last_active_at).toLocaleString("ko-KR")
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
