"use client";

import { AlertTriangleIcon, ArrowLeftIcon, FileTextIcon } from "lucide-react";
import { AdminLink as Link } from "@/components/admin/service-period";
import { use, useEffect, useState } from "react";
import { PageIntro, PageLoading } from "@/components/chat/page-intro";
import { loadJson } from "@/components/load-json";

interface AttemptDetail {
  student: {
    student_id: string | null;
    name: string;
    department: string | null;
  } | null;
  attempt: {
    status: string;
    score: number | null;
    startedAt: string;
    submittedAt: string | null;
    deadlineAt: string | null;
    flagged: boolean;
  };
  events: {
    event_type: string;
    detail: Record<string, unknown> | null;
    created_at: string;
    violation: boolean;
  }[];
  result: {
    correctCount: number;
    total: number;
    items: {
      questionId: number;
      stem: string;
      choices: string[];
      selectedIndex: number | null;
      correctIndex: number | null;
      answerText: string | null;
      isCorrect: boolean | null;
    }[];
  };
}

const EVENT_LABEL: Record<string, string> = {
  tab_hidden: "다른 탭·앱으로 이동",
  window_blur: "다른 창으로 이동",
  fullscreen_exit: "전체화면 해제",
  multiple_tabs: "여러 탭에서 열기",
  devtools_open: "개발자 도구",
  screenshot_key: "화면 캡처 키",
  heartbeat_gap: "화면 신호 끊김",
  second_device: "다른 기기에서 접속 시도",
  copy: "복사 시도(차단)",
  cut: "잘라내기 시도(차단)",
  paste: "붙여넣기 시도(차단)",
  right_click: "우클릭(차단)",
  print: "인쇄 시도(차단)",
  shortcut: "단축키(차단)",
  fullscreen_unsupported: "전체화면 미지원 기기",
  device_reset: "관리자: 기기 잠금 해제",
  force_submit: "관리자: 강제 제출",
  invalidated: "관리자: 무효 처리",
};

export default function OfficialAttemptPage({
  params,
}: {
  params: Promise<{ id: string; attemptId: string }>;
}) {
  const { id, attemptId } = use(params);
  const [data, setData] = useState<AttemptDetail | null>(null);
  useEffect(() => {
    loadJson(
      `/api/admin/official-exams/${encodeURIComponent(id)}/attempts/${encodeURIComponent(attemptId)}`,
      setData
    );
  }, [id, attemptId]);
  if (!data) return <PageLoading />;
  const violations = data.events.filter((e) => e.violation).length;
  return (
    <div className="flex flex-col gap-6">
      <Link
        className="flex w-fit items-center gap-1 text-[13px] text-muted-foreground hover:text-primary"
        href={`/admin/official-exams/${id}`}
      >
        <ArrowLeftIcon className="size-4" /> 응시 현황으로
      </Link>
      <PageIntro
        description={`${data.student?.student_id ?? ""} ${data.student?.department ?? ""} · 점수 ${data.attempt.score ?? "-"} · 정답 ${data.result.correctCount}/${data.result.total} · 위반 ${violations}회`}
        icon={FileTextIcon}
        title={`${data.student?.name ?? "학생"}의 답안`}
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-3">
          {data.result.items.map((it, i) => (
            <div className="surface p-4 text-[13px]" key={it.questionId}>
              <p className="mb-2 font-semibold">
                <span
                  className={
                    it.isCorrect ? "text-emerald-700" : "text-destructive"
                  }
                >
                  {it.isCorrect ? "○" : "✕"}
                </span>{" "}
                {i + 1}. {it.stem}
              </p>
              <ol className="flex flex-col gap-1">
                {it.choices.map((c, ci) => (
                  <li
                    className={
                      ci === it.correctIndex
                        ? "font-semibold text-emerald-700"
                        : ci === it.selectedIndex
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }
                    key={ci}
                  >
                    {ci + 1}) {c} {ci === it.correctIndex ? "← 정답" : ""}{" "}
                    {ci === it.selectedIndex ? "← 학생 답" : ""}
                  </li>
                ))}
              </ol>
              {it.choices.length === 0 ? (
                <p className="text-muted-foreground">
                  {it.answerText ?? "(미응답)"}
                </p>
              ) : null}
            </div>
          ))}
        </div>
        <div className="surface h-fit p-4">
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-[14px]">
            <AlertTriangleIcon className="size-4 text-destructive" /> 감독 기록
          </h2>
          {data.events.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              기록된 이상 행동이 없어요.
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {data.events.map((e, i) => (
                <li
                  className={`rounded-lg px-3 py-2 text-[12.5px] ${e.violation ? "bg-destructive/8 text-destructive" : "bg-muted/60"}`}
                  key={i}
                >
                  <span className="font-semibold">
                    {EVENT_LABEL[e.event_type] ?? e.event_type}
                  </span>
                  <span className="ml-2 text-[11.5px] opacity-75">
                    {new Date(e.created_at).toLocaleTimeString("ko-KR")}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
