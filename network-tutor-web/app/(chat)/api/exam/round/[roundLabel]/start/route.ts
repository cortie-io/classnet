import { NextResponse } from "next/server";
import { callBackend, BackendAuthError } from "@/lib/backend";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roundLabel: string }> }
) {
  const { roundLabel } = await params;
  const { fresh } = await request.json().catch(() => ({}));
  try {
    const data = await callBackend(
      `/api/exam/round/${encodeURIComponent(roundLabel)}/start`,
      { method: "POST", body: { fresh: fresh === true } }
    );
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendAuthError)
      return NextResponse.json({ error: err.message }, { status: 401 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
