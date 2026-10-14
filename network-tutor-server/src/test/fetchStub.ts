// 테스트에서 바깥 호출(OpenAI·Ollama)을 대신하는 가짜 fetch. setupEnv.ts가 기본으로 막아 둔 fetch를
// 잠시 바꿔 끼우고, 끝나면 되돌린다. 실제 네트워크로는 아무것도 나가지 않는다.

export interface FetchCall {
	url: string;
	method: string;
	body: unknown;
	headers: Record<string, string>;
}

export type FetchHandler = (
	call: FetchCall,
	init: RequestInit,
) => Response | Promise<Response>;

export function jsonResponse(
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

/** OpenAI chat completions 응답 모양. */
export function chatCompletion(content: string): Response {
	return jsonResponse({
		choices: [{ message: { content }, finish_reason: "stop" }],
	});
}

/** OpenAI embeddings 응답 모양. */
export function embeddingResponse(vectors: number[][]): Response {
	return jsonResponse({
		data: vectors.map((embedding, index) => ({ index, embedding })),
	});
}

export function stubFetch(handler: FetchHandler): {
	calls: FetchCall[];
	restore: () => void;
} {
	const previous = globalThis.fetch;
	const calls: FetchCall[] = [];
	globalThis.fetch = (async (
		input: string | URL | Request,
		init: RequestInit = {},
	) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		let body: unknown = init.body;
		if (typeof init.body === "string") {
			try {
				body = JSON.parse(init.body);
			} catch {
				body = init.body;
			}
		}
		const headers = Object.fromEntries(new Headers(init.headers).entries());
		const call: FetchCall = {
			url,
			method: init.method ?? "GET",
			body,
			headers,
		};
		calls.push(call);
		if (init.signal?.aborted) throw init.signal.reason;
		return handler(call, init);
	}) as typeof fetch;
	return {
		calls,
		restore: () => {
			globalThis.fetch = previous;
		},
	};
}

/** abort 신호가 올 때까지 끝나지 않는 응답 — 타임아웃 시험용. 실제 소켓처럼 이벤트 루프를 붙잡아 둔다
 * (AbortSignal.timeout의 타이머는 unref라, 붙잡는 게 없으면 테스트 프로세스가 먼저 끝나 버린다). */
export function hangUntilAborted(init: RequestInit): Promise<Response> {
	return new Promise((_, reject) => {
		const signal = init.signal;
		if (!signal) return;
		const keepAlive = setInterval(() => {}, 1_000);
		signal.addEventListener(
			"abort",
			() => {
				clearInterval(keepAlive);
				reject(signal.reason);
			},
			{ once: true },
		);
	});
}
