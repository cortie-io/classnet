"use client";

import { GraduationCapIcon } from "lucide-react";
import { AdminLink as Link } from "@/components/admin/service-period";
import { useEffect, useState } from "react";
import {
  PageIntro,
  PageLoading,
  PageNotice,
} from "@/components/chat/page-intro";
import { loadJson } from "@/components/load-json";
import { ALL_LESSONS, CURRICULUM, findLesson } from "@/lib/textbook/curriculum";

interface Overview {
  students: {
    userId: number;
    name: string;
    studentId: string | null;
    completed: number;
    read: number;
    lastSlug: string | null;
    lastAt: string | null;
    quizCorrect: number | null;
    quizTotal: number | null;
  }[];
  lessons: { slug: string; completed: number; read: number }[];
}

// 처음부터 배우기 — 학생별 진도와 단원별로 몇 명이 끝냈는지.
export default function AdminLearnPage() {
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => {
    loadJson("/api/admin/learn/progress", setData, {
      onError: () => setData({ students: [], lessons: [] }),
    });
  }, []);

  const total = ALL_LESSONS.length;
  const byLesson = new Map((data?.lessons ?? []).map((l) => [l.slug, l]));
  const studentCount = data?.students.length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        description="학생들이 처음부터 배우기 과정을 어디까지 왔는지, 어느 단원에서 많이 멈추는지 볼 수 있어요."
        icon={GraduationCapIcon}
        title="학습 진도"
      />
      {data === null ? (
        <PageLoading />
      ) : data.students.length === 0 ? (
        <PageNotice icon={GraduationCapIcon} title="아직 학생이 없어요" />
      ) : (
        <>
          <section className="surface overflow-hidden">
            <table className="table w-full text-[13px]">
              <thead className="bg-muted/40 text-left text-[12px] text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">학생</th>
                  <th className="px-4 py-2.5 font-medium">완료</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">
                    최근 단원
                  </th>
                  <th className="px-4 py-2.5 font-medium">확인 문제</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">
                    최근 활동
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {data.students.map((s) => {
                  const last = s.lastSlug ? findLesson(s.lastSlug) : null;
                  return (
                    <tr key={s.userId}>
                      <td className="px-4 py-3">
                        <Link
                          className="font-semibold hover:text-primary"
                          href={`/admin/students/${s.userId}`}
                        >
                          {s.name}
                        </Link>
                        {s.studentId ? (
                          <span className="ml-1.5 text-[12px] text-muted-foreground">
                            {s.studentId}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-brand"
                              style={{
                                width: `${(s.completed / total) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="tabular-nums">
                            {s.completed}/{total}
                          </span>
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                        {last ? `STEP ${last.index + 1} · ${last.title}` : "-"}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {s.quizTotal
                          ? `${Math.round(((s.quizCorrect ?? 0) / s.quizTotal) * 100)}% (${s.quizCorrect}/${s.quizTotal})`
                          : "-"}
                      </td>
                      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                        {s.lastAt
                          ? new Date(s.lastAt).toLocaleString("ko-KR", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })
                          : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="surface p-5">
            <h2 className="font-bold text-[15px]">단원별 완료 인원</h2>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              읽은 사람은 많은데 끝낸 사람이 적은 단원은 학생들이 어려워하는
              곳일 수 있어요.
            </p>
            <div className="mt-4 space-y-5">
              {CURRICULUM.map((part) => (
                <div key={part.id}>
                  <p className="mb-2 font-semibold text-[12.5px] text-primary">
                    {part.label} {part.title}
                  </p>
                  <ul className="space-y-1.5">
                    {part.lessons.map((l) => {
                      const row = byLesson.get(l.slug);
                      const done = row?.completed ?? 0;
                      const read = row?.read ?? 0;
                      return (
                        <li
                          className="flex items-center gap-3 text-[12.5px]"
                          key={l.slug}
                        >
                          <span className="w-56 shrink-0 truncate">
                            {l.title}
                          </span>
                          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="absolute inset-y-0 left-0 rounded-full bg-primary/20"
                              style={{
                                width: `${studentCount ? (read / studentCount) * 100 : 0}%`,
                              }}
                            />
                            <div
                              className="absolute inset-y-0 left-0 rounded-full bg-brand"
                              style={{
                                width: `${studentCount ? (done / studentCount) * 100 : 0}%`,
                              }}
                            />
                          </div>
                          <span className="w-24 shrink-0 text-right text-muted-foreground tabular-nums">
                            완료 {done} · 읽음 {read}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
