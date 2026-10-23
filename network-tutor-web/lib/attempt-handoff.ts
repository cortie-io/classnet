import type { ExamStartResponse } from "@/components/exam/exam-runner";

// 문제 풀이는 항상 /exam/[id]에서 한다 — 그래야 새로고침·뒤로 가기·다른 화면에 갔다 오기에도 그 주소에서
// 고른 답 그대로 이어서 풀 수 있다. 시작한 화면이 받은 문제를 여기 잠깐 맡겨 두면 /exam/[id]가 서버에 다시
// 묻지 않고 바로 그린다(같은 탭 안에서만, 한 번 꺼내면 지운다).
const pending = new Map<number, ExamStartResponse>();

export function handOffAttempt(start: ExamStartResponse): string {
  pending.set(start.attemptId, start);
  return `/exam/${start.attemptId}`;
}

export function takeHandedAttempt(attemptId: number): ExamStartResponse | null {
  const start = pending.get(attemptId) ?? null;
  pending.delete(attemptId);
  return start;
}
