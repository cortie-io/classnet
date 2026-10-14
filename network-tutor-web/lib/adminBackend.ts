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
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const session = await auth();
  if (!session?.user) throw new AdminAuthError("로그인이 필요합니다.", 401);
  if (session.user.role !== "admin")
    throw new AdminAuthError("관리자만 접근할 수 있습니다.", 403);

  const method = init.method ?? "GET";
  const isBodyless = method === "GET" || method === "HEAD";
  // 경로는 /api/admin/… 또는 /api/audit… 안에서만, 각 칸은 영문·숫자·-·_만 허용한다(경로 이동으로 다른 API에
  // 닿지 않게). userId는 마지막에 덮어써서 요청자 값만 남긴다.
  const q = path.indexOf("?");
  const pathname = q === -1 ? path : path.slice(0, q);
  if (
    !/^\/api\/(admin|audit|audit-summary)(\/[A-Za-z0-9_-]+)*\/?$/.test(pathname)
  ) {
    throw new AdminAuthError("잘못된 요청 경로입니다.", 400);
  }
  const url = new URL(pathname, BACKEND_URL);
  for (const [k, v] of new URLSearchParams(q === -1 ? "" : path.slice(q + 1)))
    url.searchParams.append(k, v);
  if (isBodyless) url.searchParams.set("userId", String(session.user.id));
  else url.searchParams.delete("userId");

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": INTERNAL_SECRET,
    },
    body: isBodyless
      ? undefined
      : JSON.stringify({
          ...(init.body as object | undefined),
          userId: Number(session.user.id),
        }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new AdminAuthError(
      typeof data?.error === "string"
        ? data.error
        : `요청을 처리하지 못했어요 (${res.status})`,
      res.status >= 500 ? 502 : res.status
    );
  return data as T;
}
