import { NextResponse } from "next/server";
import {
  BackendAuthError,
  BackendRequestError,
  callBackend,
} from "@/lib/backend";

// 처음부터 배우기 · 교재 읽기 기록 — 서버(/api/learn/progress)로 그대로 넘긴다.
function errorResponse(err: unknown) {
  if (err instanceof BackendAuthError)
    return NextResponse.json({ error: err.message }, { status: 401 });
  if (err instanceof BackendRequestError)
    return NextResponse.json({ error: err.message }, { status: err.status });
  return NextResponse.json(
    { error: err instanceof Error ? err.message : String(err) },
    { status: 400 }
  );
}

export async function GET() {
  try {
    return NextResponse.json(await callBackend("/api/learn/progress"));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { slug, action, attemptId } = body ?? {};
    return NextResponse.json(
      await callBackend("/api/learn/progress", {
        method: "POST",
        body: { slug, action, attemptId },
      })
    );
  } catch (err) {
    return errorResponse(err);
  }
}
