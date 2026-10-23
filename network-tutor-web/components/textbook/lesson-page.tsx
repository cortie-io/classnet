import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ClockIcon,
  GraduationCapIcon,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadLesson } from "@/lib/textbook/content";
import { ALL_LESSONS, findLesson, neighbors } from "@/lib/textbook/curriculum";
import { HeadingList, LessonBody } from "./lesson-body";
import { LessonFlow } from "./lesson-flow";
import { ReadTracker } from "./read-tracker";

// 교재 본문과 단원 확인 문제·완료 흐름을 한 화면에서 제공한다.
export function LessonPage({ slug }: { slug: string }) {
  const lesson = findLesson(slug);
  const parsed = lesson ? loadLesson(slug) : null;
  if (!lesson || !parsed) notFound();
  const { prev, next } = neighbors(slug);
  const base = "/textbook";
  const partLessons = lesson.part.lessons;

  return (
    <div className="mx-auto flex w-full max-w-6xl gap-10 px-4 py-8 md:px-8">
      <article className="mx-auto w-full min-w-0 max-w-[46rem] flex-1">
        <nav className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <Link className="hover:text-primary" href={base}>
            단계별 학습하기
          </Link>
          <span>/</span>
          <span>
            {lesson.part.label} {lesson.part.title}
          </span>
        </nav>

        <header className="mt-3 border-border border-b pb-6">
          {
            <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 font-semibold text-[12px] text-primary">
              <GraduationCapIcon className="size-3.5" />
              STEP {lesson.index + 1} / {ALL_LESSONS.length}
            </p>
          }
          <h1 className="font-bold text-[28px] leading-tight tracking-[-0.04em] md:text-[32px]">
            {lesson.title}
          </h1>
          <p className="mt-2 text-[14.5px] text-muted-foreground">
            {lesson.summary}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <ClockIcon className="size-3.5" />
              읽는 시간 약 {parsed.minutes}분
            </span>
            <span>
              단원 {lesson.index + 1} / {ALL_LESSONS.length}
            </span>
          </div>
        </header>

        <div className="mt-8">
          <LessonBody segments={parsed.segments} />
        </div>

        <LessonFlow
          hasQuiz={Boolean(lesson.quiz)}
          next={next ? { slug: next.slug, title: next.title } : null}
          slug={slug}
        />

        <nav className="mt-10 grid gap-3 sm:grid-cols-2">
          {prev ? (
            <Link
              className="group rounded-2xl border border-border bg-card px-4 py-3.5 transition-colors hover:border-primary/40"
              href={`${base}/${prev.slug}`}
            >
              <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
                <ArrowLeftIcon className="size-3.5" />
                이전 단원
              </span>
              <span className="mt-1 block font-semibold text-[14px] group-hover:text-primary">
                {prev.title}
              </span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              className="group rounded-2xl border border-border bg-card px-4 py-3.5 text-right transition-colors hover:border-primary/40"
              href={`${base}/${next.slug}`}
            >
              <span className="flex items-center justify-end gap-1 text-[12px] text-muted-foreground">
                다음 단원
                <ArrowRightIcon className="size-3.5" />
              </span>
              <span className="mt-1 block font-semibold text-[14px] group-hover:text-primary">
                {next.title}
              </span>
            </Link>
          ) : null}
        </nav>
        <ReadTracker slug={slug} />
      </article>

      <aside className="hidden w-56 shrink-0 self-stretch xl:block">
        <div className="sticky top-6 max-h-[calc(100dvh-3rem)] space-y-6 overflow-y-auto overscroll-contain pb-4">
          <div>
            <p className="mb-2 font-semibold text-[12px] text-foreground">
              이 단원에서
            </p>
            <HeadingList headings={parsed.headings} />
          </div>
          <div>
            <p className="mb-2 font-semibold text-[12px] text-foreground">
              {lesson.part.label} {lesson.part.title}
            </p>
            <ul className="space-y-0.5">
              {partLessons.map((l) => (
                <li key={l.slug}>
                  <Link
                    className={
                      l.slug === slug
                        ? "block truncate rounded-md bg-accent px-2 py-1 font-semibold text-[12.5px] text-primary"
                        : "block truncate rounded-md px-2 py-1 text-[12.5px] text-muted-foreground hover:text-primary"
                    }
                    href={`${base}/${l.slug}`}
                  >
                    {l.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>
    </div>
  );
}
