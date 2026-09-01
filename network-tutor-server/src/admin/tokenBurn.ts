export type RankMethod = "linear" | "exponential" | "equal";

import { pool } from "../db/pool.js";

export interface TokenBurnOptions {
  tokensPerTurn?: number;
  concurrency?: number;
  maxTokens?: number;
  rankMethod?: RankMethod;
  apiKey?: string;
  apiModel?: string;
  promptText?: string;
  persistToDb?: boolean;
  persistAuditLog?: boolean;
  requestTimeoutMs?: number;
  apiCaller?: (
    prompt: string,
    apiKey: string,
    model: string,
    maxTokens?: number,
  ) => Promise<{ usage?: { total_tokens?: number }; total_tokens?: number } | undefined>;
}

export interface TokenBurnLogEntry {
  turn: number;
  student: string;
  mode: "api" | "dryrun" | "fallback-dryrun";
  used: number;
  remainingTotal?: number;
  studentRemaining?: number;
  responseUsage?: Record<string, unknown>;
  error?: string;
}

export interface TokenBurnAllocationEntry {
  quota: number;
  consumed: number;
  remaining: number;
}

export function computeRankWeights(studentNames: string[], method: RankMethod = "linear"): number[] {
  const n = studentNames.length;

  if (method === "linear") {
    return Array.from({ length: n }, (_, index) => n - index);
  }
  if (method === "exponential") {
    return Array.from({ length: n }, (_, index) => 2 ** (n - index - 1));
  }
  if (method === "equal") {
    return Array.from({ length: n }, () => 1);
  }

  throw new Error(`지원하지 않는 weight method: ${method}`);
}

export function buildNetworkExamQuestionSet(studentName: string, studentCount: number): string {
  const examBank = [
    "네트워크관리사 2급 필기문제: TCP/IP에서 IP 주소를 네트워크 인터페이스 카드의 하드웨어 주소로 변환하는 프로토콜은 무엇이며, 왜 필요한가? 1) ARP 2) ICMP 3) DHCP 4) OSPF를 선택하고 이유와 오답의 함정을 설명하라.",
    "네트워크관리사 2급 필기문제: IP 주소 192.168.10.25/24의 네트워크 주소, 브로드캐스트 주소, 호스트 범위를 계산하고 서브넷 마스크의 의미를 설명하라.",
    "네트워크관리사 2급 필기문제: VLAN을 사용하는 이유와 스위치 포트 기반 네트워크 분할이 보안성과 성능에 미치는 영향을 실무적 관점에서 설명하라.",
    "네트워크관리사 2급 필기문제: NAT의 동작 원리와 사설 IP를 공인 IP로 변환하는 과정에서 발생하는 문제점을 해결하는 방법을 설명하라.",
    "네트워크관리사 2급 필기문제: DHCP 서버가 할당하는 IP, 서브넷 마스크, 기본 게이트웨이, DNS 정보의 역할과 동작 순서를 설명하라.",
    "네트워크관리사 2급 필기문제: OSPF와 RIP의 차이를 비교하고, 대규모 네트워크에서 OSPF가 더 적합한 이유를 설명하라.",
    "네트워크관리사 2급 필기문제: ICMP의 대표적인 메시지(에코 요청/응답, 목적지 도달 불가, 시간 초과)를 이용해 네트워크 장애를 진단하는 절차를 설명하라.",
    "네트워크관리사 2급 필기문제: OSI 7계층과 TCP/IP 4계층을 비교하고 각 계층의 역할과 대표적인 프로토콜을 설명하라.",
    "네트워크관리사 2급 필기문제: 스위치와 라우터의 차이, 각각의 동작 지점, 그리고 네트워크 구획화에 있어 어떤 장비가 적합한지 설명하라.",
    "네트워크관리사 2급 필기문제: 보안 관점에서 ACL, 방화벽, VLAN, NAT가 어떻게 조합되어 네트워크를 보호하는지 사례와 함께 설명하라.",
  ];

  const repeatedBlocks = Array.from({ length: 12 }, (_, index) => [
    `장문 학습 문맥 ${index + 1}: 네트워크관리사 2급 필기에서는 네트워크 장비, 프로토콜, 설계 원칙, 보안 정책, 장애 대응 절차를 종합적으로 이해해야 한다.`,
    "이 문맥은 답변을 길고 상세하게 유지하기 위해, 정답 근거와 오답 함정, 실무적 적용, 시험 포인트를 반복적으로 설명하도록 구성한다.",
    "기본 개념을 확실히 하고, 각 개념을 실제 네트워크 운영 환경과 연결해서 설명해야 한다.",
    "TCP/IP 계층, IP 주소 체계, 서브넷 마스크, 브로드캐스트, 라우팅, NAT, DHCP, VLAN, ICMP, OSPF, RIP, 스위칭, 보안 장비, 장애 진단 절차를 모두 다루어야 한다.",
    "구체적 사례, 실제 운영 상황, 시험에서 자주 헷갈리는 포인트, 요약 체크리스트를 포함해 답변을 충분히 늘린다.",
    "정답을 고르는 기준, 오답을 고르는 이유, 실무에서의 차이를 구분해서 설명하면 이해와 암기가 동시에 이루어진다.",
  ].join(" ")).join("\n\n");

  const selection = examBank.map((question, index) => `${index + 1}. ${question}`).join("\n\n");
  const profile = [
    `학생: ${studentName}`,
    `총 학생 수: ${studentCount}`,
    "시스템 지시: 아래는 네트워크관리사 2급 필기문제 기반 장문 답변 실험입니다.",
    "반드시 한국어로 답하고, 정답 근거, 오답 함정, 실무적 해석, 요약, 암기 포인트를 모두 포함하라.",
    "답변은 상당히 길고 상세하게 작성하라. 3000~8000자 이상을 목표로 하라.",
    "TCP/IP, IP 주소, 서브넷, 라우팅, VLAN, DHCP, NAT, ICMP, OSPF, RIP, 스위치, 보안, 실제 운영 상황을 모두 반영하라.",
    "시험 문제를 단순 나열하지 말고 이해와 사례까지 연결해서 설명하라.",
    "표와 단계형 설명을 적절히 섞어 가독성을 높이되 문단은 짧게 유지하라.",
    "이 문맥은 장기 토큰 소모 실험을 위해 의도적으로 상세한 설명을 요구한다.",
    repeatedBlocks,
    "문제 세트:",
    selection,
    "추가 조건:",
    "1. 정답 선택 이유를 먼저 제시하고 그 다음에 주요 개념과 오답 함정을 설명하라.",
    "2. 각 항목마다 이유, 예시, 실무 적용, 점검 포인트를 포함하라.",
    "3. 마지막에 시험 직전 암기 포인트 5개를 요약하라.",
    "4. 답변은 네트워크관리사 2급 필기시험에 필요한 실전 설명을 중심으로 작성하라.",
    "5. 답변을 매우 길게 유지하되, 의미가 흐려지지 않도록 구조화하여 작성하라.",
    repeatedBlocks,
  ].join("\n\n");

  return profile;
}

