import { NextResponse } from "next/server";
import { callAdminBackend, AdminAuthError } from "@/lib/adminBackend";

// /api/audit, /api/audit/:id, /api/audit/:id/review 등 감사로그 계열(관리자 전용)을 중계한다.
async function handle(request: Request, path: string[] | undefined, method: string) {
  const search = new URL(request.url).search;
  const backendPath = `/api/audit/${(path ?? []).join("/")}${search}`;
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
