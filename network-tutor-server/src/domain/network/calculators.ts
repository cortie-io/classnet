import {
	ipToInt,
	intToIp,
	toBinaryOctets,
	prefixToMaskInt,
	maskToPrefix,
	parseOctets,
} from "./ip.js";

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
export function subnetCalculate(
	ip: string,
	prefixInput: number | string,
): CalcResult {
	const prefix =
		typeof prefixInput === "string" ? maskToPrefix(prefixInput) : prefixInput;
	const ipInt = ipToInt(ip);
	const maskInt = prefixToMaskInt(prefix);
	const networkInt = (ipInt & maskInt) >>> 0;
	const wildcardInt = ~maskInt >>> 0;
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
		{
			label: "1. 입력값 확인",
			detail: `IP = ${ip}, 프리픽스 = /${prefix} (서브넷 마스크 ${intToIp(maskInt)})`,
		},
		{
			label: "2. 이진수 변환",
			detail: `IP = ${toBinaryOctets(ipInt)}\n마스크 = ${toBinaryOctets(maskInt)}`,
		},
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
			detail:
				`호스트 비트 = 32 - ${prefix} = ${hostBits}bit → 전체 주소 2^${hostBits} = ${totalAddresses}개` +
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
// 서브넷 목록을 그대로 다 만들기 때문에 개수 상한이 꼭 있어야 한다 — 예전엔 "0.0.0.0/0를 1073741824개로
// 나누면?" 한 줄로 서버 메모리가 바닥나 프로세스가 죽었다(잡을 수 없는 OOM, 보안 감사에서 재현).
export const MAX_SUBNET_SPLIT = 256;

export function subnetSplitCalculate(
	ip: string,
	originalPrefix: number,
	subnetCount: number,
): CalcResult {
	if (!Number.isSafeInteger(subnetCount) || subnetCount < 2)
		throw new Error("서브넷 개수는 2개 이상이어야 합니다.");
	if (subnetCount > MAX_SUBNET_SPLIT)
		throw new Error(`서브넷 개수는 ${MAX_SUBNET_SPLIT}개까지만 계산합니다.`);
	if (
		!Number.isInteger(originalPrefix) ||
		originalPrefix < 0 ||
		originalPrefix > 32
	) {
		throw new Error("프리픽스는 0~32여야 합니다.");
	}
	const additionalBits = Math.ceil(Math.log2(subnetCount));
	const newPrefix = originalPrefix + additionalBits;
	if (newPrefix > 30) {
		throw new Error(
			`/${originalPrefix}을(를) ${subnetCount}개로 나누면 /${newPrefix}이 되어 호스트를 위한 비트가 부족합니다.`,
		);
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
				.map(
					(s) =>
						`${s.index}번: ${s.network}/${newPrefix} (브로드캐스트 ${s.broadcast}, 사용 가능 ${s.usableFirst}~${s.usableLast})`,
				)
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
			detail:
				"A: 1~126, B: 128~191, C: 192~223, D: 224~239, E: 240~255 (0, 127은 예약)",
		},
		{
			label: "3. 판정",
			detail: `${first} → Class ${cls}${note ? ` (${note})` : ""}`,
		},
	];

	return {
		summary: `${ip} → Class ${cls}, 기본 서브넷 마스크 ${defaultMask}`,
		result: {
			입력IP: ip,
			클래스: cls,
			기본서브넷마스크: defaultMask,
			...(note ? { 비고: note } : {}),
		},
		steps,
	};
}

// ---------- 진법 변환 ----------
const HEX_DIGITS = "0123456789ABCDEF";
export type Radix = 2 | 8 | 10 | 16;
const BASE_LABEL: Record<Radix, string> = {
	2: "2진수",
	8: "8진수",
	10: "10진수",
	16: "16진수",
};
const DIGIT_RE: Record<Radix, RegExp> = {
	2: /^[01]+$/,
	8: /^[0-7]+$/,
	10: /^\d+$/,
	16: /^[0-9A-F]+$/,
};

