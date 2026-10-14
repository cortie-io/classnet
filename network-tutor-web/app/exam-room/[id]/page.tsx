import { notFound } from "next/navigation";
import { Suspense } from "react";
import { OfficialExamRoom } from "@/components/official-exam/exam-room";

// 공식 모의시험 응시 화면은 사이드바·채팅이 없는 별도 경로에 둔다(시험 중 다른 기능으로 넘어갈 길을 없앤다).
// 요청마다 달라지는 값(params)은 cacheComponents 아래서 Suspense 안에서만 읽을 수 있다.
export default function ExamRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <ExamRoom params={params} />
    </Suspense>
  );
}

async function ExamRoom({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();
  return <OfficialExamRoom examId={Number(id)} />;
}
