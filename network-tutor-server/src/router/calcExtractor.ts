import {
  subnetCalculate,
  subnetSplitCalculate,
  classifyIp,
  convertBase,
  shannonCapacity,
  nyquistCapacity,
  type CalcResult,
} from "../rules/calculators.js";

export type CalcKind = "subnet" | "subnet_split" | "ip_class" | "base_convert" | "shannon" | "nyquist";

export interface CalcMatch {
  kind: CalcKind;
  result: CalcResult;
}

const IP_RE = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/;
const CIDR_RE = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s*\/\s*(\d{1,2})\b/;
const MASK_AFTER_RE = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b[^0-9]{0,20}\b(255\.\d{1,3}\.\d{1,3}\.\d{1,3}|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/;
// "4개(의) 서브넷으로 나누면" — "서브넷을 몇 개로 나누는" 유형은 기존 subnetCalculate(주어진 프리픽스
// 자체 정보)로는 답할 수 없어 별도로 감지한다(실측 평가에서 확인된 오분류 — subnet_split 계산기 참고).
const SUBNET_SPLIT_RE = /(\d+)\s*개(?:의)?\s*(?:서브넷)?\s*(?:으로|로)?\s*나누/;

const BASE_WORDS: { re: RegExp; base: 2 | 10 | 16 }[] = [
  { re: /2진수|이진수/, base: 2 },
  { re: /16진수|십육진수|hex/i, base: 16 },
  { re: /10진수|십진수/, base: 10 },
];

/** 규칙 기반 계산 요청 추출. 매칭되지 않으면 null → 설명형/조회형 파이프라인으로 폴백. */
export function extractCalcRequest(question: string): CalcMatch | null {
  const q = question.trim();

  const isSubnetIntent = /서브넷|서브네팅|네트워크\s*주소|브로드캐스트|호스트\s*수|사용\s*가능한?\s*호스트|와일드카드/.test(q);
  const cidrMatch = q.match(CIDR_RE);
  const splitMatch = q.match(SUBNET_SPLIT_RE);
  if (isSubnetIntent && cidrMatch && splitMatch) {
    try {
      return {
        kind: "subnet_split",
        result: subnetSplitCalculate(cidrMatch[1], Number(cidrMatch[2]), Number(splitMatch[1])),
      };
    } catch {
      /* fall through to basic subnet calc below */
    }
  }
  if (isSubnetIntent && cidrMatch) {
    try {
      return { kind: "subnet", result: subnetCalculate(cidrMatch[1], Number(cidrMatch[2])) };
    } catch {
      /* fall through */
    }
  }
  if (isSubnetIntent) {
    const maskMatch = q.match(MASK_AFTER_RE);
    if (maskMatch) {
      try {
        return { kind: "subnet", result: subnetCalculate(maskMatch[1], maskMatch[2]) };
      } catch {
        /* fall through */
      }
    }
  }

  const isClassIntent = /클래스가|클래스는|클래스\s*판별|무슨\s*클래스/.test(q);
  const ipOnly = q.match(IP_RE);
  if (isClassIntent && ipOnly && !cidrMatch) {
    try {
      return { kind: "ip_class", result: classifyIp(ipOnly[1]) };
    } catch {
      /* fall through */
    }
  }

  const isConvertIntent = /진수|변환|바꿔|바꾸/.test(q);
  if (isConvertIntent) {
    const foundBases = BASE_WORDS.filter((b) => b.re.test(q)).map((b) => b.base);
    if (foundBases.length >= 1) {
      // 값 토큰 추출: 진법 단어 앞에 붙는 숫자/16진 문자열 우선 탐색
      const valueMatch = q.match(/([0-9A-Fa-f]{1,32})\s*(?:을|를|은|는)?\s*(?:2진수|이진수|16진수|십육진수|10진수|십진수)/);
      const rawValue = valueMatch?.[1];
      if (rawValue) {
        const targetBase = foundBases.length >= 1 ? foundBases[foundBases.length - 1] : foundBases[0];
        let sourceBase: 2 | 10 | 16;
        if (foundBases.length >= 2) {
          sourceBase = foundBases[0];
        } else if (/^[01]+$/.test(rawValue) && rawValue.length > 1) {
          sourceBase = 2;
        } else if (/[A-Fa-f]/.test(rawValue)) {
          sourceBase = 16;
        } else {
          sourceBase = 10;
        }
        if (sourceBase !== targetBase) {
          try {
            return { kind: "base_convert", result: convertBase(rawValue, sourceBase, targetBase) };
          } catch {
            /* fall through */
          }
        }
      }
    }
  }

  const bwMatch = q.match(/(\d+(?:\.\d+)?)\s*(?:Hz|hz|헤르츠)/);
  if (/섀넌|shannon/i.test(q) && bwMatch) {
    const dbMatch = q.match(/(\d+(?:\.\d+)?)\s*dB/i);
    const ratioMatch = q.match(/(?:S\s*\/\s*N|신호\s*대\s*잡음비)\s*[=:]?\s*(\d+(?:\.\d+)?)/i);
    const bandwidth = Number(bwMatch[1]);
    if (dbMatch) {
      try {
        return { kind: "shannon", result: shannonCapacity(bandwidth, Number(dbMatch[1]), true) };
      } catch {
        /* fall through */
      }
    } else if (ratioMatch) {
      try {
        return { kind: "shannon", result: shannonCapacity(bandwidth, Number(ratioMatch[1]), false) };
      } catch {
        /* fall through */
      }
    }
  }

  if (/나이키스트|nyquist/i.test(q) && bwMatch) {
    const levelMatch = q.match(/(\d+)\s*(?:레벨|level|단계)/i);
    if (levelMatch) {
      try {
        return { kind: "nyquist", result: nyquistCapacity(Number(bwMatch[1]), Number(levelMatch[1])) };
      } catch {
        /* fall through */
      }
    }
  }

  return null;
}
