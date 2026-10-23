// 서버 /api/exam/study-summary 응답(network-tutor-server reviewSchedule.ts getStudySummary)
export interface StudySummary {
  review: {
    dueCount: number;
    waitingCount: number;
    masteredCount: number;
    nextDueAt: string | null;
  };
  streakDays: number;
  studiedToday: boolean;
  todayAnswered: number;
  todayCorrect: number;
  unfinished: {
    attemptId: number;
    title: string;
    kind: string;
    answered: number;
    total: number;
  } | null;
}

export type ReviewState = "due" | "waiting" | "mastered";

/** "오늘", "내일", "3일 뒤" — 한국 날짜 기준 */
export function daysFromToday(iso: string, now = new Date()): string {
  const kst = (d: Date) =>
    Math.floor((d.getTime() + 9 * 3_600_000) / 86_400_000);
  const diff = kst(new Date(iso)) - kst(now);
  if (diff <= 0) {
    return "오늘";
  }
  if (diff === 1) {
    return "내일";
  }
  return `${diff}일 뒤`;
}

/** 응시 제목을 짧게: "기출문제 2024-05-12 회차" → "2024년 5월 12일 기출" */
export function attemptTitle(title: string | null | undefined): string {
  if (!title) {
    return "연습 문제";
  }
  const m = title.match(/^기출문제 (\d{4})-(\d{2})-(\d{2}) 회차$/);
  if (m) {
    return `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일 기출`;
  }
  return title;
}
