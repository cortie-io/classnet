import "server-only";
import { auth } from "@/app/(auth)/auth";

const BACKEND_URL = process.env.BACKEND_API_URL ?? "http://127.0.0.1:3300";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "";

export class AdminAuthError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

/** network-tutor-server의 /api/admin/* 를 서버 간 신뢰 호출로 대신 부른다. 관리자 세션이 아니면 거부한다. */
export async function callAdminBackend<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const session = await auth();
  if (!session?.user) throw new AdminAuthError("로그인이 필요합니다.", 401);
  if (session.user.role !== "admin") throw new AdminAuthError("관리자만 접근할 수 있습니다.", 403);

  const method = init.method ?? "GET";
  const isBodyless = method === "GET" || method === "HEAD";
  const url = isBodyless
    ? `${BACKEND_URL}${path}${path.includes("?") ? "&" : "?"}userId=${session.user.id}`
    : `${BACKEND_URL}${path}`;

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "x-internal-secret": INTERNAL_SECRET },
    body: isBodyless ? undefined : JSON.stringify({ ...(init.body as object | undefined), userId: Number(session.user.id) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `backend request failed (${res.status})`);
  return data as T;
}
