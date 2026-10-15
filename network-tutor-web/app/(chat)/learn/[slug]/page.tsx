import { redirect, notFound } from "next/navigation";
import { findLesson } from "@/lib/textbook/curriculum";
export default async function LearnLessonPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!findLesson(slug)) notFound();
  redirect(`/textbook/${slug}`);
}
