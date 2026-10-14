import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { hangUntilAborted, jsonResponse, stubFetch } from "../../test/fetchStub.js";
import { describeLlmError, isAvailabilityError, LlmError, llmFetchJson, redactSecrets } from "./http.js";

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

const opts = { provider: "openai", label: "chat", timeoutMs: 5_000 };

test("429·5xx는 재시도하고, Retry-After를 따른다", async () => {
  let n = 0;
  const stub = stubFetch(() => {
    n++;
    if (n === 1) return jsonResponse({ error: "slow down" }, 429, { "retry-after": "0" });
    if (n === 2) return jsonResponse({ error: "boom" }, 503, { "retry-after": "0" });
    return jsonResponse({ ok: true });
  });
  restore = stub.restore;
  const data = await llmFetchJson<{ ok: boolean }>("https://api.openai.com/v1/x", { method: "POST" }, opts);
  assert.equal(data.ok, true);
  assert.equal(stub.calls.length, 3);
});

test("401은 재시도하지 않고, 키가 섞인 응답 본문은 메시지에 넣지 않는다", async () => {
  const stub = stubFetch(() =>
    jsonResponse({ error: { message: "Incorrect API key provided: sk-proj-AbCdEf123456. You can find your API key at ..." } }, 401),
  );
  restore = stub.restore;
  const err = await llmFetchJson("https://api.openai.com/v1/x", { method: "POST" }, opts).catch((e) => e);
  assert.ok(err instanceof LlmError);
  assert.ok(err instanceof LlmError);
  assert.equal(err.kind, "auth");
  assert.equal(stub.calls.length, 1);
  assert.doesNotMatch(err.message, /sk-/);
  // 로그용 상세에도 키는 가려져 있어야 한다.
  assert.doesNotMatch(err.detail ?? "", /AbCdEf123456/);
  assert.equal(isAvailabilityError(err), false);
  assert.doesNotMatch(JSON.stringify(describeLlmError(err)), /sk-proj/);
});

test("결제 한도 소진(insufficient_quota) 429는 기다려도 안 풀리므로 재시도하지 않는다", async () => {
  const stub = stubFetch(() => jsonResponse({ error: { code: "insufficient_quota" } }, 429));
  restore = stub.restore;
  const err = await llmFetchJson("https://api.openai.com/v1/x", {}, opts).catch((e) => e);
  assert.ok(err instanceof LlmError);
  assert.equal(err.kind, "rate_limit");
  assert.equal(stub.calls.length, 1);
});

test("응답이 없으면 예산 안에서 timeout으로 끝난다", async () => {
  const stub = stubFetch((_call, init) => hangUntilAborted(init));
  restore = stub.restore;
  const started = Date.now();
  const err = await llmFetchJson("https://api.openai.com/v1/x", {}, { ...opts, timeoutMs: 150 }).catch((e) => e);
  assert.ok(err instanceof LlmError);
  assert.ok(err instanceof LlmError);
  assert.equal(err.kind, "timeout");
  assert.ok(Date.now() - started < 1_000);
  assert.equal(isAvailabilityError(err), true);
});

test("네트워크 오류는 원인(cause)을 메시지에 담고 최대 2번 재시도한다", async () => {
  const stub = stubFetch(() => {
    throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:11434"), { code: "ECONNREFUSED" }) });
  });
  restore = stub.restore;
  const err = await llmFetchJson("http://10.0.0.1:11434/api/chat", {}, { ...opts, provider: "ollama" }).catch((e) => e);
  assert.ok(err instanceof LlmError);
  assert.equal(err.kind, "unavailable");
  assert.match(err.message, /ECONNREFUSED/);
  assert.equal(stub.calls.length, 3);
});

test("호출한 쪽이 취소하면 재시도 없이 aborted", async () => {
  const stub = stubFetch((_call, init) => hangUntilAborted(init));
  restore = stub.restore;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  const err = await llmFetchJson("https://api.openai.com/v1/x", {}, { ...opts, signal: controller.signal }).catch((e) => e);
  assert.ok(err instanceof LlmError);
  assert.equal(err.kind, "aborted");
  assert.equal(stub.calls.length, 1);
});

test("redactSecrets는 sk- 키와 Bearer 토큰을 가린다", () => {
  assert.equal(redactSecrets("key sk-proj-abc_DEF-123 and Bearer sk-xyz"), "key sk-*** and Bearer ***");
});
