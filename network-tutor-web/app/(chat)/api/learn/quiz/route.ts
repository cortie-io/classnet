import { NextResponse } from "next/server";
import {
  BackendAuthError,
  BackendRequestError,
  callBackend,
} from "@/lib/backend";
import { findLesson } from "@/lib/textbook/curriculum";

// 단원 확인 문제 시작 — 단원의 과목·주제어는 클라이언트가 보낸 값이 아니라 목차(curriculum.ts)에서 꺼낸다.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const lesson =
      typeof body?.slug === "string" ? findLesson(body.slug) : null;
    if (!lesson?.quiz)
      return NextResponse.json(
        { error: "확인 문제가 없는 단원입니다." },
        { status: 400 }
      );
    const data = await callBackend("/api/learn/quiz", {
      method: "POST",
      body: {
        slug: lesson.slug,
        topic: lesson.quiz.topic,
        terms: lesson.quiz.terms,
        title: lesson.title,
      },
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendAuthError)
      return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof BackendRequestError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
