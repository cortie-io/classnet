import { NextResponse } from "next/server";
import {
  BackendAuthError,
  BackendRequestError,
  callBackend,
} from "@/lib/backend";

// 학생용 공식 모의시험 API 중계. 경로는 아래 형태만 허용한다 — 그 밖의 경로는 백엔드에 보내지도 않는다.
const ALLOWED: { method: "GET" | "POST"; re: RegExp }[] = [
  { method: "GET", re: /^$/ },
  { method: "GET", re: /^active$/ },
  { method: "POST", re: /^\d{1,9}\/start$/ },
  { method: "GET", re: /^\d{1,9}\/result$/ },
  {
    method: "POST",
    re: /^attempts\/\d{1,9}\/(answer|submit|heartbeat|event)$/,
  },
];

function clientIp(request: Request): string | undefined {
  // nginx가 붙이는 실제 접속 IP. 학생이 보낸 값이 섞여 있을 수 있는 X-Forwarded-For는 마지막 홉만 믿는다.
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = request.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",").at(-1)?.trim() : undefined;
}

async function handle(
  request: Request,
  path: string[] | undefined,
  method: "GET" | "POST"
) {
  const joined = (path ?? []).join("/");
  if (!ALLOWED.some((a) => a.method === method && a.re.test(joined))) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 404 });
  }
  try {
    const body =
      method === "POST" ? await request.json().catch(() => ({})) : undefined;
    const data = await callBackend(
      `/api/official-exams${joined ? `/${joined}` : ""}`,
      {
        method,
        body,
        headers: {
          "x-exam-token": request.headers.get("x-exam-token") ?? undefined,
          "x-client-ip": clientIp(request),
          "x-client-user-agent":
            request.headers.get("user-agent")?.slice(0, 300) ?? undefined,
        },
      }
    );
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof BackendAuthError)
      return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof BackendRequestError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status >= 500 ? 502 : err.status }
      );
    }
    return NextResponse.json(
      { error: "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요." },
      { status: 502 }
    );
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  return handle(request, (await params).path, "GET");
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  return handle(request, (await params).path, "POST");
}