export function buildLongBurnPrompt(studentName: string, promptText: string, studentCount: number): string {
  const basePrompt = promptText.trim() || "다음 문제를 네트워크관리사 2급 필기 기준으로 상세히 설명해줘.";
  const extraBlocks = Array.from({ length: 8 }, (_, index) => [
    `추가 보강 문맥 ${index + 1}: 네트워크관리사 2급 문제는 단순 암기가 아니라 원리, 동작 순서, 장비별 역할, 장애 대응 방안까지 종합적으로 이해해야 한다.`,
    "이 문항은 장기 실험을 위해 응답 길이를 의도적으로 늘리기 위한 문맥을 포함한다.",
    "반드시 한국어로, 단계별 설명, 예시, 오답 비교, 요약을 포함해서 실전 답안처럼 작성하라.",
    "답변은 3000~8000자 이상이어야 하며, 네트워크관리사 2급 필기문제 핵심 개념을 모두 포함하라.",
  ].join(" ")).join("\n\n");

  return buildNetworkExamQuestionSet(studentName, studentCount) + "\n\n" + [
    "개별 추가 질문:",
    basePrompt,
    extraBlocks,
    "이 문맥은 네트워크관리사 2급 필기 문제 해결 능력과 장문 응답을 동시에 검증하는 실험이다.",
    "반드시 응답을 길게 유지하고, 네트워크 설계/운영/보안 전반을 모두 포괄해 설명하라.",
    "실제 시험과 동일한 방식으로 정답 근거를 서술하고, 오답 함정까지 함께 설명하라.",
    extraBlocks,
  ].join("\n\n");
}

