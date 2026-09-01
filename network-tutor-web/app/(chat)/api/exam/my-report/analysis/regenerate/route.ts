import { NextResponse } from "next/server";
import { callBackend, BackendAuthError } from "@/lib/backend";

export async function POST() {
  try {
    const data = await callBackend("/api/exam/my-report/analysis/regenerate", { method: "POST" });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
