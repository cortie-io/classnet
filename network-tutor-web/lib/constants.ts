export const isProductionEnvironment = process.env.NODE_ENV === "production";
export const isDevelopmentEnvironment = process.env.NODE_ENV === "development";
export const isTestEnvironment = Boolean(
  process.env.PLAYWRIGHT_TEST_BASE_URL ||
    process.env.PLAYWRIGHT ||
    process.env.CI_PLAYWRIGHT
);

// 첫 화면 추천 질문. kind는 카드 아이콘을 고르는 데만 쓴다(suggested-actions.tsx).
export const suggestions = [
  {
    kind: "subnet",
    label: "서브넷 계산",
    prompt: "192.168.1.10/26 서브넷의 네트워크 주소와 브로드캐스트 주소는?",
  },
  { kind: "binary", label: "진법 변환", prompt: "173을 2진수로 변환해줘" },
  { kind: "port", label: "포트·서비스", prompt: "포트 443은 무슨 서비스야?" },
  { kind: "concept", label: "개념 비교", prompt: "TCP와 UDP의 차이가 뭐야?" },
] as const;