export function convertBase(value: string, from: Radix, to: Radix): CalcResult {
	// 앞자리 0은 값에 영향이 없지만 자릿값 전개 문자열을 자릿수만큼 부풀린다("0"×1500만 개로 수백 MB를
	// 만들던 증폭 공격) — 떼어 내고, 남은 자릿수도 64자로 제한한다.
	const clean = value
		.trim()
		.toUpperCase()
		.replace(/^0X/, "")
		.replace(/^0B/, "")
		.replace(/^0+(?=.)/, "");
	if (clean.length > 64) throw new Error("값이 너무 깁니다(64자리 이하).");
	if (!DIGIT_RE[from].test(clean))
		throw new Error(`${BASE_LABEL[from]} 형식이 아닙니다: ${value}`);
	const decimalValue = parseInt(clean, from);
	if (!Number.isSafeInteger(decimalValue))
		throw new Error(`값이 너무 큽니다: ${value}`);
	const steps: CalcStep[] = [];

	if (from === 10) {
		steps.push({ label: "1. 입력", detail: `10진수 ${decimalValue}` });
	} else {
		const terms = clean
			.split("")
			.reverse()
			.map(
				(d, i) =>
					`${d}${from === 16 ? `(${parseInt(d, 16)})` : ""}×${from}^${i}(${from ** i})`,
			)
			.reverse()
			.join(" + ");
		steps.push({
			label: "1. 자릿값 전개",
			detail: `${clean} = ${terms} = ${decimalValue}(10진수)`,
		});
	}

	let outputStr: string;
	if (to === 10) {
		outputStr = String(decimalValue);
		if (from !== 10)
			steps.push({ label: "2. 결과", detail: `10진수 = ${outputStr}` });
	} else {
		const divSteps: string[] = [];
		let n = decimalValue;
		if (n === 0) divSteps.push(`0 ÷ ${to} = 0 나머지 0`);
		while (n > 0) {
			const rem = n % to;
			const q = Math.floor(n / to);
			divSteps.push(
				`${n} ÷ ${to} = ${q} 나머지 ${rem}${to === 16 && rem >= 10 ? `(${HEX_DIGITS[rem]})` : ""}`,
			);
			n = q;
		}
		outputStr = decimalValue.toString(to).toUpperCase();
		steps.push({
			label: `2. ${to}로 나눈 나머지를 역순으로`,
			detail: `${divSteps.join("\n")}\n나머지를 아래에서 위로 읽으면 → ${outputStr}`,
		});
	}

	return {
		summary: `${BASE_LABEL[from]} ${clean} = ${BASE_LABEL[to]} ${outputStr}`,
		result: {
			입력값: clean,
			입력진법: BASE_LABEL[from],
			결과값: outputStr,
			결과진법: BASE_LABEL[to],
		},
		steps,
	};
}

/** "64를 2진수로, 16진수로 각각 바꿔줘"처럼 한 값을 여러 진법으로 — 각 변환 과정을 차례로 붙인다. */
export function convertBaseMulti(
	value: string,
	from: Radix,
	targets: Radix[],
): CalcResult {
	const uniq = Array.from(new Set(targets)).filter((t) => t !== from);
	if (uniq.length === 0) throw new Error("변환할 대상 진법이 없습니다.");
	if (uniq.length === 1) return convertBase(value, from, uniq[0]);
	const parts = uniq.map((t) => ({ to: t, r: convertBase(value, from, t) }));
	const clean = parts[0].r.result.입력값;
	return {
		summary: `${BASE_LABEL[from]} ${clean} = ${parts.map((p) => `${BASE_LABEL[p.to]} ${p.r.result.결과값}`).join(" = ")}`,
		result: {
			입력값: clean,
			입력진법: BASE_LABEL[from],
			...Object.fromEntries(
				parts.map((p) => [BASE_LABEL[p.to], p.r.result.결과값]),
			),
		},
		steps: parts.flatMap((p) =>
			p.r.steps.map((s) => ({
				label: `[${BASE_LABEL[p.to]}로] ${s.label}`,
				detail: s.detail,
			})),
		),
	};
}

// ---------- 프리픽스 정보 (/27 → 마스크·호스트 수) ----------
export function prefixInfo(prefix: number): CalcResult {
	if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32)
		throw new Error(`프리픽스는 0~32여야 합니다: /${prefix}`);
	const maskInt = prefixToMaskInt(prefix);
	const hostBits = 32 - prefix;
	const total = 2 ** hostBits;
	const usable = prefix >= 31 ? (prefix === 31 ? 2 : 1) : total - 2;
	// 경계가 걸리는 옥텟의 블록 크기(256 - 그 옥텟의 마스크 값) — 서브넷 시작 주소가 이 간격으로 반복된다.
	const octetIndex = Math.min(3, Math.floor(prefix / 8));
	const octetMask = (maskInt >>> (24 - octetIndex * 8)) & 255;
	const blockSize = prefix === 32 ? 1 : 256 - octetMask;
	const steps: CalcStep[] = [
		{
			label: "1. 네트워크 비트",
			detail: `/${prefix} → 앞에서부터 1이 ${prefix}개`,
		},
		{ label: "2. 2진수 마스크", detail: `${toBinaryOctets(maskInt)}` },
		{ label: "3. 10진수 마스크", detail: `${intToIp(maskInt)}` },
		{
			label: "4. 호스트 비트와 주소 수",
			detail:
				`호스트 비트 = 32 - ${prefix} = ${hostBits}bit → 주소 2^${hostBits} = ${total}개` +
				(prefix <= 30
					? ` → 네트워크·브로드캐스트 2개 제외 = 사용 가능 호스트 ${usable}개`
					: ""),
		},
		{
			label: "5. 블록 크기",
			detail: `${octetIndex + 1}번째 옥텟 마스크 ${octetMask} → 256 - ${octetMask} = ${blockSize}`,
		},
	];
	return {
		summary: `/${prefix} = 서브넷 마스크 ${intToIp(maskInt)}, 사용 가능 호스트 ${usable}개 (블록 크기 ${blockSize})`,
		result: {
			프리픽스: `/${prefix}`,
			서브넷마스크: intToIp(maskInt),
			이진마스크: toBinaryOctets(maskInt),
			와일드카드마스크: intToIp(~maskInt >>> 0),
			전체주소수: total,
			사용가능호스트수: usable,
			블록크기: blockSize,
		},
		steps,
	};
}

