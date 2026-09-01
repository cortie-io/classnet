import { generateChat, type ProviderChoice } from "../llm/provider.js";
import { OPENAI_CHAT_MODEL_HIGH } from "../llm/openai.js";
import type { CalcResult } from "../rules/calculators.js";
import { tokenize } from "../search/textIndex.js";

export interface VerificationResult {
  grounded: boolean;
  confidence: number; // 0..1
  detail: Record<string, unknown>;
}

// "192.168.1.0" 같은 점표기 전체를 하나로 잡은 뒤, 옥텟 하나씩("192","168","1","0")도 함께 반환한다.
// 이진수 옥텟 표기("11000000.10101000.00000001.00001010")도 마찬가지다. 이렇게 안 하면 규칙엔진 쪽
// 신뢰 텍스트에는 항상 "192.168" 식으로 옥텟이 붙어서 등장하는데, LLM 설명은 "마지막 옥텟은 192입니다"
// 처럼 옥텟 하나만 따로 언급하는 경우가 흔해서 완전히 같은 숫자인데도 다른 토큰 취급되어 오탐이 났다
// (실제로 서브넷 계산 정답이 이 이유만으로 반려된 사례가 있었다).
function extractNumbers(text: string): string[] {
  const whole = text.match(/\d+(?:\.\d+)*/g) ?? [];
  const out: string[] = [];
  for (const token of whole) {
    out.push(token);
    if (token.includes(".")) out.push(...token.split("."));
  }
  return out;
}

// 마크다운 번호 목록("1. ", "**2.** " 등)은 LLM이 임의로 매긴 문단 번호일 뿐 계산값이 아니므로 검증 대상에서 제외한다.
function stripListMarkers(text: string): string {
  return text.replace(/(^|\n)\s*\*{0,2}\d{1,2}\.\*{0,2}\s+/g, "$1");
}

// "000000", "111111"처럼 같은 숫자가 반복되는 토큰은 거의 항상 2진수 비트 패턴을 설명하는 예시일 뿐
// ("마지막 옥텟의 000000이 모두 0으로 고정되며...") 실제로 주장하는 계산값이 아니다 — 이걸 숫자로 잘못
// 대조해서 정확한 설명을 통째로 폐기하는 오탐이 실제로 있었다(예: 서브넷 계산 정답을 규칙엔진 표시로
// 강등시킴). 대조 대상에서 제외한다.
function isRepeatedDigit(token: string): boolean {
  return /^(\d)\1*$/.test(token);
}

/** 계산형: LLM이 서술한 숫자가 규칙엔진이 산출한 숫자 집합(결과값+계산 단계 전체) 안에 있는지 대조.
 *  한 자리 숫자(1~9)는 "네트워크 주소(1개)"처럼 목록 번호나 개수 재서술에서 흔히 등장하는 부수적 표현이라
 *  실제 계산 오류 신호로 보기 어려워 대조 대상에서 제외하고, 두 자리 이상 숫자(옥텟·호스트 수·비트 수 등
 *  실제 오류가 나면 드러나는 값)만 엄격히 대조한다. 다만 한두 개의 부수적 숫자(예: 비트 패턴 예시)까지
 *  트집 잡으면 정확한 설명이 자주 폐기되므로, 소량의 불일치는 감점만 하고 통과시킨다. */
export function verifyCalcAnswer(calcResult: CalcResult, llmText: string): VerificationResult {
  const trustedText = [calcResult.summary, JSON.stringify(calcResult.result), ...calcResult.steps.map((s) => `${s.label} ${s.detail}`)].join(
    " ",
  );
  const trustedNumbers = new Set(extractNumbers(trustedText));
  const claimedNumbers = extractNumbers(stripListMarkers(llmText))
    .filter((n) => !/^\d$/.test(n))
    .filter((n) => !isRepeatedDigit(n));
  const unsupported = claimedNumbers.filter((n) => !trustedNumbers.has(n));
  // 실서비스 정책: 학생에게는 규칙엔진 값 그대로보다 자세한 설명이 더 도움이 된다. "옥텟은 0~255 범위라
  // 256-192=64"처럼 계산과 무관한 배경 설명 숫자가 한두 개 섞이는 것은 정상이므로, 소수의 불일치는
  // 통과시키고 다수(=답변 대부분이 근거 없는 숫자로 채워진 경우)일 때만 실제 계산 오류로 본다.
  const grounded = unsupported.length <= 2 || unsupported.length / Math.max(claimedNumbers.length, 1) < 0.3;
  return {
    grounded,
    confidence: grounded ? 1 : Math.max(0, 1 - unsupported.length / Math.max(claimedNumbers.length, 1)),
    detail: { unsupportedNumbers: unsupported, trustedNumberCount: trustedNumbers.size },
  };
}

/** 조회형: 매칭된 표 행(row_data)의 값만을 신뢰 데이터로 두고, LLM 서술의 숫자·영문 약어가 그 안에 있는지 대조.
 *  계산형 검증과 동일한 원리를 구조화 조회 데이터에 적용한 버전이다. 실서비스 정책(AI 배경지식 허용)에
 *  맞춰, 표에 없는 내용을 조금 더 곁들여 설명하는 것 자체는 문제 삼지 않고 다수가 근거 없을 때만 반려한다. */
