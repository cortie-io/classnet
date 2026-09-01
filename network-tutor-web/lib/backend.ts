import "server-only";
import { auth } from "@/app/(auth)/auth";

const BACKEND_URL = process.env.BACKEND_API_URL ?? "http://127.0.0.1:3300";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "";

export class BackendAuthError extends Error {}

/** network-tutor-server의 /api/* 를 서버 간 신뢰 호출로 대신 부른다(브라우저는 이 시크릿을 절대 보지 못한다). */
export async function callBackend<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const session = await auth();
  if (!session?.user) throw new BackendAuthError("로그인이 필요합니다.");

  const method = init.method ?? "GET";
  const isBodyless = method === "GET" || method === "HEAD";
  // fetch()는 GET/HEAD에 body를 허용하지 않는다 — 이 경우 userId를 쿼리스트링으로 대신 전달한다
  // (Express 쪽 attachUser가 internal-secret 경로에서 query.userId도 body.userId와 동일하게 본다).
  const url = isBodyless
    ? `${BACKEND_URL}${path}${path.includes("?") ? "&" : "?"}userId=${session.user.id}`
    : `${BACKEND_URL}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": INTERNAL_SECRET,
    },
    body: isBodyless ? undefined : JSON.stringify({ ...(init.body as object | undefined), userId: Number(session.user.id) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error ?? `backend request failed (${res.status})`);
    throw err;
  }
  return data as T;
}

export async function requireSessionUser() {
  const session = await auth();
  if (!session?.user) throw new BackendAuthError("로그인이 필요합니다.");
  return session.user;
}
