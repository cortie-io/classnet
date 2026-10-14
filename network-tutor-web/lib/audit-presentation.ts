const labels: Record<string, string> = {
  pending: "검증 중",
  verified: "자동 확인",
  flagged: "검토 필요",
  cached: "저장된 답변",
  rule_only: "규칙 기반 답변",
};

const descriptions: Record<string, string> = {
  pending: "자동 검증 결과를 기다리고 있습니다.",
  verified: "자동 처리에서 이상이 표시되지 않은 상태입니다. 교사의 검수 완료나 정답 보장을 뜻하지 않습니다.",
  flagged: "자동 검증, 학생 신고 또는 응답 오류로 확인이 필요한 기록입니다.",
  cached: "이전에 저장된 답변을 사용했습니다.",
  rule_only: "계산 규칙이나 문제은행을 이용한 답변입니다.",
};

export function auditStatusLabel(status: string): string {
  return labels[status] ?? status;
}

export function auditStatusDescription(status: string): string {
  return descriptions[status] ?? "";
}

export function displayAuditIntent(intent: string): string {
  return intent === "token_burn_test" ? "" : intent;
}

/** Presentation only: underlying records and the API response remain unchanged. */
export function auditJsonReplacer(key: string, value: unknown): unknown {
  if (key === "synthetic_demo" || key.startsWith("demo_") || (key === "intent" && value === "token_burn_test")) {
    return undefined;
  }
  return value;
}
