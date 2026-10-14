import assert from "node:assert/strict";
import { test } from "node:test";
import { networkTutorModel } from "./network-tutor-model";

test("practice follow-ups retain attempt identity while internal audit markers stay out of model history", async () => {
  const previous = globalThis.fetch;
  let sent: any;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({
      answer: "Next answer",
      auditLogId: 42,
      intent: "explain",
      verificationStatus: "verified",
      confidence: 1,
    });
  };
  try {
    const result = await (networkTutorModel as any).doGenerate({
      providerOptions: {
        networkTutor: { userId: 2, level: "beginner", useOwnKey: false },
      },
      prompt: [
        { role: "user", content: [{ type: "text", text: "TCP 문제 내줘" }] },
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: 'TCP 문제\n\n<!--AUDIT_LOG_ID:987-->\n\n<!--PRACTICE_ATTEMPT:{"attemptId":51,"questions":[{"stem":"TCP?","choices":["A","B"]}]}-->',
            },
          ],
        },
        { role: "user", content: [{ type: "text", text: "다른 문제 줘" }] },
      ],
    });
    assert.match(sent.history[1].content, /연습 #51/);
    assert.doesNotMatch(sent.history[1].content, /AUDIT_LOG_ID/);
    assert.match(result.content[0].text, /AUDIT_LOG_ID:42/);
  } finally {
    globalThis.fetch = previous;
  }
});

test("an active-exam refusal reaches the student as a readable message", async () => {
  const previous = globalThis.fetch;
  const log = console.error;
  console.error = () => {};
  globalThis.fetch = async () =>
    Response.json(
      { error: "시험 응시 중에는 다른 기능을 사용할 수 없어요." },
      { status: 423 }
    );
  try {
    const result = await (networkTutorModel as any).doGenerate({
      providerOptions: {
        networkTutor: { userId: 2, level: "beginner", useOwnKey: false },
      },
      prompt: [
        { role: "user", content: [{ type: "text", text: "TCP 설명해줘" }] },
      ],
    });
    assert.equal(
      result.content[0].text,
      "시험 응시 중에는 다른 기능을 사용할 수 없어요."
    );
  } finally {
    globalThis.fetch = previous;
    console.error = log;
  }
});
