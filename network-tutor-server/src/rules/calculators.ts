import { ipToInt, intToIp, toBinaryOctets, prefixToMaskInt, maskToPrefix, parseOctets } from "./ip.js";

export interface CalcStep {
  label: string;
  detail: string;
}

export interface CalcResult {
  summary: string;
  result: Record<string, string | number>;
  steps: CalcStep[];
}

// ---------- 서브넷 계산기 ----------
export function subnetCalculate(ip: string, prefixInput: number | string): CalcResult {
  const prefix = typeof prefixInput === "string" ? maskToPrefix(prefixInput) : prefixInput;
  const ipInt = ipToInt(ip);
  const maskInt = prefixToMaskInt(prefix);
  const networkInt = (ipInt & maskInt) >>> 0;
  const wildcardInt = (~maskInt) >>> 0;
  const broadcastInt = (networkInt | wildcardInt) >>> 0;
  const hostBits = 32 - prefix;
  const totalAddresses = 2 ** hostBits;

  let usableFirst: string;
  let usableLast: string;
  let usableCount: number;
  if (prefix === 32) {
    usableFirst = intToIp(networkInt);
    usableLast = intToIp(networkInt);
    usableCount = 1;
  } else if (prefix === 31) {
    // RFC 3021: point-to-point link, both addresses usable
    usableFirst = intToIp(networkInt);
    usableLast = intToIp(broadcastInt);
    usableCount = 2;
  } else {
    usableFirst = intToIp((networkInt + 1) >>> 0);
    usableLast = intToIp((broadcastInt - 1) >>> 0);
    usableCount = totalAddresses - 2;
  }

  const steps: CalcStep[] = [
    { label: "1. 입력값 확인", detail: `IP = ${ip}, 프리픽스 = /${prefix} (서브넷 마스크 ${intToIp(maskInt)})` },
    { label: "2. 이진수 변환", detail: `IP = ${toBinaryOctets(ipInt)}\n마스크 = ${toBinaryOctets(maskInt)}` },
    {
      label: "3. 네트워크 주소 = IP AND 마스크",
      detail: `${toBinaryOctets(ipInt)}\nAND ${toBinaryOctets(maskInt)}\n= ${toBinaryOctets(networkInt)} (${intToIp(networkInt)})`,
    },
    {
      label: "4. 와일드카드(역마스크) = NOT 마스크",
      detail: `NOT ${toBinaryOctets(maskInt)} = ${toBinaryOctets(wildcardInt)} (${intToIp(wildcardInt)})`,
    },
    {
      label: "5. 브로드캐스트 주소 = 네트워크 OR 와일드카드",
      detail: `${toBinaryOctets(networkInt)}\nOR  ${toBinaryOctets(wildcardInt)}\n= ${toBinaryOctets(broadcastInt)} (${intToIp(broadcastInt)})`,
    },
    {
      label: "6. 호스트 비트 수 및 사용 가능 호스트 수",
      detail: `호스트 비트 = 32 - ${prefix} = ${hostBits}bit → 전체 주소 2^${hostBits} = ${totalAddresses}개` +
        (prefix <= 30
          ? ` → 네트워크·브로드캐스트 2개 제외 = ${usableCount}개`
          : prefix === 31
            ? ` → RFC 3021에 의해 point-to-point 링크는 2개 모두 사용 가능`
            : ` → /32는 호스트 1개(해당 주소 자체)`),
    },
  ];

  return {
    summary: `${ip}/${prefix} → 네트워크 ${intToIp(networkInt)}, 브로드캐스트 ${intToIp(broadcastInt)}, 사용 가능 호스트 ${usableFirst}~${usableLast} (${usableCount}개)`,
    result: {
      입력IP: ip,
      프리픽스: `/${prefix}`,
      서브넷마스크: intToIp(maskInt),
      와일드카드마스크: intToIp(wildcardInt),
      네트워크주소: intToIp(networkInt),
      브로드캐스트주소: intToIp(broadcastInt),
      사용가능호스트범위: `${usableFirst} ~ ${usableLast}`,
      사용가능호스트수: usableCount,
    },
    steps,
  };
}

