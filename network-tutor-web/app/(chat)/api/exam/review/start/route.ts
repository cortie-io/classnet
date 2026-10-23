import { NextResponse } from "next/server";
import { BackendAuthError, callBackend } from "@/lib/backend";

export async function POST() {
  try {
    const data = await callBackend("/api/exam/review/start", {
      body: {},
      method: "POST",
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendAuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