// ---------- 필요한 호스트 수 → 최소 서브넷 ----------
export function hostsToSubnet(hosts: number): CalcResult {
	// 상한이 없으면 "호스트 999…9(400자리)개" 같은 값(Infinity)에서 아래 반복이 끝나지 않는다.
	if (!Number.isSafeInteger(hosts) || hosts < 1 || hosts > 2 ** 30)
		throw new Error("호스트 수는 1~1073741824 사이여야 합니다.");
	let hostBits = 2;
	while (2 ** hostBits - 2 < hosts) hostBits++;
	if (hostBits > 30)
		throw new Error(
			`호스트 ${hosts}개는 IPv4 한 서브넷으로 수용할 수 없습니다.`,
		);
	const prefix = 32 - hostBits;
	const maskInt = prefixToMaskInt(prefix);
	const usable = 2 ** hostBits - 2;
	const steps: CalcStep[] = [
		{
			label: "1. 필요한 호스트 비트",
			detail:
				`2^n - 2 ≥ ${hosts}을 만족하는 최소 n` +
				`\n2^${hostBits - 1} - 2 = ${2 ** (hostBits - 1) - 2} < ${hosts}, 2^${hostBits} - 2 = ${usable} ≥ ${hosts} → n = ${hostBits}`,
		},
		{ label: "2. 프리픽스", detail: `32 - ${hostBits} = /${prefix}` },
		{
			label: "3. 서브넷 마스크",
			detail: `${toBinaryOctets(maskInt)} = ${intToIp(maskInt)}`,
		},
		{
			label: "4. 결과",
			detail: `한 서브넷의 주소 ${2 ** hostBits}개, 사용 가능 호스트 ${usable}개 (남는 주소 ${usable - hosts}개)`,
		},
	];
	return {
		summary: `호스트 ${hosts}개가 필요하면 → 호스트 비트 ${hostBits}bit, /${prefix} (서브넷 마스크 ${intToIp(maskInt)}), 사용 가능 호스트 ${usable}개`,
		result: {
			필요호스트수: hosts,
			호스트비트: hostBits,
			프리픽스: `/${prefix}`,
			서브넷마스크: intToIp(maskInt),
			사용가능호스트수: usable,
		},
		steps,
	};
}

// ---------- 필요한 서브넷 수 → 마스크 (클래스 기준) ----------
export function subnetsToMask(basePrefix: number, subnets: number): CalcResult {
	if (!Number.isSafeInteger(subnets) || subnets < 2 || subnets > 2 ** 30)
		throw new Error("서브넷 개수는 2~1073741824 사이여야 합니다.");
	const borrowed = Math.ceil(Math.log2(subnets));
	const prefix = basePrefix + borrowed;
	if (prefix > 30)
		throw new Error(
			`/${basePrefix}에서 서브넷 ${subnets}개를 만들면 호스트 비트가 부족합니다.`,
		);
	const maskInt = prefixToMaskInt(prefix);
	const hostBits = 32 - prefix;
	const usable = 2 ** hostBits - 2;
	const steps: CalcStep[] = [
		{
			label: "1. 빌려 올 비트",
			detail: `2^n ≥ ${subnets}을 만족하는 최소 n = ${borrowed} (2^${borrowed} = ${2 ** borrowed}개)`,
		},
		{
			label: "2. 새 프리픽스",
			detail: `기본 /${basePrefix} + ${borrowed} = /${prefix}`,
		},
		{
			label: "3. 서브넷 마스크",
			detail: `${toBinaryOctets(maskInt)} = ${intToIp(maskInt)}`,
		},
		{
			label: "4. 서브넷당 호스트",
			detail: `호스트 비트 ${hostBits}bit → 2^${hostBits} - 2 = ${usable}개`,
		},
	];
	return {
		summary: `기본 /${basePrefix}에서 서브넷 ${subnets}개가 필요하면 → ${borrowed}bit 빌려 /${prefix} (서브넷 마스크 ${intToIp(maskInt)}), 서브넷당 사용 가능 호스트 ${usable}개`,
		result: {
			기본프리픽스: `/${basePrefix}`,
			필요서브넷수: subnets,
			빌린비트: borrowed,
			프리픽스: `/${prefix}`,
			서브넷마스크: intToIp(maskInt),
			서브넷당사용가능호스트수: usable,
		},
		steps,
	};
}

