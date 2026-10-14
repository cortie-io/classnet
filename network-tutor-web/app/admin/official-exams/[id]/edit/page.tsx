"use client";

import { AwardIcon } from "lucide-react";
import { use, useEffect, useState } from "react";
import {
  OfficialExamForm,
  type OfficialExamFormValues,
  toLocalInput,
} from "@/components/admin/official-exam-form";
import { PageIntro, PageLoading } from "@/components/chat/page-intro";
import { loadJson } from "@/components/load-json";

interface Detail {
  exam: {
    title: string;
    description: string | null;
    scheduled_start: string;
    scheduled_end: string;
    duration_minutes: number;
    max_violations: number;
  };
  questions: { id: number; subject: string; stem: string; status: string }[];
  stats: { participantCount: number };
}

export default function EditOfficialExamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<{
    values: OfficialExamFormValues;
    locked: boolean;
  } | null>(null);
  useEffect(() => {
    loadJson<Detail>(
      `/api/admin/official-exams/${encodeURIComponent(id)}`,
      (d) =>
        setData({
          locked: d.stats.participantCount > 0,
          values: {
            title: d.exam.title,
            description: d.exam.description ?? "",
            scheduledStart: toLocalInput(d.exam.scheduled_start),
            scheduledEnd: toLocalInput(d.exam.scheduled_end),
            durationMinutes: d.exam.duration_minutes,
            maxViolations: d.exam.max_violations,
            questions: d.questions.map((q) => ({
              id: q.id,
              subject: q.subject,
              stem: q.stem,
              status: q.status,
            })),
          },
        })
    );
  }, [id]);
  if (!data) return <PageLoading />;
  return (
    <div className="flex flex-col gap-6">
      <PageIntro icon={AwardIcon} title="시험 설정 수정" />
      <OfficialExamForm
        examId={Number(id)}
        initial={data.values}
        questionsLocked={data.locked}
      />
    </div>
  );
}