export function allocateQuotas(
  totalTokens: number,
  studentNames: string[],
  method: RankMethod = "linear",
): Record<string, number> {
  if (totalTokens <= 0) {
    throw new Error("totalTokens는 0보다 커야 합니다.");
  }

  const weights = computeRankWeights(studentNames, method);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const rawAllocations = weights.map((weight) => (totalTokens * weight) / totalWeight);

  const quotas = rawAllocations.map((value) => Math.floor(value));
  let remainder = totalTokens - quotas.reduce((sum, value) => sum + value, 0);

  const fractionalOrder = Array.from(studentNames.keys()).sort(
    (leftIndex, rightIndex) => rawAllocations[rightIndex] - Math.floor(rawAllocations[rightIndex]) - (rawAllocations[leftIndex] - Math.floor(rawAllocations[leftIndex])),
  );

  for (const idx of fractionalOrder.slice(0, remainder)) {
    quotas[idx] += 1;
  }

  return Object.fromEntries(studentNames.map((name, index) => [name, quotas[index]]));
}

async function callOpenAiChat(
  prompt: string,
  apiKey: string,
  model: string,
  apiCaller?: TokenBurnOptions["apiCaller"],
  maxTokens: number = 8192,
  requestTimeoutMs: number = 30000,
): Promise<{ usage?: { total_tokens?: number }; total_tokens?: number } | undefined> {
  if (apiCaller) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`api timeout after ${requestTimeoutMs}ms`)), requestTimeoutMs);
    });

    return Promise.race([
      apiCaller(prompt, apiKey, model, maxTokens),
      timeoutPromise,
    ]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
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
        max_tokens: maxTokens,
        presence_penalty: 0.2,
        frequency_penalty: 0.1,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`openai chat failed: ${response.status} ${await response.text()}`);
    }

    return (await response.json()) as { usage?: { total_tokens?: number }; total_tokens?: number };
  } finally {
    clearTimeout(timeoutId);
  }
}

export class RankedTokenBudget {
  private readonly studentOrder: string[];
  private readonly totalTokens: number;
  private readonly rankMethod: RankMethod;
  private readonly remainingByStudent: Record<string, number>;
  private readonly consumedByStudent: Record<string, number>;
  private remainingTotal: number;

  constructor(studentNames: string[], totalTokens: number, rankMethod: RankMethod = "linear") {
    this.studentOrder = [...studentNames];
    this.totalTokens = totalTokens;
    this.rankMethod = rankMethod;
    this.remainingByStudent = { ...allocateQuotas(totalTokens, studentNames, rankMethod) };
    this.consumedByStudent = Object.fromEntries(studentNames.map((name) => [name, 0]));
    this.remainingTotal = totalTokens;
  }

  consume(studentName: string, usedTokens: number): { studentName: string; used: number; remainingTotal: number; studentRemaining: number } {
    const quota = this.remainingByStudent[studentName] ?? 0;
    const actual = Math.min(Math.max(0, usedTokens), quota, this.remainingTotal);
    if (actual <= 0) {
      return { studentName, used: 0, remainingTotal: this.remainingTotal, studentRemaining: quota };
    }

    this.remainingByStudent[studentName] = Math.max(0, quota - actual);
    this.consumedByStudent[studentName] = (this.consumedByStudent[studentName] ?? 0) + actual;
    this.remainingTotal = Math.max(0, this.remainingTotal - actual);
    return {
      studentName,
      used: actual,
      remainingTotal: this.remainingTotal,
      studentRemaining: this.remainingByStudent[studentName] ?? 0,
    };
  }

  snapshot(): { studentOrder: string[]; totalTokens: number; remainingTotal: number; allocations: Record<string, TokenBurnAllocationEntry> } {
    const allocations = Object.fromEntries(
      this.studentOrder.map((name) => [
        name,
        {
          quota: allocateQuotas(this.totalTokens, this.studentOrder, this.rankMethod)[name] ?? 0,
          consumed: this.consumedByStudent[name] ?? 0,
          remaining: this.remainingByStudent[name] ?? 0,
        },
      ]),
    ) as Record<string, TokenBurnAllocationEntry>;

    return {
      studentOrder: this.studentOrder,
      totalTokens: this.totalTokens,
      remainingTotal: this.remainingTotal,
      allocations,
    };
  }
}

let activeBudget: RankedTokenBudget | null = null;

export function initializeActiveBudget(studentNames: string[], totalTokens: number, rankMethod: RankMethod = "linear") {
  activeBudget = new RankedTokenBudget(studentNames, totalTokens, rankMethod);
  return activeBudget;
}

