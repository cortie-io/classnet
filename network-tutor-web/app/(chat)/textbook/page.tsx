import { BookOpenTextIcon, GraduationCapIcon } from "lucide-react";
import Link from "next/link";
import { ContinueReading } from "@/components/textbook/continue-reading";
import { TextbookToc } from "@/components/textbook/textbook-toc";
import { lessonMinutes } from "@/lib/textbook/content";
import { ALL_LESSONS, CURRICULUM } from "@/lib/textbook/curriculum";

export const metadata = { title: "교재" };

export default function TextbookPage() {
  const minutes = lessonMinutes();
  const totalHours = Math.round(
    Object.values(minutes).reduce((a, b) => a + b, 0) / 60
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 md:px-8">
      <section className="relative overflow-hidden rounded-[1.375rem] border border-primary/15 bg-brand-soft px-6 py-7 md:px-8">
        <div className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-brand opacity-[0.12] blur-3xl" />
        <div className="flex items-start gap-4">
          <div className="hidden size-14 shrink-0 items-center justify-center rounded-2xl bg-brand text-white shadow-[var(--shadow-brand)] sm:flex">
            <BookOpenTextIcon className="size-7" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-[12.5px] text-primary">
              classnet 교재
            </p>
            <h1 className="mt-1 font-bold text-[24px] tracking-[-0.035em] md:text-[26px]">
              네트워크관리사 2급 필기
            </h1>
            <p className="mt-2 max-w-xl text-[14px] text-muted-foreground leading-relaxed">
              처음 공부하는 사람도 따라올 수 있게 기초부터 차근차근 썼어요.
              모르는 개념이 나오면 언제든 펼쳐 보세요.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-[12.5px] text-muted-foreground">
              <span className="rounded-full bg-background/80 px-3 py-1">
                {CURRICULUM.length}부 · {ALL_LESSONS.length}단원
              </span>
              <span className="rounded-full bg-background/80 px-3 py-1">
                전체 약 {totalHours}시간 분량
              </span>
              <span className="rounded-full bg-background/80 px-3 py-1">
                단원마다 핵심 정리·확인 문제
              </span>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <ContinueReading />
              <Link
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-background px-4 font-semibold text-[13.5px] transition-colors hover:bg-accent"
                href="/learn"
              >
                <GraduationCapIcon className="size-4" />
                처음부터 순서대로 배우기
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-8">
        <TextbookToc minutes={minutes} />
      </div>
    </div>
  );
}