// ---------- 채널 용량 계산 (섀넌/나이키스트) ----------
function humanBps(bps: number): string {
	if (bps >= 1e9) return ` (약 ${(bps / 1e9).toFixed(2)} Gbps)`;
	if (bps >= 1e6) return ` (약 ${(bps / 1e6).toFixed(2)} Mbps)`;
	if (bps >= 1e3) return ` (약 ${(bps / 1e3).toFixed(2)} kbps)`;
	return "";
}

export function shannonCapacity(
	bandwidthHz: number,
	snr: number,
	snrIsDb = false,
): CalcResult {
	if (
		!Number.isFinite(bandwidthHz) ||
		bandwidthHz <= 0 ||
		!Number.isFinite(snr) ||
		bandwidthHz > 1e15 ||
		Math.abs(snr) > 1e6
	) {
		throw new Error("대역폭·신호 대 잡음비 값이 올바르지 않습니다.");
	}
	const steps: CalcStep[] = [];
	let ratio = snr;
	if (snrIsDb) {
		ratio = 10 ** (snr / 10);
		steps.push({
			label: "1. dB → 비율 변환",
			detail: `S/N(dB) = ${snr} → 비율 = 10^(${snr}/10) = ${ratio.toFixed(4)}`,
		});
	} else {
		steps.push({ label: "1. 신호 대 잡음비(S/N)", detail: `S/N = ${ratio}` });
	}
	const inner = 1 + ratio;
	const log2Inner = Math.log2(inner);
	const capacity = bandwidthHz * log2Inner;
	steps.push({
		label: "2. 1 + S/N 계산",
		detail: `1 + ${ratio.toFixed(4)} = ${inner.toFixed(4)}`,
	});
	steps.push({
		label: "3. log₂(1+S/N)",
		detail: `log₂(${inner.toFixed(4)}) = ${log2Inner.toFixed(4)}`,
	});
	steps.push({
		label: "4. C = W · log₂(1+S/N)",
		detail: `${bandwidthHz} × ${log2Inner.toFixed(4)} = ${capacity.toFixed(2)} bps`,
	});
	return {
		summary: `섀넌 정리: 대역폭 ${bandwidthHz}Hz, S/N ${snrIsDb ? snr + "dB" : ratio} → 채널 용량 ≈ ${capacity.toFixed(2)} bps${humanBps(capacity)}`,
		result: {
			대역폭Hz: bandwidthHz,
			신호대잡음비: snrIsDb ? `${snr}dB` : ratio,
			채널용량bps: Number(capacity.toFixed(2)),
		},
		steps,
	};
}

export function nyquistCapacity(
	bandwidthHz: number,
	levels: number,
): CalcResult {
	if (
		!Number.isFinite(bandwidthHz) ||
		bandwidthHz <= 0 ||
		bandwidthHz > 1e15 ||
		!Number.isSafeInteger(levels) ||
		levels < 2 ||
		levels > 1e6
	) {
		throw new Error("대역폭·신호 레벨 값이 올바르지 않습니다.");
	}
	const log2Levels = Math.log2(levels);
	const capacity = 2 * bandwidthHz * log2Levels;
	const steps: CalcStep[] = [
		{ label: "1. 신호 레벨 수(B)", detail: `B = ${levels}` },
		{
			label: "2. log₂(B)",
			detail: `log₂(${levels}) = ${log2Levels.toFixed(4)}`,
		},
		{
			label: "3. C = 2W·log₂(B)",
			detail: `2 × ${bandwidthHz} × ${log2Levels.toFixed(4)} = ${capacity.toFixed(2)} bps`,
		},
	];
	return {
		summary: `나이키스트 정리: 대역폭 ${bandwidthHz}Hz, 신호 레벨 ${levels} → 채널 용량 = ${capacity.toFixed(2)} bps${humanBps(capacity)}`,
		result: {
			대역폭Hz: bandwidthHz,
			신호레벨수: levels,
			채널용량bps: Number(capacity.toFixed(2)),
		},
		steps,
	};
}