// ---------- 서브넷 분할 계산기 (네트워크를 N개의 서브넷으로 나누기) ----------
// "192.168.1.0/24를 4개의 서브넷으로 나누면?" 같은 질문은 기존 subnetCalculate(주어진 프리픽스 그 자체의
// 정보)로는 답할 수 없다 — 실측 평가에서 이 유형의 계산 요청이 subnetCalculate로 잘못 매칭돼, LLM이
// 스스로 올바르게 확장 계산(새 프리픽스·마스크·서브넷별 범위)을 해내도 그 숫자들이 규칙엔진 결과에
// 없다는 이유로 "근거 없음"으로 판정돼 해설 없는 rule_only로 강등되는 문제가 확인됐다. 이 계산 자체를
// 규칙엔진이 직접 수행하도록 전용 계산기를 추가한다.
export function subnetSplitCalculate(ip: string, originalPrefix: number, subnetCount: number): CalcResult {
  if (subnetCount < 2) throw new Error("서브넷 개수는 2개 이상이어야 합니다.");
  const additionalBits = Math.ceil(Math.log2(subnetCount));
  const newPrefix = originalPrefix + additionalBits;
  if (newPrefix > 30) {
    throw new Error(`/${originalPrefix}을(를) ${subnetCount}개로 나누면 /${newPrefix}이 되어 호스트를 위한 비트가 부족합니다.`);
  }

  const ipInt = ipToInt(ip);
  const originalMaskInt = prefixToMaskInt(originalPrefix);
  const originalNetworkInt = (ipInt & originalMaskInt) >>> 0;
  const newMaskInt = prefixToMaskInt(newPrefix);
  const hostBits = 32 - newPrefix;
  const subnetSize = 2 ** hostBits;
  const usableCount = Math.max(0, subnetSize - 2);

  const subnets = Array.from({ length: subnetCount }, (_, i) => {
    const networkInt = (originalNetworkInt + i * subnetSize) >>> 0;
    const broadcastInt = (networkInt + subnetSize - 1) >>> 0;
    return {
      index: i + 1,
      network: intToIp(networkInt),
      broadcast: intToIp(broadcastInt),
      usableFirst: intToIp((networkInt + 1) >>> 0),
      usableLast: intToIp((broadcastInt - 1) >>> 0),
    };
  });

  const steps: CalcStep[] = [
    {
      label: "1. 필요한 추가 비트 수 계산",
      detail: `${subnetCount}개로 나누려면 2^n ≥ ${subnetCount}을 만족하는 최소 n이 필요 → n = ${additionalBits}bit`,
    },
    {
      label: "2. 새 프리픽스·서브넷 마스크",
      detail: `/${originalPrefix} + ${additionalBits}bit = /${newPrefix} (서브넷 마스크 ${intToIp(newMaskInt)})`,
    },
    {
      label: "3. 서브넷당 주소 수",
      detail: `호스트 비트 = 32 - ${newPrefix} = ${hostBits}bit → 2^${hostBits} = ${subnetSize}개 (사용 가능 호스트 ${usableCount}개)`,
    },
    {
      label: "4. 서브넷별 범위",
      detail: subnets
        .map((s) => `${s.index}번: ${s.network}/${newPrefix} (브로드캐스트 ${s.broadcast}, 사용 가능 ${s.usableFirst}~${s.usableLast})`)
        .join("\n"),
    },
  ];

  return {
    summary: `${ip}/${originalPrefix}을(를) ${subnetCount}개 서브넷으로 나누면 → /${newPrefix} (서브넷 마스크 ${intToIp(newMaskInt)}), 서브넷당 사용 가능 호스트 ${usableCount}개`,
    result: {
      원본프리픽스: `/${originalPrefix}`,
      서브넷개수: subnetCount,
      새프리픽스: `/${newPrefix}`,
      새서브넷마스크: intToIp(newMaskInt),
      서브넷당사용가능호스트수: usableCount,
      첫번째서브넷: `${subnets[0].network}/${newPrefix}`,
      마지막서브넷: `${subnets.at(-1)!.network}/${newPrefix}`,
    },
    steps,
  };
}

