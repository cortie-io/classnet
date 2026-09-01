import { NextResponse } from "next/server";
import { callBackend, BackendAuthError } from "@/lib/backend";

// URL을 /api/audit/:id/report로 그대로 안 쓰는 이유: app/api/audit/[[...path]]가 이미 관리자 전용
// 감사로그 중계(catch-all)로 같은 경로를 쓰고 있어서, 학생용 신고 액션은 겹치지 않는 별도 경로로 뺐다.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const data = await callBackend(`/api/audit/${id}/report`, { method: "POST", body: {} });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
