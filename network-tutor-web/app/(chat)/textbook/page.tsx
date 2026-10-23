import { LearnOverview } from "@/components/textbook/learn-overview";
import { lessonMinutes } from "@/lib/textbook/content";

export const metadata = { title: "단계별 학습하기" };
export default function TextbookPage() {
  return <LearnOverview minutes={lessonMinutes()} />;
}
