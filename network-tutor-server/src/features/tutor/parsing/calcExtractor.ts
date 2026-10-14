import {
	subnetCalculate,
	subnetSplitCalculate,
	classifyIp,
	convertBaseMulti,
	shannonCapacity,
	nyquistCapacity,
	prefixInfo,
	hostsToSubnet,
	subnetsToMask,
	type CalcResult,
	type Radix,
} from "../../../domain/network/calculators.js";

export type CalcKind =
	| "subnet"
	| "subnet_split"
	| "ip_class"
	| "base_convert"
	| "shannon"
	| "nyquist"
	| "prefix_info"
	| "hosts_to_subnet"
	| "subnets_to_mask";

export interface CalcMatch {
	kind: CalcKind;
	result: CalcResult;
}

const IP_RE = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/;
const CIDR_RE = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s*\/\s*(\d{1,2})\b/;
const MASK_AFTER_RE =
	/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b[^0-9]{0,20}\b(255\.\d{1,3}\.\d{1,3}\.\d{1,3}|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/;
// "4개(의) 서브넷으로 나누면" — "서브넷을 몇 개로 나누는" 유형은 기존 subnetCalculate(주어진 프리픽스
// 자체 정보)로는 답할 수 없어 별도로 감지한다(실측 평가에서 확인된 오분류 — subnet_split 계산기 참고).
const SUBNET_SPLIT_RE =
	/(\d+)\s*개(?:의)?\s*(?:서브넷|서브네트워크|네트워크)?\s*(?:으로|로)?\s*(?:나누|분할|쪼개)/;
// IP 없이 프리픽스만 있는 경우("/27 서브넷 마스크는?", "/26이면 호스트 몇 개야?").
const PREFIX_ONLY_RE = /(?:^|[^\d.\w])\/\s?(\d{1,2})(?!\d)/;
// "호스트 30개", "PC 50대", "50개의 호스트", "컴퓨터 100대".
const HOSTS_RE =
	/(?:호스트|컴퓨터|PC|장비|단말|클라이언트)\s*(?:가|를|수가|수)?\s*(\d+)\s*(?:개|대)|(\d+)\s*(?:개|대)의?\s*(?:호스트|컴퓨터|PC|장비|단말|클라이언트)/i;
const SUBNET_COUNT_RE =
	/(?:서브넷|서브네트워크|네트워크)\s*(?:을|를|이|가)?\s*(\d+)\s*개|(\d+)\s*개(?:의)?\s*(?:서브넷|서브네트워크)/;
const CLASS_RE = /\b([ABC])\s*클래스|클래스\s*([ABC])\b/i;

const BASE_WORDS: { re: RegExp; base: Radix }[] = [
	{ re: /2진수|이진수|2진법|이진법|binary/gi, base: 2 },
	{ re: /8진수|팔진수|8진법|팔진법|octal/gi, base: 8 },
	{ re: /16진수|십육진수|16진법|십육진법|hex(?:adecimal)?/gi, base: 16 },
	{ re: /10진수|십진수|10진법|십진법|decimal/gi, base: 10 },
];

/** "3kHz", "4 MHz", "3000Hz", "3킬로헤르츠" → Hz. */
export function parseHertz(text: string): number | null {
	const m = text.match(
		/(\d+(?:\.\d+)?)\s*(k|K|킬로|M|메가|G|기가)?\s*(?:Hz|hz|HZ|헤르츠)/,
	);
	if (!m) return null;
	const mult =
		{ k: 1e3, K: 1e3, 킬로: 1e3, M: 1e6, 메가: 1e6, G: 1e9, 기가: 1e9 }[
			m[2] ?? ""
		] ?? 1;
	return Number(m[1]) * mult;
}

interface BaseMention {
	base: Radix;
	index: number;
	end: number;
}

function baseMentions(q: string): BaseMention[] {
	const out: BaseMention[] = [];
	for (const { re, base } of BASE_WORDS) {
		for (const m of q.matchAll(re))
			out.push({
				base,
				index: m.index ?? 0,
				end: (m.index ?? 0) + m[0].length,
			});
	}
	return out.sort((a, b) => a.index - b.index);
}

/** 진법 변환 요청 해석. "10진수 173을 2진수로", "173을 2진수로", "64를 2진수로, 16진수로 각각",
 * "11010(2)를 10진수로", "0xAD를 10진수로", "2진수 10101101을 10진수로". */
export function parseBaseConversion(
	q: string,
): { value: string; from: Radix; targets: Radix[] } | null {
	const mentions = baseMentions(q);
	if (mentions.length === 0) return null;
	// 숫자를 하나 이상 포함한 값 후보. "2진수"의 2, "16진수"의 16처럼 진법 이름의 일부는 건너뛴다.
	const VALUE_RE =
		/(0x[0-9a-f]+|0b[01]+|[0-9a-f]*\d[0-9a-f]*)(?:\s*\(\s*(2|8|10|16)\s*\))?/gi;
	for (const m of q.matchAll(VALUE_RE)) {
		const start = m.index ?? 0;
		const end = start + m[0].length;
		const raw = m[1];
		if (mentions.some((b) => start >= b.index && start < b.end)) continue;
		if (
			/^\s*(?:진|번|개|bit|비트|계층|과목)/i.test(q.slice(start + raw.length))
		)
			continue;
		// 값 앞뒤가 영문자에 붙어 있으면(예: "CAT6", "IPv4") 숫자 값이 아니다.
		if (/[A-Za-z]$/.test(q.slice(0, start)) || /^[g-zG-Z]/.test(q.slice(end)))
			continue;
		// IP 주소의 한 옥텟("192.168.1.1"의 192)은 진법 변환 값이 아니다.
		if (
			/^\.\d/.test(q.slice(start + raw.length)) ||
			/\d\.$/.test(q.slice(0, start))
		)
			continue;

		let from: Radix | null = null;
		if (m[2]) from = Number(m[2]) as Radix;
		else if (/^0x/i.test(raw)) from = 16;
		else if (/^0b/i.test(raw)) from = 2;
		// 값 바로 앞의 진법 이름("10진수 173", "2진수 1010")이 원래 진법이다.
		const source = [...mentions]
			.reverse()
			.find((b) => b.end <= start && /^\s*$/.test(q.slice(b.end, start)));
		if (!from && source) from = source.base;

		const targets = mentions
			.filter((b) => b !== source && b.index >= end)
			.map((b) => b.base);
		const before = mentions
			.filter((b) => b !== source && b.end <= start)
			.map((b) => b.base);
		let finalTargets = targets.length > 0 ? targets : before;

		if (!from) {
			const digits = raw.replace(/^0[xb]/i, "");
			if (/[a-f]/i.test(digits)) from = 16;
			// "1010을 10진수로"처럼 0과 1로만 된 값을 10진수로 바꾸라면 2진수다.
			else if (/^[01]{2,}$/.test(digits) && finalTargets.every((t) => t !== 2))
				from = 2;
			else from = 10;
		}
		finalTargets = finalTargets.filter((t) => t !== from);
		if (finalTargets.length === 0) continue;
		return { value: raw, from, targets: finalTargets };
	}
	return null;
}

/** 규칙 기반 계산 요청 추출. 매칭되지 않으면 null → 설명형 파이프라인으로 폴백. */
export function extractCalcRequest(question: string): CalcMatch | null {
	const q = question.trim();
	const attempt = (kind: CalcKind, fn: () => CalcResult): CalcMatch | null => {
		try {
			return { kind, result: fn() };
		} catch {
			return null;
		}
	};

	const isSubnetIntent =
		/서브넷|서브네팅|네트워크\s*주소|브로드캐스트|호스트\s*수|사용\s*가능한?\s*호스트|와일드카드|마스크|범위/.test(
			q,
		);
	const cidrMatch = q.match(CIDR_RE);
	const splitMatch = q.match(SUBNET_SPLIT_RE);
	// "192.168.1.0/24를 4개로 나누면?"은 "서브넷"이라는 말이 없어도 분할 계산이다(실사용 중 그냥 넘어가
	// 조회형으로 새서 "표에 없어 답할 수 없다"는 답이 나갔다).
	if (cidrMatch && splitMatch) {
		const hit = attempt("subnet_split", () =>
			subnetSplitCalculate(
				cidrMatch[1],
				Number(cidrMatch[2]),
				Number(splitMatch[1]),
			),
		);
		if (hit) return hit;
	}
	if (cidrMatch && (isSubnetIntent || /몇|뭐|어떻게|계산|구해|알려/.test(q))) {
		const hit = attempt("subnet", () =>
			subnetCalculate(cidrMatch[1], Number(cidrMatch[2])),
		);
		if (hit) return hit;
	}
	if (isSubnetIntent) {
		const maskMatch = q.match(MASK_AFTER_RE);
		if (maskMatch) {
			const hit = attempt("subnet", () =>
				subnetCalculate(maskMatch[1], maskMatch[2]),
			);
			if (hit) return hit;
		}
	}

	// 필요한 호스트 수 → 최소 서브넷("호스트 30개가 필요한 부서에 줄 수 있는 최소 서브넷 크기는?").
	const hostsMatch = q.match(HOSTS_RE);
	if (
		hostsMatch &&
		!cidrMatch &&
		/서브넷|마스크|프리픽스|최소|필요|수용|할당|크기/.test(q)
	) {
		const hit = attempt("hosts_to_subnet", () =>
			hostsToSubnet(Number(hostsMatch[1] ?? hostsMatch[2])),
		);
		if (hit) return hit;
	}

	// 클래스 기준 서브넷 개수 → 마스크("C클래스 네트워크를 서브넷 6개로 나누려면 마스크는?").
	const classMatch = q.match(CLASS_RE);
	const subnetCount = q.match(SUBNET_COUNT_RE) ?? splitMatch;
	if (classMatch && subnetCount && !cidrMatch) {
		const base = { A: 8, B: 16, C: 24 }[
			(classMatch[1] ?? classMatch[2]).toUpperCase() as "A" | "B" | "C"
		];
		const n = Number(subnetCount[1] ?? subnetCount[2]);
		const hit = attempt("subnets_to_mask", () => subnetsToMask(base, n));
		if (hit) return hit;
	}

	// IP 없이 프리픽스만("/27 서브넷 마스크는?", "/26이면 호스트 몇 개?").
	const prefixMatch = !q.match(IP_RE) ? q.match(PREFIX_ONLY_RE) : null;
	if (
		prefixMatch &&
		/서브넷|마스크|호스트|몇|프리픽스|CIDR|비트|주소/i.test(q)
	) {
		const hit = attempt("prefix_info", () =>
			prefixInfo(Number(prefixMatch[1])),
		);
		if (hit) return hit;
	}

	const isClassIntent =
		/클래스가|클래스는|클래스\s*판별|무슨\s*클래스|어느\s*클래스|몇\s*클래스/.test(
			q,
		);
	const ipOnly = q.match(IP_RE);
	if (isClassIntent && ipOnly && !cidrMatch) {
		const hit = attempt("ip_class", () => classifyIp(ipOnly[1]));
		if (hit) return hit;
	}

	// "1101 더하기 0111은 2진수로 얼마야?"는 변환이 아니라 2진수 연산이다 — 한 값만 변환하면 틀린 답이 된다.
	const isArithmetic =
		/더하기|빼기|곱하기|나누기|더하면|빼면|곱하면|합은|합이|차는|차이는|\d\s*[+×*]\s*\d/.test(
			q,
		);
	if (
		!isArithmetic &&
		/진수|진법|변환|바꿔|바꾸|binary|hex|octal|decimal/i.test(q)
	) {
		const conv = parseBaseConversion(q);
		if (conv) {
			const hit = attempt("base_convert", () =>
				convertBaseMulti(conv.value, conv.from, conv.targets),
			);
			if (hit) return hit;
		}
	}

	const hz = parseHertz(q);
	if (
		/섀넌|샤논|shannon|채널\s*용량/i.test(q) &&
		hz !== null &&
		!/나이키스트|nyquist/i.test(q)
	) {
		const dbMatch = q.match(/(\d+(?:\.\d+)?)\s*dB/i);
		const ratioMatch = q.match(
			/(?:S\s*\/\s*N|SNR|신호\s*대\s*잡음비?)\s*(?:비)?\s*(?:가|는|이|=|:)?\s*(\d+(?:\.\d+)?)(?!\s*dB)/i,
		);
		if (dbMatch) {
			const hit = attempt("shannon", () =>
				shannonCapacity(hz, Number(dbMatch[1]), true),
			);
			if (hit) return hit;
		} else if (ratioMatch) {
			const hit = attempt("shannon", () =>
				shannonCapacity(hz, Number(ratioMatch[1]), false),
			);
			if (hit) return hit;
		}
	}

	if (/나이키스트|nyquist/i.test(q) && hz !== null) {
		const levelMatch = q.match(
			/(\d+)\s*(?:레벨|level|단계|진\s*신호|가지\s*신호)/i,
		);
		if (levelMatch) {
			const hit = attempt("nyquist", () =>
				nyquistCapacity(hz, Number(levelMatch[1])),
			);
			if (hit) return hit;
		}
	}

	return null;
}
