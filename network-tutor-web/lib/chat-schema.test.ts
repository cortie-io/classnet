import assert from "node:assert/strict";
import { test } from "node:test";
import { postRequestBodySchema } from "../app/(chat)/api/chat/schema";

const message = {
  id: "00000000-0000-4000-8000-000000000002",
  role: "user",
  parts: [{ type: "text", text: "이 문제를 설명해 주세요." }],
};
const payload = {
  id: "00000000-0000-4000-8000-000000000001",
  message,
  selectedChatModel: "network-tutor-gemma",
  selectedVisibilityType: "private",
};

test("chat accepts uploaded data images and refuses URLs that the model SDK could fetch", () => {
  const withFile = (url: string) => ({
    ...payload,
    message: {
      ...message,
      parts: [
        ...message.parts,
        { type: "file", name: "question.png", mediaType: "image/png", url },
      ],
    },
  });
  assert.ok(
    postRequestBodySchema.safeParse(
      withFile("data:image/png;base64,iVBORw0KGgo=")
    ).success
  );
  for (const url of [
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1:3300/admin",
    "https://example.com/question.png",
    "file:///etc/passwd",
  ]) {
    assert.equal(postRequestBodySchema.safeParse(withFile(url)).success, false);
  }
});

test("chat accepts only a new user message and configured model identifiers", () => {
  assert.ok(postRequestBodySchema.safeParse(payload).success);
  assert.equal(
    postRequestBodySchema.safeParse({
      ...payload,
      message: { ...message, role: "assistant" },
    }).success,
    false
  );
  assert.equal(
    postRequestBodySchema.safeParse({
      ...payload,
      message: undefined,
      messages: [message],
    }).success,
    false
  );
  assert.equal(
    postRequestBodySchema.safeParse({
      ...payload,
      selectedChatModel: "unconfigured-model",
    }).success,
    false
  );
});
