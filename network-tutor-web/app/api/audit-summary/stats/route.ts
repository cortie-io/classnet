import { NextResponse } from "next/server";
import { callAdminBackend, AdminAuthError } from "@/lib/adminBackend";

export async function GET() {
  try {
    const data = await callAdminBackend("/api/audit-summary/stats");
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof AdminAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
