import { LearnOverview } from "@/components/textbook/learn-overview";
import { lessonMinutes } from "@/lib/textbook/content";

export const metadata = { title: "교재" };
export default function TextbookPage() {
  return <LearnOverview minutes={lessonMinutes()} />;
}
