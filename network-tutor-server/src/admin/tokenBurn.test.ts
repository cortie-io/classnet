import test from "node:test";
import assert from "node:assert/strict";

import { allocateQuotas, buildLongBurnPrompt, buildNetworkExamQuestionSet, computeRankWeights, simulateTokenBurn } from "./tokenBurn.js";

test("computeRankWeights preserves descending rank order", () => {
  assert.deepEqual(computeRankWeights(["a", "b", "c"]), [3, 2, 1]);
  assert.deepEqual(computeRankWeights(["a", "b", "c"], "equal"), [1, 1, 1]);
});

test("allocateQuotas totals the full token budget and preserves ranked order", () => {
  const quotas = allocateQuotas(1000, ["A", "B", "C", "D"]);
  const total = Object.values(quotas).reduce((sum, value) => sum + value, 0);

  assert.equal(total, 1000);
  assert.deepEqual(Object.keys(quotas), ["A", "B", "C", "D"]);
  assert.equal(quotas.A, 400);
  assert.equal(quotas.B, 300);
  assert.equal(quotas.C, 200);
  assert.equal(quotas.D, 100);
});

test("simulateTokenBurn defaults to a faster per-turn budget", async () => {
  const result = await simulateTokenBurn(["alice", "bob"], 1000);

  assert.equal(result.tokensPerTurn, 2000);
  assert.equal(result.log.length, 2);
  assert.equal(result.log.at(-1)?.remainingTotal, 0);
});

test("simulateTokenBurn falls back to dryrun when an API call times out", async () => {
  const result = await simulateTokenBurn(["alice", "bob"], 200, {
    tokensPerTurn: 100,
    apiKey: "test-key",
    requestTimeoutMs: 20,
    apiCaller: async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { usage: { total_tokens: 100 } };
    },
  });

  assert.equal(result.apiCalls, 3);
  assert.ok(result.log.some((entry) => entry.mode === "fallback-dryrun"));
  assert.equal(result.log.at(-1)?.remainingTotal, 0);
});

test("simulateTokenBurn exhausts the total budget without leaving leftover tokens", async () => {
  const result = await simulateTokenBurn(["alice", "bob", "carol"], 1000, {
    tokensPerTurn: 200,
    apiKey: undefined,
    promptText: "hello",
  });

  assert.equal(result.totalTokens, 1000);
  assert.equal(result.apiCalls, 0);
  assert.equal(Object.values(result.allocations).reduce((sum, value) => sum + value.consumed, 0), 1000);
  assert.equal(result.log.length, 6);
  assert.equal(result.log.at(-1)?.remainingTotal, 0);
});

test("simulateTokenBurn honors concurrency for faster parallel API burns", async () => {
  const startedAt = Date.now();
  let seenMaxTokens: number | undefined;
  const result = await simulateTokenBurn(["alice", "bob", "carol"], 300, {
    tokensPerTurn: 100,
    concurrency: 3,
    maxTokens: 2048,
    apiKey: "test-key",
    apiCaller: async (_prompt, _apiKey, _model, maxTokens) => {
      seenMaxTokens = maxTokens;
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { usage: { total_tokens: 100 } };
    },
  });

  assert.equal(seenMaxTokens, 2048);
  assert.equal(result.apiCalls, 4);
  assert.equal(result.log.at(-1)?.remainingTotal, 0);
  assert.ok(Date.now() - startedAt < 500, `expected concurrency to reduce elapsed time, got ${Date.now() - startedAt}ms`);
});

test("buildLongBurnPrompt uses network exam context instead of generic filler text", () => {
  const prompt = buildLongBurnPrompt("alice", "다음 중 TCP/IP 계층에서 가장 적절한 설명은?\n1. 응용 계층은 패킷 전송을 담당한다\n2. 네트워크 계층은 IP 주소를 통해 경로를 결정한다\n3. 물리 계층은 세그먼트를 관리한다\n4. 전송 계층은 프레임을 캡슐화한다", 3);

  assert.match(prompt, /네트워크관리사 2급 필기/i);
  assert.match(prompt, /TCP\/IP|ARP|ICMP|VLAN|라우팅|서브넷/i);
  assert.ok(prompt.length > 4000, `expected long exam-style prompt, got ${prompt.length} chars`);
});

test("simulateTokenBurn creates a large prompt and sets a high max_tokens default for token burn scenarios", async () => {
  let seen: { prompt: string; maxTokens?: number } | undefined;

  await simulateTokenBurn(["alice"], 1000, {
    tokensPerTurn: 1000,
    maxTokens: 8192,
    apiKey: "test-key",
    apiCaller: async (prompt, _apiKey, _model, maxTokens) => {
      seen = { prompt, maxTokens };
      return { usage: { total_tokens: 1000 } };
    },
  });

  assert.ok(seen);
  assert.equal(seen.maxTokens, 8192);
  assert.ok(seen.prompt.length > 4000, `expected large prompt payload, got ${seen.prompt.length} chars`);
  assert.match(seen.prompt, /네트워크관리사 2급 필기|토큰 소모|장문|한국어|실전 적용/i);
});

test("buildNetworkExamQuestionSet produces network-management exam style prompts", () => {
  const q = buildNetworkExamQuestionSet("alice", 3);

  assert.match(q, /네트워크관리사 2급|TCP\/IP|VLAN|DHCP|라우팅/i);
  assert.ok(q.length > 300, `expected long network exam prompt, got ${q.length} chars`);
  assert.ok(q.includes("alice"));
});
