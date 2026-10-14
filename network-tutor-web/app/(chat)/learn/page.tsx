import { LearnOverview } from "@/components/textbook/learn-overview";
import { lessonMinutes } from "@/lib/textbook/content";

export const metadata = { title: "처음부터 배우기" };

export default function LearnPage() {
  return <LearnOverview minutes={lessonMinutes()} />;
}
