import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { LlmError } from "../llm/http.js";

// 학생에게 보이는 오류는 이 몇 가지 코드와 고정 문구뿐이다. 예전에는 /api/ask가 err.message를 그대로
// 돌려줘서 학생 화면에 'fetch failed'가 떴고, 키를 바꾼 뒤 OpenAI 401이 나면 그 응답 본문(키 일부가
// 들어 있다)까지 그대로 나갈 수 있었다. 자세한 원인은 서버 로그와 감사 로그(verification_detail)에만 남긴다.

export type AskErrorCode = "llm_unavailable" | "timeout" | "rate_limited" | "internal";

export const ASK_ERROR_MESSAGES: Record<AskErrorCode, string> = {
  llm_unavailable: "지금 AI 서버에 연결할 수 없어 답변을 만들지 못했어요. 잠시 후 다시 시도해 주세요.",
  timeout: "답변을 만드는 데 시간이 너무 오래 걸려 중단했어요. 잠시 후 다시 시도해 주세요.",
  rate_limited: "지금 질문이 몰려 있어 답변을 만들지 못했어요. 잠시 후 다시 시도해 주세요.",
  internal: "서버 오류로 답변을 만들지 못했어요. 잠시 후 다시 시도해 주세요.",
};

export const ASK_ERROR_STATUS: Record<AskErrorCode, number> = {
  llm_unavailable: 503,
  timeout: 504,
  rate_limited: 429,
  internal: 500,
};

export function askErrorCode(err: unknown): AskErrorCode {
  if (!(err instanceof LlmError)) return "internal";
  switch (err.kind) {
    case "timeout":
    case "aborted":
      return "timeout";
    case "rate_limit":
      return "rate_limited";
    default:
      // auth(키 오류)·bad_request·unavailable·not_configured — 학생이 할 수 있는 일은 같다(잠시 뒤 재시도).
      return "llm_unavailable";
  }
}

/**
 * /api/ask·/api/problem/explain에서 답변 파이프라인 바깥까지 올라온 예외를 학생용 응답으로 바꾼다.
 * 원인은 requestId와 함께 서버 로그에만 남기고, 응답에는 코드·고정 문구·requestId만 담는다.
 */
export function sendAskError(res: Response, err: unknown, route: string): void {
  const requestId = randomUUID();
  const code = askErrorCode(err);
  console.error(`[${route}] requestId=${requestId} code=${code}`, err);
  if (res.headersSent) return;
  res.status(ASK_ERROR_STATUS[code]).json({ error: code, message: ASK_ERROR_MESSAGES[code], requestId });
}
