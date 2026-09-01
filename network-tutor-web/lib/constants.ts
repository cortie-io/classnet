export const isProductionEnvironment = process.env.NODE_ENV === "production";
export const isDevelopmentEnvironment = process.env.NODE_ENV === "development";
export const isTestEnvironment = Boolean(
  process.env.PLAYWRIGHT_TEST_BASE_URL ||
    process.env.PLAYWRIGHT ||
    process.env.CI_PLAYWRIGHT
);

export const suggestions = [
  "192.168.1.10/26 서브넷의 네트워크 주소와 브로드캐스트 주소는?",
  "173을 2진수로 변환해줘",
  "포트 443은 무슨 서비스야?",
  "TCP와 UDP의 차이가 뭐야?",
];
