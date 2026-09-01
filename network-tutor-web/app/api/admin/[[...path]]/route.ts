import { NextResponse } from "next/server";
import { callAdminBackend, AdminAuthError } from "@/lib/adminBackend";

// network-tutor-server의 /api/admin/* 전체를 범용으로 중계한다 — 관리자 엔드포인트가 많아서(학생
// 관리·문제 검수·시험 관리) 하나하나 라우트 파일을 만들면 사실상 같은 코드가 반복될 뿐이라
// catch-all로 통일했다. 실제 권한 검사·백엔드 호출 로직은 lib/adminBackend.ts 한 곳에만 있다.
async function handle(request: Request, path: string[] | undefined, method: string) {
  const search = new URL(request.url).search;
  const backendPath = `/api/admin/${(path ?? []).join("/")}${search}`;
  try {
    const body = method === "GET" || method === "HEAD" ? undefined : await request.json().catch(() => ({}));
    const data = await callAdminBackend(backendPath, { method, body });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof AdminAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  return handle(request, (await params).path, "GET");
}
export async function POST(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  return handle(request, (await params).path, "POST");
}
export async function PATCH(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  return handle(request, (await params).path, "PATCH");
}
export async function DELETE(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  return handle(request, (await params).path, "DELETE");
}
