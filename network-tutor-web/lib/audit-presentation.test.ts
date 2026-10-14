import assert from "node:assert/strict";
import { test } from "node:test";
import {
  auditJsonReplacer,
  auditStatusLabel,
  displayAuditIntent,
} from "./audit-presentation";

test("presentation removes internal labels while preserving dialogue and the source record", () => {
  const original = {
    id: 42,
    question: "question",
    final_answer: "answer",
    intent: "token_burn_test",
    verification_detail: {
      synthetic_demo: true,
      demo_source: "token_burn_test",
      existing: "keep",
    },
  };
  const displayed = JSON.parse(JSON.stringify(original, auditJsonReplacer));
  assert.deepEqual(displayed, {
    id: 42,
    question: "question",
    final_answer: "answer",
    verification_detail: { existing: "keep" },
  });
  assert.equal(original.intent, "token_burn_test");
  assert.equal(original.verification_detail.synthetic_demo, true);
  assert.equal(displayAuditIntent("token_burn_test"), "");
  assert.equal(displayAuditIntent("calc"), "calc");
  assert.equal(auditStatusLabel("verified"), "자동 확인");
});
