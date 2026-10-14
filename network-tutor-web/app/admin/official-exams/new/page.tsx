"use client";

import { AwardIcon } from "lucide-react";
import {
  OfficialExamForm,
  toLocalInput,
} from "@/components/admin/official-exam-form";
import { PageIntro } from "@/components/chat/page-intro";

export default function NewOfficialExamPage() {
  const start = new Date(Date.now() + 24 * 3600_000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 2 * 3600_000);
  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        description="문항과 응시 기간·제한 시간을 정하고, 확인한 뒤 학생에게 공개하세요."
        icon={AwardIcon}
        title="새 공식 모의시험"
      />
      <OfficialExamForm
        initial={{
          title: "",
          description: "",
          scheduledStart: toLocalInput(start),
          scheduledEnd: toLocalInput(end),
          durationMinutes: 50,
          maxViolations: 3,
          questions: [],
        }}
      />
    </div>
  );
}
