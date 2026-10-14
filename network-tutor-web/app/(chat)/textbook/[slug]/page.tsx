import type { Metadata } from "next";
import { Suspense } from "react";
import { LessonPage } from "@/components/textbook/lesson-page";
import { ALL_LESSONS, findLesson } from "@/lib/textbook/curriculum";

// 단원은 빌드할 때 모두 미리 만든다(본문은 저장소의 content/textbook/*.md).
export function generateStaticParams() {
  return ALL_LESSONS.map((l) => ({ slug: l.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const lesson = findLesson(slug);
  return { title: lesson ? `${lesson.title} · 교재` : "교재" };
}

export default function TextbookLessonPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <Lesson params={params} />
    </Suspense>
  );
}

async function Lesson({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <LessonPage mode="read" slug={slug} />;
}
