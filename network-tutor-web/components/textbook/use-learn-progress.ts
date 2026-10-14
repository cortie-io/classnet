"use client";

import useSWR from "swr";

export interface LessonProgress {
  slug: string;
  firstReadAt: string | null;
  lastReadAt: string | null;
  completedAt: string | null;
  quizCorrect: number | null;
  quizTotal: number | null;
}

export interface LearnProgress {
  lessons: LessonProgress[];
  lastSlug: string | null;
}

const fetcher = async (url: string): Promise<LearnProgress> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error("진도를 불러오지 못했어요.");
  return res.json();
};

/** 처음부터 배우기·교재가 함께 쓰는 진도. 진도를 못 불러와도 교재는 그대로 읽을 수 있어야 해서 오류는 빈 진도로 본다. */
export function useLearnProgress() {
  const { data, mutate, isLoading } = useSWR("/api/learn/progress", fetcher, {
    revalidateOnFocus: false,
  });
  const bySlug = new Map((data?.lessons ?? []).map((l) => [l.slug, l]));
  return { progress: data ?? null, bySlug, mutate, isLoading };
}

export async function recordProgress(
  slug: string,
  action: "read" | "complete",
  attemptId?: number
) {
  const res = await fetch("/api/learn/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, action, attemptId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "기록하지 못했어요.");
  return data as LessonProgress;
}
