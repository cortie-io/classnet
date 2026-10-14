import { test } from "node:test";
import assert from "node:assert/strict";
import {
	extractCalcRequest,
	parseBaseConversion,
	parseHertz,
} from "./calcExtractor.js";

const kind = (q: string) => extractCalcRequest(q)?.kind ?? null;

// 2026-09 audit_log에서 조회형으로 새서 "표에 없어 답할 수 없다"는 답이 나갔던 계산 질문들.
test("예전에 놓친 계산 질문들", () => {
	assert.equal(
		kind(
			"신호 대 잡음비가 30dB인 3kHz 회선의 최대 채널 용량을 섀넌 공식으로 구해줘",
		),
		"shannon",
	);
	assert.equal(
		kind("호스트 30개가 필요한 부서에 줄 수 있는 최소 서브넷 크기는?"),
		"hosts_to_subnet",
	);
	assert.equal(kind("64를 2진수로, 16진수로 각각 바꿔줘"), "base_convert");
	assert.equal(
		kind("그럼 예시로 192.168.1.0/24를 4개로 나누면 어떻게 돼?"),
		"subnet_split",
	);
	assert.equal(kind("/27 서브넷 마스크는 몇진수로 뭐야?"), "prefix_info");
});

test("원래 되던 계산 질문들", () => {
	assert.equal(
		kind("192.168.1.10/26 서브넷의 네트워크 주소와 브로드캐스트 주소는?"),
		"subnet",
	);
	assert.equal(kind("173을 2진수로 변환해줘"), "base_convert");
	assert.equal(
		kind("173을 2진수로 변환하는 과정을 단계별로 설명해줘"),
		"base_convert",
	);
	assert.equal(kind("128.0.0.0은 어느 클래스야?"), "ip_class");
	assert.equal(
		kind("대역폭 4kHz에 8레벨 신호를 쓰면 나이키스트 채널 용량은?"),
		"nyquist",
	);
});

test("계산이 아닌 질문은 건드리지 않는다", () => {
	assert.equal(kind("2진수를 10진수로 변환하려면 어케함"), null);
	assert.equal(kind("10진수를 2진수로"), null);
	assert.equal(kind("-26 하는게 /26이라서야?"), null);
	assert.equal(kind("오늘 필기 시험보고 왔는데 다행히 62점이야"), null);
	assert.equal(kind("IPv6는 32비트 주소체계 맞지?"), null);
	assert.equal(kind("TCP/IP 4계층이 뭐야"), null);
	assert.equal(kind("CAT6 케이블 최대 전송속도가 얼마야?"), null);
	assert.equal(kind("192.168.1.1을 2진수로 바꿔줘"), null);
	assert.equal(kind("1101 더하기 0111은 2진수로 얼마야?"), null);
});

test("진법 변환 해석", () => {
	assert.deepEqual(parseBaseConversion("64를 2진수로, 16진수로 각각 바꿔줘"), {
		value: "64",
		from: 10,
		targets: [2, 16],
	});
	assert.deepEqual(parseBaseConversion("2진수 10101101을 10진수로"), {
		value: "10101101",
		from: 2,
		targets: [10],
	});
	assert.deepEqual(parseBaseConversion("11010(2)를 10진수로 바꿔줘"), {
		value: "11010",
		from: 2,
		targets: [10],
	});
	assert.deepEqual(parseBaseConversion("0xAD를 10진수로"), {
		value: "0xAD",
		from: 16,
		targets: [10],
	});
	assert.deepEqual(parseBaseConversion("1010을 10진수로"), {
		value: "1010",
		from: 2,
		targets: [10],
	});
	assert.deepEqual(parseBaseConversion("10진수 255를 8진수로"), {
		value: "255",
		from: 10,
		targets: [8],
	});
});

test("계산 결과 값", () => {
	assert.equal(
		extractCalcRequest("64를 2진수로, 16진수로 각각 바꿔줘")?.result.summary,
		"10진수 64 = 2진수 1000000 = 16진수 40",
	);
	const hosts = extractCalcRequest(
		"호스트 30개가 필요한 부서에 줄 수 있는 최소 서브넷 크기는?",
	)!.result.result;
	assert.equal(hosts.프리픽스, "/27");
	assert.equal(hosts.서브넷마스크, "255.255.255.224");
	const prefix = extractCalcRequest("/27 서브넷 마스크는 몇진수로 뭐야?")!
		.result.result;
	assert.equal(prefix.서브넷마스크, "255.255.255.224");
	assert.equal(prefix.사용가능호스트수, 30);
	assert.equal(prefix.블록크기, 32);
	const split = extractCalcRequest("192.168.1.0/24를 4개로 나누면?")!.result
		.result;
	assert.equal(split.새프리픽스, "/26");
	const shannon = extractCalcRequest(
		"신호 대 잡음비가 30dB인 3kHz 회선의 최대 채널 용량을 섀넌 공식으로 구해줘",
	)!.result.result;
	assert.equal(shannon.대역폭Hz, 3000);
	assert.ok(Math.abs(Number(shannon.채널용량bps) - 29901.67) < 1);
	const sub = extractCalcRequest(
		"C클래스 네트워크를 서브넷 6개로 나누려면 서브넷 마스크는?",
	)!;
	assert.equal(sub.kind, "subnets_to_mask");
	assert.equal(sub.result.result.프리픽스, "/27");
});

test("거대한 값으로 서버를 멈추게 할 수 없다", () => {
	const started = Date.now();
	assert.notEqual(kind("0.0.0.0/0를 1073741824개로 나누면?"), "subnet_split"); // 분할 계산은 거절
	assert.equal(kind(`호스트 ${"9".repeat(400)}개가 필요한 서브넷은?`), null);
	assert.equal(kind(`${"0".repeat(150)}1을 10진수로 바꿔줘`), "base_convert");
	assert.ok(Date.now() - started < 1000);
});

test("주파수 단위", () => {
	assert.equal(parseHertz("3kHz"), 3000);
	assert.equal(parseHertz("4 MHz"), 4_000_000);
	assert.equal(parseHertz("3000Hz"), 3000);
	assert.equal(parseHertz("3킬로헤르츠"), 3000);
});