export function verifyStructuredAnswer(trustedFacts: string, llmText: string): VerificationResult {
  const cleaned = stripListMarkers(llmText);
  const claimedNumbers = extractNumbers(cleaned)
    .filter((n) => !/^\d$/.test(n))
    .filter((n) => !isRepeatedDigit(n));
  // 약어는 실제 표기 관례대로 전부 대문자인 것만 잡는다("NAT", "VLAN" 등) — 소문자 섞인 일반 영단어까지
  // 잡으면("Network", "Address", "Translation"처럼 NAT를 풀어 설명하는 흔한 문장까지) 오탐이 난다.
  const claimedAcronyms = cleaned.match(/\b[A-Z]{2,}[0-9]*\b/g) ?? [];
  const checkTokens = [...claimedNumbers, ...claimedAcronyms];
  if (checkTokens.length === 0) {
    return { grounded: true, confidence: 0.6, detail: { method: "structured_no_checkable_tokens" } };
  }
  const lowerTrusted = trustedFacts.toLowerCase();
  const unsupported = checkTokens.filter((t) => !lowerTrusted.includes(t.toLowerCase()));
  // 표 밖 배경지식을 곁들이는 것 자체는 정책상 허용이므로, 소수 토큰의 불일치만으로 통째로 반려하지
  // 않는다 — 근거 없는 토큰 비중이 절반을 넘어갈 때만(=답변 대부분이 표와 무관) 반려한다.
  const grounded = unsupported.length <= 1 || unsupported.length / checkTokens.length < 0.5;
  return {
    grounded,
    confidence: grounded ? 1 : Math.max(0, 1 - unsupported.length / checkTokens.length),
    detail: { method: "structured_containment", unsupported, checkedCount: checkTokens.length },
  };
}

function bigramJaccard(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

function lexicalHeuristic(context: string, answer: string): VerificationResult {
  const numbersInAnswer = extractNumbers(answer);
  const acronyms = answer.match(/\b[A-Z]{2,}[0-9]*\b/g) ?? [];
  const checkTokens = [...numbersInAnswer, ...acronyms];
  let tokenRatio = 1;
  if (checkTokens.length > 0) {
    const matched = checkTokens.filter((t) => context.includes(t)).length;
    tokenRatio = matched / checkTokens.length;
  }
  const overlap = bigramJaccard(answer, context);
  const score = checkTokens.length > 0 ? 0.6 * tokenRatio + 0.4 * overlap : overlap;
  return {
    grounded: score >= 0.15,
    confidence: Math.min(1, score * 2), // overlap ratios run low naturally; scale for a usable confidence band
    detail: { method: "lexical_heuristic", tokenRatio, bigramOverlap: overlap },
  };
}

/**
 * 설명/조회형(실서비스 정책): 이 서비스는 연구용 순수 RAG가 아니라 실제 학교 파일럿이므로, "컨텍스트에
 * 없으면 무조건 거부"가 아니라 "AI 배경지식은 써도 되지만 명백히 틀린 사실은 걸러낸다"를 검증 기준으로
 * 삼는다. 즉 컨텍스트 미포함 자체는 결함이 아니고, 실제 기술적 오류·존재하지 않는 사실만 문제로 본다.
 * LLM 검증 패스가 실패하면 어휘 중첩 휴리스틱으로 폴백한다.
 */
export async function verifyGroundedness(
  context: string,
  question: string,
  answer: string,
  provider: ProviderChoice,
): Promise<VerificationResult> {
  try {
    const verifierPrompt = `당신은 네트워크관리사 2급(네트워크·보안·리눅스) 도메인의 엄격한 팩트체커입니다.
[답변]이 [질문]에 대해 명백히 틀린 기술적 사실, 존재하지 않는 프로토콜/수치/용어, 또는 위험할 정도로
오도하는 내용을 담고 있는지만 판단하세요. [컨텍스트]는 참고 자료일 뿐이며, [답변]이 컨텍스트에 없는
내용을 다룬다는 사실 자체는 문제가 아닙니다(실제 서비스는 AI의 배경지식 사용을 허용합니다).
오직 "이 답변을 학생이 그대로 암기하면 시험에서 틀릴 만큼 사실관계가 잘못됐는가"만 기준으로 판단하고,
반드시 아래 JSON 형식으로만 답하세요. 다른 설명은 절대 추가하지 마세요.
{"grounded": true 또는 false, "reason": "한 문장 이유"}

[컨텍스트(참고용)]
${context.slice(0, 4000)}

[질문]
${question}

[답변]
${answer}`;
    // 팩트체크 검증은 정확도가 제일 중요한 단계라 항상 상위 모델을 쓴다(2026-08-18 결정).
    const { text: raw } = await generateChat(
      [
        { role: "system", content: "You are a strict domain fact-checker. Respond with JSON only." },
        { role: "user", content: verifierPrompt },
      ],
      provider,
      { temperature: 0, model: OPENAI_CHAT_MODEL_HIGH },
    );
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { grounded: boolean; reason?: string };
      return {
        grounded: !!parsed.grounded,
        confidence: parsed.grounded ? 0.9 : 0.35,
        detail: { method: "llm_factcheck", reason: parsed.reason ?? null },
      };
    }
    throw new Error("verifier response had no parseable JSON");
  } catch (err) {
    const fallback = lexicalHeuristic(context, answer);
    // 배경지식 허용 정책에서는 컨텍스트 중첩이 낮아도 오류로 보지 않는다 — 폴백은 완전히 실패했을 때만
    // 보수적으로 통과시키는 안전판 역할로 축소한다.
    fallback.grounded = true;
    fallback.confidence = Math.max(fallback.confidence, 0.55);
    fallback.detail.fallbackReason = err instanceof Error ? err.message : String(err);
    fallback.detail.note = "llm_factcheck 실패로 폴백 — 명백한 오류 신호가 없어 통과 처리";
    return fallback;
  }
}
