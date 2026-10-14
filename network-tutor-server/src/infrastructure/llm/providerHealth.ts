import type { ChatProviderName } from "./types.js";
import type { LlmErrorKind } from "./http.js";

export type ProviderLabel = "school-key" | "student-key" | "ollama";

export interface ProviderHealth {
	provider: ChatProviderName;
	state: "unknown" | "healthy" | "unavailable";
	checkedAt?: string;
	errorKind?: LlmErrorKind;
}

const results = new Map<ChatProviderName, ProviderHealth>();

/** A personal key failure must never change the shared provider's health. */
export function recordChatHealth(
	label: ProviderLabel,
	errorKind?: LlmErrorKind,
): void {
	if (label === "student-key") return;
	const provider = label === "school-key" ? "openai" : "ollama";
	results.set(provider, {
		provider,
		state: errorKind ? "unavailable" : "healthy",
		checkedAt: new Date().toISOString(),
		...(errorKind ? { errorKind } : {}),
	});
}

export function chatHealth(providers: ChatProviderName[]): ProviderHealth[] {
	return providers.map(
		(provider) => results.get(provider) ?? { provider, state: "unknown" },
	);
}

export function assessChatHealth(states: ProviderHealth[]): {
	available: boolean;
	degraded: boolean;
} {
	// Auth/request errors deliberately do not fall back to a different provider.
	const primary = states[0];
	const blocked =
		primary?.state === "unavailable" &&
		(primary.errorKind === "auth" || primary.errorKind === "bad_request");
	return {
		available:
			!blocked && states.some((state) => state.state !== "unavailable"),
		degraded: states.some((state) => state.state !== "healthy"),
	};
}
