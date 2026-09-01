import { pool } from "./src/db/pool.ts";
import { simulateTokenBurn } from "./src/admin/tokenBurn.ts";

const { rows } = await pool.query<{ name: string }>("SELECT name FROM users WHERE role = 'student' ORDER BY id");
const students = rows.map((row) => row.name).filter(Boolean);

if (students.length === 0) {
  throw new Error("DB에 학생 레코드가 없습니다. 먼저 학생 계정을 생성하세요.");
}

const totalTokensPerRound = 400000;
const rounds = 10; // 기록 수(개별 audit_log row)를 더 빠르게 늘리기 위해 여러 라운드를 연속 실행

const buildLongPrompt = (student: string, basePrompt: string) => {
  const questionBank = [
    "다음 중 TCP/IP에서 IP 주소를 MAC 주소로 변환하는 프로토콜은 무엇이며, 왜 필요한지 설명하라.",
    "IP 주소 10.10.0.12/24의 네트워크 주소, 브로드캐스트 주소, 호스트 범위를 계산하고 각 의미를 설명하라.",
    "VLAN과 서브넷의 차이를 실무 예시와 함께 설명하라.",
    "DHCP와 DNS의 역할을 네트워크 운영 관점에서 비교하고, 실제 네트워크에서 어떤 순서로 동작하는지 설명하라.",
    "OSPF와 RIP의 차이를 비교하고, 대규모 네트워크에서 어떤 프로토콜이 더 적합한지 설명하라.",
    "NAT의 필요성과 동작 원리를 실무 예시와 함께 설명하라.",
    "ICMP와 ARP의 기능 차이를 설명하고, 각 프로토콜이 네트워크 장애 진단에 어떤 도움을 주는지 설명하라.",
    "스위치와 라우터의 차이, 네트워크 구획화 시 어떤 장비를 선택해야 하는지 설명하라.",
  ];

  const selectedQuestion = questionBank[Math.abs(student.length + basePrompt.length) % questionBank.length];
  const repeats = Array.from({ length: 20 }, (_, index) => [
    `네트워크관리사 2급 학습 문맥 ${index + 1}: 시험 문제를 이해 중심으로 풀기 위한 필수 개념 정리`,
    "한국어로 설명하며, 정답 근거, 오답 함정, 실무 적용, 시험 암기 포인트를 모두 포함하라.",
    "TCP/IP, IP 주소, 서브넷, 라우팅, VLAN, DHCP, NAT, ICMP, OSPF, RIP, 스위치, 보안 개념을 통합해 설명하라.",
    "문단은 짧게 유지하되 각 단락마다 이유, 예시, 체크 포인트를 포함하라.",
    "이 요청은 장기 토큰 소모 실험을 위해 의도적으로 상세하고 긴 답변을 요구한다.",
  ].join(" ")); 

  return [
    `학생: ${student}`,
    "시스템 지시: 네트워크관리사 2급 필기문제 기반 학생 질문 누적 실험입니다.",
    `문제: ${selectedQuestion}`,
    ...repeats,
    "요청 본문:",
    basePrompt,
    "추가 조건:",
    "1. 정답을 고르기 전에 기본 개념과 원리를 먼저 설명할 것.",
    "2. 오답의 함정과 어떻게 헷갈릴 수 있는지 함께 제시할 것.",
    "3. 실무적 예시와 시험 포인트를 포함할 것.",
    "4. 최소 3000자 이상, 최대 8000자 수준의 장문으로 작성하라.",
    "5. 네트워크관리사 2급 필기 핵심 개념을 모두 포함하라.",
    "6. 각 항목마다 이유와 사례를 충분히 붙이고, 길이를 늘리도록 작성하라.",
    ...repeats,
  ].join("\n\n");
};

const apiCaller = async (prompt: string, apiKey: string, model: string, maxTokens?: number) => {
  const student = prompt.match(/^(?:학생(?: 이름)?):\s*([^\n]+)/)?.[1]?.trim() ?? "unknown";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.9,
      top_p: 1,
      max_tokens: maxTokens ?? 16384,
      presence_penalty: 0.2,
      frequency_penalty: 0.1,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`openai chat failed: ${response.status} ${text}`);
  }

  const json = (await response.json()) as any;
  const usage = json?.usage ?? {};
  const used = usage.total_tokens ?? json?.total_tokens ?? "unknown";
  console.log(`[${new Date().toISOString()}] student=${student} used=${used} model=${model}`);
  return json;
};

let totalApiCalls = 0;
let totalAuditRows = 0;

for (let round = 1; round <= rounds; round += 1) {
  const result = await simulateTokenBurn(students, totalTokensPerRound, {
    tokensPerTurn: 1500, // 값을 낮춰 라운드당 턴(=audit_log row) 수를 늘림
    concurrency: 12,
    maxTokens: 3072,
    rankMethod: "linear",
    apiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
    apiModel: "gpt-4o",
    requestTimeoutMs: 12000,
    persistToDb: true,
    persistAuditLog: true,
    promptText: [
      "네트워크관리사 2급 필기문제 학습용 질문입니다.",
      "학생은 네트워크 설계, 운영, 보안 및 문제 해결 능력을 검증받고 있으며, 각 문항을 정답 근거와 오답 함정까지 포함해 설명해야 합니다.",
      "문항은 TCP/IP, 서브넷, VLAN, NAT, DHCP, ICMP, RIP, OSPF, 스위치, 라우터, 보안, 라우팅, 패킷 전송, 네트워크 장애 진단 등을 포함합니다.",
      "정확성과 이해를 높이기 위해 장문으로 답하되, 실무적으로 바로 적용 가능한 설명을 덧붙여 주세요.",
      "답변을 길고 자세하게 유지하고, 끝에 핵심 암기 포인트와 주의사항을 함께 정리해 주세요.",
      "다음 문항들을 모두 다루어 주세요:",
      students.join(", "),
      "이 학생들은 네트워크관리사 2급 필기 준비생이므로, 프로토콜 동작 원리와 실무 해석을 함께 설명해야 합니다.",
      "문제를 조건부로 해석하지 말고, 정답 근거, 오답 함정, 실전 적용, 요약을 포함해 주세요.",
      "답변을 매우 장문으로 유지하되, 구조화된 문단과 체크리스트 형태로 작성하시오.",
      "반드시 3000~8000자 이상을 답변으로 작성해 주세요.",
    ].join(" "),
    apiCaller,
  });

  totalApiCalls += result.apiCalls;
  totalAuditRows += result.log.length;

  console.log(
    JSON.stringify({
      round,
      apiCalls: result.apiCalls,
      turnsThisRound: result.log.length,
      totalApiCalls,
      totalAuditRows,
    }),
  );
}

console.log(JSON.stringify({ done: true, rounds, totalApiCalls, totalAuditRows }, null, 2));

await pool.end();