// ---------- IP 클래스 판별 (표준 범위, 정규화_참조데이터 2.6 기준) ----------
export function classifyIp(ip: string): CalcResult {
  const [first] = parseOctets(ip);
  let cls: string;
  let defaultMask: string;
  let note = "";
  if (first === 0) {
    cls = "A(예약)";
    defaultMask = "255.0.0.0";
    note = "0으로 시작하는 주소는 '이 네트워크'를 가리키는 예약 주소입니다.";
  } else if (first === 127) {
    cls = "A(예약)";
    defaultMask = "255.0.0.0";
    note = "127.x.x.x는 루프백(loopback) 예약 대역입니다.";
  } else if (first >= 1 && first <= 126) {
    cls = "A";
    defaultMask = "255.0.0.0";
  } else if (first >= 128 && first <= 191) {
    cls = "B";
    defaultMask = "255.255.0.0";
  } else if (first >= 192 && first <= 223) {
    cls = "C";
    defaultMask = "255.255.255.0";
  } else if (first >= 224 && first <= 239) {
    cls = "D";
    defaultMask = "해당없음(멀티캐스트 전용)";
  } else {
    cls = "E";
    defaultMask = "해당없음(실험/예약용)";
  }

  const steps: CalcStep[] = [
    { label: "1. 첫 옥텟 확인", detail: `${ip}의 첫 옥텟 = ${first}` },
    {
      label: "2. 클래스 범위 대조",
      detail: "A: 1~126, B: 128~191, C: 192~223, D: 224~239, E: 240~255 (0, 127은 예약)",
    },
    { label: "3. 판정", detail: `${first} → Class ${cls}${note ? ` (${note})` : ""}` },
  ];

  return {
    summary: `${ip} → Class ${cls}, 기본 서브넷 마스크 ${defaultMask}`,
    result: { 입력IP: ip, 클래스: cls, 기본서브넷마스크: defaultMask, ...(note ? { 비고: note } : {}) },
    steps,
  };
}

// ---------- 진법 변환 ----------
const HEX_DIGITS = "0123456789ABCDEF";

export function convertBase(value: string, from: 2 | 10 | 16, to: 2 | 10 | 16): CalcResult {
  const clean = value.trim().toUpperCase().replace(/^0X/, "");
  let decimalValue: number;
  const steps: CalcStep[] = [];

  if (from === 10) {
    if (!/^\d+$/.test(clean)) throw new Error(`10진수 형식이 아닙니다: ${value}`);
    decimalValue = Number(clean);
    steps.push({ label: "1. 입력", detail: `10진수 ${decimalValue}` });
  } else if (from === 2) {
    if (!/^[01]+$/.test(clean)) throw new Error(`2진수 형식이 아닙니다(0,1만 허용): ${value}`);
    decimalValue = parseInt(clean, 2);
    const terms = clean
      .split("")
      .reverse()
      .map((bit, i) => `${bit}×2^${i}(${2 ** i})`)
      .reverse()
      .join(" + ");
    steps.push({ label: "1. 자릿값 전개", detail: `${clean} = ${terms} = ${decimalValue}(10진수)` });
  } else {
    if (!/^[0-9A-F]+$/.test(clean)) throw new Error(`16진수 형식이 아닙니다: ${value}`);
    decimalValue = parseInt(clean, 16);
    const terms = clean
      .split("")
      .reverse()
      .map((d, i) => `${d}(${parseInt(d, 16)})×16^${i}(${16 ** i})`)
      .reverse()
      .join(" + ");
    steps.push({ label: "1. 자릿값 전개", detail: `${clean} = ${terms} = ${decimalValue}(10진수)` });
  }

  let outputStr: string;
  if (to === 10) {
    outputStr = String(decimalValue);
    if (from !== 10) steps.push({ label: "2. 결과", detail: `10진수 = ${outputStr}` });
  } else if (to === 2) {
    const divSteps: string[] = [];
    let n = decimalValue;
    if (n === 0) divSteps.push("0 ÷ 2 = 0 나머지 0");
    while (n > 0) {
      const rem = n % 2;
      const q = Math.floor(n / 2);
      divSteps.push(`${n} ÷ 2 = ${q} 나머지 ${rem}`);
      n = q;
    }
    outputStr = decimalValue.toString(2);
    steps.push({
      label: "2. 2로 나눈 나머지를 역순으로",
      detail: `${divSteps.join("\n")}\n나머지를 아래에서 위로 읽으면 → ${outputStr}`,
    });
  } else {
    const divSteps: string[] = [];
    let n = decimalValue;
    if (n === 0) divSteps.push("0 ÷ 16 = 0 나머지 0");
    while (n > 0) {
      const rem = n % 16;
      const q = Math.floor(n / 16);
      divSteps.push(`${n} ÷ 16 = ${q} 나머지 ${rem}(${HEX_DIGITS[rem]})`);
      n = q;
    }
    outputStr = decimalValue.toString(16).toUpperCase();
    steps.push({
      label: "2. 16으로 나눈 나머지를 역순으로",
      detail: `${divSteps.join("\n")}\n나머지를 아래에서 위로 읽으면 → ${outputStr}`,
    });
  }

  const baseLabel = { 2: "2진수", 10: "10진수", 16: "16진수" } as const;
  return {
    summary: `${baseLabel[from]} ${clean} = ${baseLabel[to]} ${outputStr}`,
    result: { 입력값: clean, 입력진법: baseLabel[from], 결과값: outputStr, 결과진법: baseLabel[to] },
    steps,
  };
}

