import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getServiceLaunchStage } from "@/lib/db/queries";
export async function GET() {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json(
      { error: "로그인이 필요합니다." },
      { status: 401 }
    );
  return NextResponse.json(
    { stage: await getServiceLaunchStage() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