export function consumeOpenAiBudget(studentName: string, usedTokens: number): { studentName: string; used: number; remainingTotal: number; studentRemaining: number } | null {
  if (!studentName || !activeBudget) {
    return null;
  }
  return activeBudget.consume(studentName, usedTokens);
}

export async function persistStudentTokenBurn(studentName: string, quota: number, used: number): Promise<{
  studentName: string;
  quota: number;
  used: number;
  remaining: number;
}> {
  const safeQuota = Math.max(0, Number.isFinite(quota) ? Math.floor(quota) : 0);
  const safeUsed = Math.max(0, Number.isFinite(used) ? Math.floor(used) : 0);
  const remaining = Math.max(0, safeQuota - safeUsed);

  const { rows } = await pool.query(
    `UPDATE users
     SET token_quota = $1,
         token_used = $2,
         token_remaining = $3,
         last_token_burn_at = now()
     WHERE role = 'student' AND name = $4
     RETURNING id, name, token_quota, token_used, token_remaining, last_token_burn_at`,
    [safeQuota, safeUsed, remaining, studentName],
  );

  if (rows.length === 0) {
    return { studentName, quota: safeQuota, used: safeUsed, remaining };
  }

  return {
    studentName,
    quota: Number(rows[0].token_quota ?? safeQuota),
    used: Number(rows[0].token_used ?? safeUsed),
    remaining: Number(rows[0].token_remaining ?? remaining),
  };
}

