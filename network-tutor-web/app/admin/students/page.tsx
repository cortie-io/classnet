"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/chat/toast";

interface StudentRow {
  id: number;
  role: string;
  student_id: string | null;
  name: string;
  email: string;
  level: string;
  question_count: number;
  verified_count: number;
  last_active_at: string | null;
}

export default function StudentsPage() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ studentId: "", name: "", birthdate: "", email: "", password: "" });
  const [creating, setCreating] = useState(false);
  const [csvResult, setCsvResult] = useState<{ createdCount: number; failedCount: number; failed: { rowNumber: number; message: string }[] } | null>(null);

  const load = () => {
    setLoading(true);
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then(setStudents)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const createStudent = async () => {
    if (!form.name || !form.email || form.password.length < 8) {
      toast({ type: "error", description: "이름, 이메일, 비밀번호(8자 이상)를 입력하세요." });
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "생성 실패");
      toast({ type: "success", description: `${form.name} 계정이 생성되었습니다.` });
      setForm({ studentId: "", name: "", birthdate: "", email: "", password: "" });
      load();
    } catch (err) {
      toast({ type: "error", description: err instanceof Error ? err.message : "오류가 발생했습니다." });
    } finally {
      setCreating(false);
    }
  };

  const uploadCsv = async (file: File) => {
    const csvText = await file.text();
    try {
      const res = await fetch("/api/admin/users/bulk-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "업로드 실패");
      setCsvResult(data);
      load();
    } catch (err) {
      toast({ type: "error", description: err instanceof Error ? err.message : "오류가 발생했습니다." });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-semibold text-xl">학생 관리</h1>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-3 font-medium text-sm">계정 추가</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Input onChange={(e) => setForm({ ...form, studentId: e.target.value })} placeholder="학번" value={form.studentId} />
          <Input onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="이름" value={form.name} />
          <Input onChange={(e) => setForm({ ...form, birthdate: e.target.value })} type="date" value={form.birthdate} />
          <Input onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="학교 이메일" type="email" value={form.email} />
          <Input
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="초기 비밀번호(8자 이상)"
            value={form.password}
          />
          <Button disabled={creating} onClick={createStudent}>
            {creating ? "생성 중..." : "계정 생성"}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-1 font-medium text-sm">CSV 일괄 등록</h2>
        <p className="mb-3 text-muted-foreground text-xs">컬럼: 학번,이름,생년월일,메일,비밀번호 (헤더 필수)</p>
        <input
          accept=".csv,text/csv"
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
                {csvResult.failed.map((f) => `행 ${f.rowNumber}: ${f.message}`).join("\n")}
              </pre>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="border-border border-b text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">학번</th>
              <th className="px-4 py-2 text-left font-medium">이름</th>
              <th className="px-4 py-2 text-left font-medium">이메일</th>
              <th className="px-4 py-2 text-left font-medium">수준</th>
              <th className="px-4 py-2 text-left font-medium">질문 수</th>
              <th className="px-4 py-2 text-left font-medium">최근 활동</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td className="px-4 py-4 text-muted-foreground" colSpan={6}>
                  불러오는 중...
                </td>
              </tr>
            )}
            {!loading && students.length === 0 && (
              <tr>
                <td className="px-4 py-4 text-muted-foreground" colSpan={6}>
                  등록된 학생이 없습니다.
                </td>
              </tr>
            )}
            {students.map((s) => (
              <tr className="border-border border-b last:border-0 hover:bg-accent/40" key={s.id}>
                <td className="px-4 py-2">
                  <Link className="block" href={`/admin/students/${s.id}`}>
                    {s.student_id ?? "-"}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <Link href={`/admin/students/${s.id}`}>
                    {s.name} {s.role === "admin" && <span className="text-muted-foreground text-xs">(관리자)</span>}
                  </Link>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{s.email}</td>
                <td className="px-4 py-2">{s.level}</td>
                <td className="px-4 py-2">{s.question_count}</td>
                <td className="px-4 py-2 text-muted-foreground">
                  {s.last_active_at ? new Date(s.last_active_at).toLocaleString("ko-KR") : "-"}
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
