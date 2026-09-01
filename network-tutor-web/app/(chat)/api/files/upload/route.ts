import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";

// Vercel Blob 대신 data URI로 응답한다 — 별도 오브젝트 스토리지 없이 자체 서버에 배포하기 위한
// 가장 단순한 방법이고(디스크 쓰기·공개 URL 관리 불필요), 이후 모델 호출 시에도 base64를
// 그대로 우리 백엔드(Ollama vision)에 넘길 수 있어 변환 단계가 하나 줄어든다.
// 학교 파일럿 규모(가끔 사진 첨부 질문)에서는 DB에 base64로 저장되는 비용도 무시할 만하다.
const FileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size <= 5 * 1024 * 1024, {
      message: "File size should be less than 5MB",
    })
    .refine((file) => ["image/jpeg", "image/png"].includes(file.type), {
      message: "File type should be JPEG or PNG",
    }),
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (request.body === null) {
    return new Response("Request body is empty", { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as Blob;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const validatedFile = FileSchema.safeParse({ file });

    if (!validatedFile.success) {
      const errorMessage = validatedFile.error.issues
        .map((error) => error.message)
        .join(", ");

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const filename = (formData.get("file") as File).name;
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const base64 = fileBuffer.toString("base64");

    return NextResponse.json({
      contentType: file.type,
      pathname: filename,
      url: `data:${file.type};base64,${base64}`,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