export async function persistStudentAuditEntry(studentName: string, promptText: string, finalAnswer: string): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM users WHERE role = 'student' AND name = $1 LIMIT 1`,
    [studentName],
  );

  if (rows.length === 0) return null;

  const { rows: insertRows } = await pool.query<{ id: number }>(
    `INSERT INTO audit_log
      (user_id, question, intent, retrieved_node_ids, rule_engine_trace, llm_raw_answer,
       verification_status, verification_detail, final_answer, confidence)
     VALUES ($1, $2, 'token_burn_test', '{}', NULL, $3, 'verified', '{"source":"token_burn"}', $4, 0.99)
     RETURNING id`,
    [rows[0].id, promptText, promptText, finalAnswer],
  );

  return insertRows[0]?.id ?? null;
}

export async function simulateTokenBurn(
  studentNames: string[],
  totalTokens: number,
  options: TokenBurnOptions = {},
): Promise<{
  studentOrder: string[];
  rankMethod: RankMethod;
  totalTokens: number;
  tokensPerTurn: number;
  allocations: Record<string, TokenBurnAllocationEntry>;
  log: TokenBurnLogEntry[];
  apiCalls: number;
  usingApi: boolean;
}> {
  const {
    tokensPerTurn = 2000,
    concurrency = 1,
    maxTokens = 16384,
    rankMethod = "linear",
    apiKey,
    apiModel = "gpt-4o-mini",
    promptText = "학생의 질문을 자세히 답해줘. 실무적으로 바로 적용 가능한 방식으로 설명하고, 핵심 포인트와 사례를 포함해줘. 장문으로 답변하고, 이유, 절차, 예시, 요약을 모두 포함해줘.",
    persistToDb = false,
    persistAuditLog = false,
    requestTimeoutMs = 30000,
    apiCaller,
  } = options;

  const hasApiKey = typeof apiKey === "string" && apiKey.trim().length > 0;

  if (totalTokens <= 0) {
    throw new Error("totalTokens는 0보다 커야 합니다.");
  }
  if (tokensPerTurn <= 0) {
    throw new Error("tokensPerTurn는 0보다 커야 합니다.");
  }
  if (concurrency <= 0) {
    throw new Error("concurrency는 0보다 커야 합니다.");
  }

  const quotas = allocateQuotas(totalTokens, studentNames, rankMethod);
  const remainingByStudent = { ...quotas };
  const consumedByStudent = Object.fromEntries(studentNames.map((name) => [name, 0]));
  const log: TokenBurnLogEntry[] = [];
  const promptByStudent = new Map<string, string>();

  let roundCounter = 1;
  let remainingTotal = totalTokens;
  let actualApiCalls = 0;

  while (remainingTotal > 0) {
    const readyStudents = studentNames.filter((student) => (remainingByStudent[student] ?? 0) > 0);
    if (readyStudents.length === 0) break;

    const batch: Array<{ student: string; burnAmount: number }> = [];
    let remainingForBatch = remainingTotal;

    for (const student of readyStudents) {
      if (batch.length >= concurrency) break;

      const allocLimit = remainingByStudent[student] ?? 0;
      const burnAmount = Math.min(tokensPerTurn, allocLimit, remainingForBatch);
      if (burnAmount <= 0) continue;

      batch.push({ student, burnAmount });
      remainingForBatch -= burnAmount;
    }

    if (batch.length === 0) break;

    const batchResults = await Promise.all(
      batch.map(async ({ student, burnAmount }) => {
        if (hasApiKey) {
          try {
            const fullPrompt = buildLongBurnPrompt(student, promptText, studentNames.length);
            promptByStudent.set(student, fullPrompt);
            const result = await callOpenAiChat(fullPrompt, apiKey!, apiModel, apiCaller, maxTokens, requestTimeoutMs);
            const usage = result?.usage ?? {};
            let usedTokens = Number(usage.total_tokens ?? result?.total_tokens ?? burnAmount);
            if (!Number.isFinite(usedTokens) || usedTokens <= 0) {
              usedTokens = burnAmount;
            }

            return {
              student,
              mode: "api" as const,
              used: Math.min(usedTokens, burnAmount),
              responseUsage: usage,
              error: undefined,
            };
          } catch (error) {
            promptByStudent.set(student, buildLongBurnPrompt(student, promptText, studentNames.length));
            return {
              student,
              mode: "fallback-dryrun" as const,
              used: burnAmount,
              responseUsage: undefined,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }

        promptByStudent.set(student, buildLongBurnPrompt(student, promptText, studentNames.length));
        return {
          student,
          mode: "dryrun" as const,
          used: burnAmount,
          responseUsage: undefined,
          error: undefined,
        };
      }),
    );

    const persistPromises: Promise<unknown>[] = [];

    for (const result of batchResults) {
      const safeUsed = Math.min(result.used, remainingByStudent[result.student] ?? 0, remainingTotal);
      remainingByStudent[result.student] = Math.max(0, (remainingByStudent[result.student] ?? 0) - safeUsed);
      consumedByStudent[result.student] = (consumedByStudent[result.student] ?? 0) + safeUsed;
      remainingTotal = Math.max(0, remainingTotal - safeUsed);

      if (result.mode === "api" || result.mode === "fallback-dryrun") {
        actualApiCalls += 1;
      }

      const questionText = promptByStudent.get(result.student) ?? buildLongBurnPrompt(result.student, promptText, studentNames.length);
      const finalAnswer = `네트워크관리사 2급 필기문제 기반 토큰 소모 실험 결과: turn=${roundCounter}, used=${safeUsed}, remainingTotal=${remainingTotal}, studentRemaining=${remainingByStudent[result.student] ?? 0}. 학생 질문 로그는 관리자 화면에 누적됩니다.`;

      // 라운드 전체가 끝날 때까지 기다리지 않고 턴마다 즉시 반영 — 그래야 배치가 오래 걸려도
      // 관리자 화면에서 실시간으로 기록 수가 늘어나는 게 보인다(실측: 끝까지 기다리면 수 분간 안 늘어난 것처럼 보임).
      if (persistToDb) {
        persistPromises.push(persistStudentTokenBurn(result.student, quotas[result.student] ?? 0, consumedByStudent[result.student] ?? 0));
        if (persistAuditLog) {
          persistPromises.push(persistStudentAuditEntry(result.student, questionText, finalAnswer));
        }
      }

      log.push({
        turn: roundCounter,
        student: result.student,
        mode: result.mode,
        used: safeUsed,
        remainingTotal,
        studentRemaining: remainingByStudent[result.student],
        responseUsage: result.responseUsage,
        error: result.error,
      });
      roundCounter += 1;
    }

    await Promise.all(persistPromises);
  }

  const allocations = Object.fromEntries(
    studentNames.map((name) => [
      name,
      {
        quota: quotas[name],
        consumed: consumedByStudent[name] ?? 0,
        remaining: remainingByStudent[name] ?? 0,
      },
    ]),
  ) as Record<string, TokenBurnAllocationEntry>;

  return {
    studentOrder: studentNames,
    rankMethod,
    totalTokens,
    tokensPerTurn,
    allocations,
    log,
    apiCalls: actualApiCalls,
    usingApi: Boolean(apiKey),
  };
}