// ---------- 채널 용량 계산 (섀넌/나이키스트) ----------
export function shannonCapacity(bandwidthHz: number, snr: number, snrIsDb = false): CalcResult {
  const steps: CalcStep[] = [];
  let ratio = snr;
  if (snrIsDb) {
    ratio = 10 ** (snr / 10);
    steps.push({ label: "1. dB → 비율 변환", detail: `S/N(dB) = ${snr} → 비율 = 10^(${snr}/10) = ${ratio.toFixed(4)}` });
  } else {
    steps.push({ label: "1. 신호 대 잡음비(S/N)", detail: `S/N = ${ratio}` });
  }
  const inner = 1 + ratio;
  const log2Inner = Math.log2(inner);
  const capacity = bandwidthHz * log2Inner;
  steps.push({ label: "2. 1 + S/N 계산", detail: `1 + ${ratio.toFixed(4)} = ${inner.toFixed(4)}` });
  steps.push({ label: "3. log₂(1+S/N)", detail: `log₂(${inner.toFixed(4)}) = ${log2Inner.toFixed(4)}` });
  steps.push({
    label: "4. C = W · log₂(1+S/N)",
    detail: `${bandwidthHz} × ${log2Inner.toFixed(4)} = ${capacity.toFixed(2)} bps`,
  });
  return {
    summary: `섀넌 정리: 대역폭 ${bandwidthHz}Hz, S/N ${snrIsDb ? snr + "dB" : ratio} → 채널 용량 ≈ ${capacity.toFixed(2)} bps`,
    result: { 대역폭Hz: bandwidthHz, 신호대잡음비: snrIsDb ? `${snr}dB` : ratio, 채널용량bps: Number(capacity.toFixed(2)) },
    steps,
  };
}

export function nyquistCapacity(bandwidthHz: number, levels: number): CalcResult {
  const log2Levels = Math.log2(levels);
  const capacity = 2 * bandwidthHz * log2Levels;
  const steps: CalcStep[] = [
    { label: "1. 신호 레벨 수(B)", detail: `B = ${levels}` },
    { label: "2. log₂(B)", detail: `log₂(${levels}) = ${log2Levels.toFixed(4)}` },
    { label: "3. C = 2W·log₂(B)", detail: `2 × ${bandwidthHz} × ${log2Levels.toFixed(4)} = ${capacity.toFixed(2)} bps` },
  ];
  return {
    summary: `나이키스트 정리: 대역폭 ${bandwidthHz}Hz, 신호 레벨 ${levels} → 채널 용량 = ${capacity.toFixed(2)} bps`,
    result: { 대역폭Hz: bandwidthHz, 신호레벨수: levels, 채널용량bps: Number(capacity.toFixed(2)) },
    steps,
  };
}
