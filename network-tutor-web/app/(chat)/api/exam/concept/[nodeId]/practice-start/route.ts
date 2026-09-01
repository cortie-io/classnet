import { NextResponse } from "next/server";
import { callBackend, BackendAuthError } from "@/lib/backend";

export async function POST(request: Request, { params }: { params: Promise<{ nodeId: string }> }) {
  const { nodeId } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const data = await callBackend(`/api/exam/concept/${nodeId}/practice-start`, { method: "POST", body });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
