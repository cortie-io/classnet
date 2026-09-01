import { NextResponse } from "next/server";
import { callBackend, BackendAuthError } from "@/lib/backend";

export async function POST(_request: Request, { params }: { params: Promise<{ nodeId: string }> }) {
  const { nodeId } = await params;
  try {
    const data = await callBackend(`/api/bookmarks/${nodeId}`, { method: "POST", body: {} });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ nodeId: string }> }) {
  const { nodeId } = await params;
  try {
    const data = await callBackend(`/api/bookmarks/${nodeId}`, { method: "DELETE" });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
