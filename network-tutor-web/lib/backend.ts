import "server-only";
import { auth } from "@/app/(auth)/auth";

const BACKEND_URL = process.env.BACKEND_API_URL ?? "http://127.0.0.1:3300";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "";

export class BackendAuthError extends Error {}

/**
 * 백엔드 URL을 안전하게 만든다. 라우트 파라미터는 Next가 디코딩한 값이라 `../`, `?`, `#`가 섞여 들어올 수 있다
 * — 그대로 이어 붙이면 다른 경로(관리자 API)로 새거나 `?userId=`를 끼워 넣어 다른 사용자로 행세할 수 있었다.
 * 경로 이동(`.`/`..`, 인코딩된 점·슬래시)은 거절하고, userId는 마지막에 덮어써서 요청자 값만 남게 한다.
 */
function backendUrl(path: string, userId?: string): URL {
  const q = path.indexOf("?");
  const pathname = q === -1 ? path : path.slice(0, q);
  const search = q === -1 ? "" : path.slice(q + 1);
  if (
    !pathname.startsWith("/api/") ||
    /[#\\]|%2e|%2f|%5c/i.test(pathname) ||
    pathname.split("/").some((seg) => seg === "." || seg === "..")
  ) {
    throw new Error("잘못된 요청 경로입니다.");
  }
  const url = new URL(pathname, BACKEND_URL);
  for (const [k, v] of new URLSearchParams(search)) url.searchParams.append(k, v);
  if (userId !== undefined) url.searchParams.set("userId", userId);
  return url;
}

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
  const url = backendUrl(path, String(session.user.id)); // POST도 쿼리에 끼워 넣은 userId가 남지 않게 덮어쓴다

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
