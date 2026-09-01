import { NextResponse } from "next/server";
import { callBackend, BackendAuthError } from "@/lib/backend";

export async function POST(_request: Request, { params }: { params: Promise<{ examSetId: string }> }) {
  const { examSetId } = await params;
  try {
    const data = await callBackend(`/api/exam/timed/${examSetId}/start`, { method: "POST", body: {} });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
