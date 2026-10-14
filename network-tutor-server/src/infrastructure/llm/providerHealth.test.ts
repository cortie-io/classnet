import assert from "node:assert/strict";
import { test } from "node:test";
import {
	assessChatHealth,
	chatHealth,
	recordChatHealth,
} from "./providerHealth.js";

test("a configured key is not reported as verified healthy until a call succeeds", () => {
	assert.deepEqual(assessChatHealth(chatHealth(["openai"])), {
		available: true,
		degraded: true,
	});
	recordChatHealth("school-key");
	assert.deepEqual(assessChatHealth(chatHealth(["openai"])), {
		available: true,
		degraded: false,
	});
	recordChatHealth("student-key", "auth");
	assert.equal(chatHealth(["openai"])[0].state, "healthy");
});

test("shared credential failures block readiness; availability failures can use a healthy fallback", () => {
	recordChatHealth("school-key", "auth");
	recordChatHealth("ollama");
	assert.equal(
		assessChatHealth(chatHealth(["openai", "ollama"])).available,
		false,
	);
	recordChatHealth("school-key", "timeout");
	assert.deepEqual(assessChatHealth(chatHealth(["openai", "ollama"])), {
		available: true,
		degraded: true,
	});
	recordChatHealth("ollama", "unavailable");
	assert.equal(
		assessChatHealth(chatHealth(["openai", "ollama"])).available,
		false,
	);
});
