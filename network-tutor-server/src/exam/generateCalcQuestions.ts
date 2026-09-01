import { randomInt } from "node:crypto";
import { subnetCalculate, classifyIp, convertBase, shannonCapacity, nyquistCapacity } from "../rules/calculators.js";
import type { GeneratedQuestion } from "./questionTypes.js";

// 계산형 문제는 100% 규칙엔진이 정답을 산출하고 LLM은 전혀 개입하지 않는다 — 이 프로젝트에서
// "검증 가능한 AI"의 핵심 지점을 문제 생성에도 그대로 적용한 것이다. 오답(선지) 역시 임의의 문자열이
// 아니라 실제로 학생이 저지르기 쉬운 계산 실수(마스크 반대로 적용, 호스트 수 -2 안 함 등)를 그대로
// 규칙엔진으로 재계산해 만든다 — 그래야 "그럴듯하지만 틀린" 선지가 된다.

/** correct와 겹치지 않고 서로도 겹치지 않는 오답 3개를 candidates(우선순위 순)에서 뽑는다.
 *  부족하면 extra()로 하나씩 더 만들어 채운다 — 문제 은행에 중복 선지가 절대 나가면 안 되기 때문. */
function pickDistractors(correct: string, candidates: string[], extra: (n: number) => string): string[] {
  const picked: string[] = [];
  const seen = new Set([correct]);
  for (const c of candidates) {
    if (picked.length >= 3) break;
    if (seen.has(c)) continue;
    seen.add(c);
    picked.push(c);
  }
  let n = 0;
  while (picked.length < 3) {
    const c = extra(n++);
    if (seen.has(c)) continue;
    seen.add(c);
    picked.push(c);
  }
  return picked;
}

function shuffle<T>(items: T[]): { shuffled: T[]; correctIndex: number } {
  const arr = items.map((v, i) => ({ v, key: randomInt(1_000_000), origIndex: i }));
  arr.sort((a, b) => a.key - b.key);
  const correctIndex = arr.findIndex((x) => x.origIndex === 0);
  return { shuffled: arr.map((x) => x.v), correctIndex };
}

function randomPrivateIp(): string {
  const pools = [
    () => `10.${randomInt(0, 256)}.${randomInt(0, 256)}.${randomInt(1, 255)}`,
    () => `172.${randomInt(16, 32)}.${randomInt(0, 256)}.${randomInt(1, 255)}`,
    () => `192.168.${randomInt(0, 256)}.${randomInt(1, 255)}`,
  ];
  return pools[randomInt(0, pools.length)]();
}

function subnetQuestion(): GeneratedQuestion {
  const ip = randomPrivateIp();
  const prefix = randomInt(20, 30); // 계산이 지나치게 커지지 않도록 /20~/29 범위로 제한
  const calc = subnetCalculate(ip, prefix);
  const networkInt = calc.result.네트워크주소 as string;
  const broadcastInt = calc.result.브로드캐스트주소 as string;
  const hostCount = calc.result.사용가능호스트수 as number;

  const angle = randomInt(0, 3);
  let stem: string;
  let correct: string;
  let wrongs: string[];

  if (angle === 0) {
    stem = `${ip}/${prefix} 네트워크의 네트워크 주소(Network Address)는?`;
    correct = networkInt;
    // 흔한 실수: 브로드캐스트와 헷갈림, 원본 IP를 그대로 씀, prefix를 하나·둘 다르게 계산
    const candidates = [
      broadcastInt,
      ip,
      subnetCalculate(ip, Math.min(prefix + 1, 32)).result.네트워크주소 as string,
      subnetCalculate(ip, Math.max(prefix - 1, 0)).result.네트워크주소 as string,
      subnetCalculate(ip, Math.min(prefix + 2, 32)).result.네트워크주소 as string,
    ];
    wrongs = pickDistractors(correct, candidates, (n) => `0.0.0.${n}`);
  } else if (angle === 1) {
    stem = `${ip}/${prefix} 네트워크의 브로드캐스트 주소(Broadcast Address)는?`;
    correct = broadcastInt;
    const candidates = [
      networkInt,
      ip,
      subnetCalculate(ip, Math.min(prefix + 1, 32)).result.브로드캐스트주소 as string,
      subnetCalculate(ip, Math.max(prefix - 1, 0)).result.브로드캐스트주소 as string,
      subnetCalculate(ip, Math.min(prefix + 2, 32)).result.브로드캐스트주소 as string,
    ];
    wrongs = pickDistractors(correct, candidates, (n) => `255.255.255.${n}`);
  } else {
    stem = `${ip}/${prefix} 네트워크에서 사용 가능한 호스트(Host) 수는?`;
    correct = `${hostCount}개`;
    const candidates = [
      `${hostCount + 2}개`,
      `${hostCount + 1}개`,
      `${Math.max(hostCount - 2, 0)}개`,
      `${hostCount * 2}개`,
      `${Math.max(Math.floor(hostCount / 2), 0)}개`,
    ];
    wrongs = pickDistractors(correct, candidates, (n) => `${hostCount + 10 + n}개`);
  }

  const { shuffled, correctIndex } = shuffle([correct, ...wrongs]);
  return {
    subject: "2과목_TCP_IP",
    conceptNodeId: null,
    stem,
    choices: shuffled,
    correctIndex,
    explanation: `${calc.summary}\n\n${calc.steps.map((s) => `${s.label}: ${s.detail}`).join("\n")}`,
    sourceDetail: { generator: "subnet", ip, prefix },
  };
}

