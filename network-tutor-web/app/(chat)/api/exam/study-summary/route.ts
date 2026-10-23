import { NextResponse } from "next/server";
import { BackendAuthError, callBackend } from "@/lib/backend";

export async function GET() {
  try {
    const data = await callBackend("/api/exam/study-summary");
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendAuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
