// 모든 LLM/임베딩 호출이 공유하는 fetch 정책. 예전에는 fetch마다 signal이 없어서 undici 기본값(연결 10초,
// 응답 300초)에 그대로 묶였다 — Ollama 서버가 사라지자 질문마다 10초씩 멈춘 뒤 'fetch failed'로 끝났고,
// 느린 OpenAI 응답 하나가 요청을 최대 5분 잡아둘 수도 있었다. 여기서 한 번에 정한다:
//   - 호출 종류별 전체 예산(재시도 포함): embed 4초, fast 45초, accurate 90초
//   - 네트워크 오류·408·409·429·5xx만 최대 2번 재시도(지터, Retry-After 존중). 400/401/403은 재시도 안 함
//   - 실패는 종류(kind)가 있는 LlmError로 던진다 — 호출하는 쪽이 원문 메시지 대신 kind로 판단하게.

export type LlmErrorKind =
  | "timeout"
  | "rate_limit"
  | "auth"
  | "bad_request"
  | "unavailable"
  | "aborted"
  | "not_configured";

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly provider: string;
  readonly status?: number;
  /** 서버 로그용 상세(응답 본문 앞부분, 키는 가림). 학생 화면·감사 로그에는 넣지 않는다. */
  readonly detail?: string;

  constructor(
    kind: LlmErrorKind,
    provider: string,
    message: string,
    opts: { status?: number; detail?: string; cause?: unknown } = {},
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "LlmError";
    this.kind = kind;
    this.provider = provider;
    this.status = opts.status;
    this.detail = opts.detail;
  }
}

export const LLM_TIMEOUT_MS = {
  embed: 4_000,
  fast: 45_000,
  accurate: 90_000,
} as const;

/** 다른 공급자로 넘겨도 되는 실패인지 — 키가 틀렸거나(auth) 요청이 잘못된(bad_request) 경우는 다른 곳에
 * 보내도 소용없거나 원인을 가리게 되므로 넘기지 않는다. */
export function isAvailabilityError(err: unknown): boolean {
  return (
    err instanceof LlmError &&
    (err.kind === "timeout" || err.kind === "rate_limit" || err.kind === "unavailable" || err.kind === "not_configured")
  );
}

/** OpenAI 401 본문에는 키 일부("Incorrect API key provided: sk-proj-...")가 들어 있다 — 로그에도 그대로 남기지 않는다. */
export function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_*.-]{4,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9_*.-]+/gi, "Bearer ***");
}

/** 감사 로그(verification_detail)에 남겨도 되는 짧은 요약 — 응답 본문은 넣지 않는다. */
export function describeLlmError(err: unknown): { kind: string; message: string; status?: number } {
  if (err instanceof LlmError) return { kind: err.kind, message: redactSecrets(err.message), status: err.status };
  if (err instanceof Error) return { kind: "internal", message: redactSecrets(err.message).slice(0, 200) };
  return { kind: "internal", message: redactSecrets(String(err)).slice(0, 200) };
}

function kindForStatus(status: number, body: string): LlmErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 408) return "timeout";
  if (status === 400 || status === 404 || status === 413 || status === 422) return "bad_request";
  if (status >= 500 || status === 409) return "unavailable";
  return body ? "bad_request" : "unavailable";
}

function isRetryable(status: number, body: string): boolean {
  // 429라도 결제 한도 소진(insufficient_quota)은 기다려도 풀리지 않는다.
  if (status === 429) return !body.includes("insufficient_quota");
  return status === 408 || status === 409 || status >= 500;
}

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

function causeSummary(err: unknown): string {
  const cause = (err as { cause?: { code?: string; name?: string; message?: string } })?.cause;
  if (!cause) return err instanceof Error ? err.message : String(err);
  return `${cause.code ?? cause.name ?? "cause"}: ${cause.message ?? ""}`.trim();
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface LlmFetchOptions {
  provider: string;
  /** 로그·에러 메시지에 쓰는 호출 이름(chat, embed 등) */
  label: string;
  /** 재시도까지 포함한 전체 예산 */
  timeoutMs: number;
  signal?: AbortSignal;
  maxRetries?: number;
}

/**
 * fetch + JSON 파싱을 한 예산 안에서 처리한다. 본문을 읽는 도중 타임아웃이 나도 같은 LlmError로 바뀌도록
 * 파싱까지 여기서 한다. 테스트는 globalThis.fetch를 바꿔 끼우면 된다(호출 시점에 읽는다).
 */
export async function llmFetchJson<T>(url: string, init: RequestInit, opts: LlmFetchOptions): Promise<T> {
  const { provider, label } = opts;
  const maxRetries = opts.maxRetries ?? 2;
  const deadline = Date.now() + opts.timeoutMs;

  for (let attempt = 0; ; attempt++) {
    if (opts.signal?.aborted) throw new LlmError("aborted", provider, `${provider} ${label} aborted by caller`);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new LlmError("timeout", provider, `${provider} ${label} timed out after ${opts.timeoutMs}ms`);
    const timeoutSignal = AbortSignal.timeout(remaining);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;

    let failure: LlmError;
    let retryDelay: number | undefined;
    try {
      const res = await globalThis.fetch(url, { ...init, signal });
      if (res.ok) return (await res.json()) as T;
      const body = redactSecrets((await res.text().catch(() => "")).slice(0, 500));
      failure = new LlmError(kindForStatus(res.status, body), provider, `${provider} ${label} failed: HTTP ${res.status}`, {
        status: res.status,
        detail: body,
      });
      if (!isRetryable(res.status, body)) {
        console.warn(`[llm] ${failure.message} — ${body}`);
        throw failure;
      }
      retryDelay = retryAfterMs(res.headers.get("retry-after"));
    } catch (err) {
      if (err instanceof LlmError) throw err;
      if (opts.signal?.aborted) {
        throw new LlmError("aborted", provider, `${provider} ${label} aborted by caller`, { cause: err });
      }
      if (timeoutSignal.aborted) {
        throw new LlmError("timeout", provider, `${provider} ${label} timed out after ${opts.timeoutMs}ms`, { cause: err });
      }
      if (err instanceof SyntaxError) {
        throw new LlmError("unavailable", provider, `${provider} ${label} returned invalid JSON`, { cause: err });
      }
      // 'fetch failed' 자체로는 원인을 알 수 없다 — 실제 원인(ECONNREFUSED, UND_ERR_CONNECT_TIMEOUT 등)은 cause에 있다.
      failure = new LlmError("unavailable", provider, `${provider} ${label} network error (${causeSummary(err)})`, {
        cause: err,
      });
    }

    const backoff = retryDelay ?? 250 * 2 ** attempt + Math.random() * 250;
    // 남은 예산 안에 다시 시도할 여유가 없으면 바로 실패로 돌려준다(예산을 넘겨 기다리지 않는다).
    if (attempt >= maxRetries || Date.now() + backoff + 100 >= deadline) {
      console.warn(`[llm] ${failure.message}${failure.detail ? ` — ${failure.detail}` : ""}`);
      throw failure;
    }
    console.warn(`[llm] ${failure.message} — ${Math.round(backoff)}ms 뒤 재시도(${attempt + 1}/${maxRetries})`);
    try {
      await sleep(backoff, opts.signal);
    } catch {
      throw new LlmError("aborted", provider, `${provider} ${label} aborted by caller`);
    }
  }
}