function binaryQuestion(): GeneratedQuestion {
  const decimal = randomInt(1, 256);
  const calc = convertBase(String(decimal), 10, 2);
  const correct = calc.result.결과값 as string;
  const correctNum = Number.parseInt(correct, 2);
  // 흔한 실수: 자릿수 하나 밀림(×2, ÷2), 마지막/앞자리 비트 반전
  const candidates = [
    (correctNum * 2).toString(2),
    Math.max(1, Math.floor(correctNum / 2)).toString(2),
    (correctNum ^ 1).toString(2),
    (correctNum ^ 2).toString(2),
    (correctNum + 1).toString(2),
  ];
  const wrongList = pickDistractors(correct, candidates, (n) => (correctNum + 3 + n).toString(2));

  const { shuffled, correctIndex } = shuffle([correct, ...wrongList]);
  return {
    subject: "1과목_네트워크_일반",
    conceptNodeId: null,
    stem: `10진수 ${decimal}을(를) 2진수로 변환한 값으로 옳은 것은?`,
    choices: shuffled,
    correctIndex,
    explanation: calc.steps.map((s) => `${s.label}: ${s.detail}`).join("\n"),
    sourceDetail: { generator: "binary", decimal },
  };
}

function ipClassQuestion(): GeneratedQuestion {
  const ip = randomPrivateIp();
  const calc = classifyIp(ip);
  const correct = `Class ${calc.result.클래스}`;
  const all = ["Class A", "Class B", "Class C", "Class D", "Class E"];
  const wrongs = all.filter((c) => c !== correct);
  const pickedWrongs: string[] = [];
  while (pickedWrongs.length < 3) {
    const idx = randomInt(0, wrongs.length);
    if (!pickedWrongs.includes(wrongs[idx])) pickedWrongs.push(wrongs[idx]);
  }
  const { shuffled, correctIndex } = shuffle([correct, ...pickedWrongs]);
  return {
    subject: "2과목_TCP_IP",
    conceptNodeId: null,
    stem: `IP 주소 ${ip}는 어느 클래스에 속하는가?`,
    choices: shuffled,
    correctIndex,
    explanation: calc.steps.map((s) => `${s.label}: ${s.detail}`).join("\n"),
    sourceDetail: { generator: "ip_class", ip },
  };
}

function channelCapacityQuestion(): GeneratedQuestion {
  const bandwidth = [1000, 2000, 3000, 4000][randomInt(0, 4)];
  const useShannon = randomInt(0, 2) === 0;
  if (useShannon) {
    const snr = [15, 30, 63][randomInt(0, 3)];
    const calc = shannonCapacity(bandwidth, snr, false);
    const correctVal = calc.result.채널용량bps as number;
    const correct = `약 ${Math.round(correctVal).toLocaleString()}bps`;
    const candidates = [
      `약 ${Math.round(bandwidth * Math.log2(snr)).toLocaleString()}bps`, // 1+S/N을 안 더한 실수
      `약 ${Math.round(2 * bandwidth * Math.log2(1 + snr)).toLocaleString()}bps`, // 나이키스트 공식과 혼동
      `약 ${Math.round(correctVal / 2).toLocaleString()}bps`,
      `약 ${Math.round(correctVal * 2).toLocaleString()}bps`,
    ];
    const wrongs = pickDistractors(correct, candidates, (n) => `약 ${Math.round(correctVal + (n + 1) * 500).toLocaleString()}bps`);
    const { shuffled, correctIndex } = shuffle([correct, ...wrongs]);
    return {
      subject: "1과목_네트워크_일반",
      conceptNodeId: null,
      stem: `대역폭 ${bandwidth}Hz, 신호 대 잡음비(S/N) ${snr}일 때 섀넌(Shannon) 정리에 따른 채널 용량은?`,
      choices: shuffled,
      correctIndex,
      explanation: calc.steps.map((s) => `${s.label}: ${s.detail}`).join("\n"),
      sourceDetail: { generator: "shannon", bandwidth, snr },
    };
  }
  const levels = [2, 4, 8][randomInt(0, 3)];
  const calc = nyquistCapacity(bandwidth, levels);
  const correctVal = calc.result.채널용량bps as number;
  const correct = `약 ${Math.round(correctVal).toLocaleString()}bps`;
  const candidates = [
    `약 ${Math.round(bandwidth * Math.log2(levels)).toLocaleString()}bps`, // 2배를 안 한 실수
    `약 ${Math.round(correctVal * 2).toLocaleString()}bps`,
    `약 ${Math.round(correctVal / 2).toLocaleString()}bps`,
    `약 ${Math.round(bandwidth * levels).toLocaleString()}bps`,
  ];
  const wrongs = pickDistractors(correct, candidates, (n) => `약 ${Math.round(correctVal + (n + 1) * 500).toLocaleString()}bps`);
  const { shuffled, correctIndex } = shuffle([correct, ...wrongs]);
  return {
    subject: "1과목_네트워크_일반",
    conceptNodeId: null,
    stem: `대역폭 ${bandwidth}Hz, 신호 레벨 수 ${levels}일 때 나이키스트(Nyquist) 정리에 따른 채널 용량은?`,
    choices: shuffled,
    correctIndex,
    explanation: calc.steps.map((s) => `${s.label}: ${s.detail}`).join("\n"),
    sourceDetail: { generator: "nyquist", bandwidth, levels },
  };
}

export function generateCalcQuestions(count: number): GeneratedQuestion[] {
  const generators = [subnetQuestion, subnetQuestion, binaryQuestion, ipClassQuestion, channelCapacityQuestion];
  const out: GeneratedQuestion[] = [];
  for (let i = 0; i < count; i++) {
    out.push(generators[i % generators.length]());
  }
  return out;
}
