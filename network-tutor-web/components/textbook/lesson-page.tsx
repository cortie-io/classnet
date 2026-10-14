import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ClockIcon,
  GraduationCapIcon,
  LibraryBigIcon,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadLesson } from "@/lib/textbook/content";
import { ALL_LESSONS, findLesson, neighbors } from "@/lib/textbook/curriculum";
import { HeadingList, LessonBody } from "./lesson-body";
import { LessonFlow } from "./lesson-flow";
import { ReadTracker } from "./read-tracker";

// 교재 읽기(/textbook/[slug])와 처음부터 배우기(/learn/[slug])가 같은 본문 화면을 쓴다.
// 배우기 쪽은 맨 아래에 확인 문제·완료 흐름이 붙고, 이전·다음 이동이 학습 경로 안에서 이어진다.
export function LessonPage({
  slug,
  mode,
}: {
  slug: string;
  mode: "read" | "learn";
}) {
  const lesson = findLesson(slug);
  const parsed = lesson ? loadLesson(slug) : null;
  if (!lesson || !parsed) notFound();
  const { prev, next } = neighbors(slug);
  const base = mode === "learn" ? "/learn" : "/textbook";
  const partLessons = lesson.part.lessons;

  return (
    <div className="mx-auto flex w-full max-w-6xl gap-10 px-4 py-8 md:px-8">
      <article className="mx-auto w-full min-w-0 max-w-[46rem] flex-1">
        <nav className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <Link className="hover:text-primary" href={base}>
            {mode === "learn" ? "처음부터 배우기" : "교재"}
          </Link>
          <span>/</span>
          <span>
            {lesson.part.label} {lesson.part.title}
          </span>
        </nav>

        <header className="mt-3 border-border border-b pb-6">
          {mode === "learn" ? (
            <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 font-semibold text-[12px] text-primary">
              <GraduationCapIcon className="size-3.5" />
              STEP {lesson.index + 1} / {ALL_LESSONS.length}
            </p>
          ) : null}
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
            {mode === "read" ? (
              <Link
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                href={`/learn/${slug}`}
              >
                <GraduationCapIcon className="size-3.5" />
                학습 경로에서 보기
              </Link>
            ) : (
              <Link
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                href={`/textbook/${slug}`}
              >
                <LibraryBigIcon className="size-3.5" />
                교재로 보기
              </Link>
            )}
          </div>
        </header>

        <div className="mt-8">
          <LessonBody segments={parsed.segments} />
        </div>

        {mode === "learn" ? (
          <LessonFlow
            hasQuiz={Boolean(lesson.quiz)}
            next={next ? { slug: next.slug, title: next.title } : null}
            slug={slug}
          />
        ) : (
          <div className="mt-12 rounded-2xl border border-primary/15 bg-brand-soft px-5 py-4">
            <p className="font-semibold text-[14px]">이 단원을 다 읽었다면</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {lesson.quiz
                ? "학습 경로에서 확인 문제를 풀고 완료로 표시해 보세요."
                : "학습 경로에서 완료로 표시하고 다음 단원으로 넘어가세요."}
            </p>
            <Link
              className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand px-3.5 font-semibold text-[13px] text-white"
              href={`/learn/${slug}`}
            >
              {lesson.quiz ? "확인 문제 풀기" : "완료하러 가기"}
              <ArrowRightIcon className="size-3.5" />
            </Link>
          </div>
        )}

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

      <aside className="hidden w-56 shrink-0 xl:block">
        <div className="sticky top-20 space-y-6">
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
