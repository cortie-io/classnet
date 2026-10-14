import { test } from "node:test";
import assert from "node:assert/strict";
import {
	extractSpecificTokens,
	matchBySpecificTokens,
	tokenInText,
} from "./lookupSearch.js";

test("점수·개수를 말하는 숫자는 조회 키가 아니다", () => {
	assert.deepEqual(
		extractSpecificTokens("오늘 필기 시험보고 왔는데 다행히 62점이야"),
		[],
	);
	assert.deepEqual(extractSpecificTokens("620점 나왔어"), []);
	assert.deepEqual(extractSpecificTokens("호스트 30개가 필요해"), []);
	assert.deepEqual(extractSpecificTokens("포트 443은 무슨 서비스야?"), ["443"]);
	assert.deepEqual(
		extractSpecificTokens("FTP에서 20번 포트랑 21번 포트 차이가 뭐야"),
		["20", "21"],
	);
	assert.deepEqual(extractSpecificTokens("CAT6랑 CAT5e 차이가 뭐야"), [
		"cat6",
		"cat5e",
	]);
	assert.deepEqual(extractSpecificTokens("RAID 5랑 RAID 6 차이가 뭐야"), [
		"raid5",
		"raid6",
	]);
	assert.deepEqual(extractSpecificTokens("IPv4랑 IPv6 차이점 알려줘"), []);
});

test("표 칸의 값과 정확히 일치할 때만 맞는다", () => {
	assert.equal(tokenInText("62", "포트: 162, 서비스: SNMP"), false);
	assert.equal(tokenInText("21", "포트: 21, 서비스: FTP(제어)"), true);
	assert.equal(tokenInText("21", "/21 프리픽스"), true); // 숫자 자체는 같은 값
	assert.equal(tokenInText("21", "2100"), false);
	assert.equal(tokenInText("cat6", "카테고리: CAT 6, 속도: 1Gbps"), true);
	assert.equal(tokenInText("cat6", "카테고리: CAT 6a"), false);
	assert.equal(tokenInText("raid5", "레벨: RAID 5, 특징: 분산 패리티"), true);
	assert.equal(tokenInText("raid5", "레벨: RAID 50"), false);
});

test("행 고르기", () => {
	const rows = [
		{ tableName: "t", rowData: { 포트: "161", 서비스: "SNMP" } },
		{ tableName: "t", rowData: { 포트: "162", 서비스: "SNMP Trap" } },
		{ tableName: "t", rowData: { 포트: "443", 서비스: "HTTPS" } },
	];
	assert.deepEqual(matchBySpecificTokens(rows, ["62"]), []);
	assert.deepEqual(
		matchBySpecificTokens(rows, ["443"]).map((r) => r.rowData.서비스),
		["HTTPS"],
	);
});
