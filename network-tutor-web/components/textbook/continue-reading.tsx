"use client";

import { BookOpenIcon } from "lucide-react";
import Link from "next/link";
import { ALL_LESSONS, findLesson } from "@/lib/textbook/curriculum";
import { useLearnProgress } from "./use-learn-progress";

// 교재 첫 화면의 "이어 읽기" — 마지막으로 연 단원, 처음이면 첫 단원.
export function ContinueReading() {
  const { progress } = useLearnProgress();
  const last = progress?.lastSlug ? findLesson(progress.lastSlug) : null;
  const target = last ?? ALL_LESSONS[0];
  return (
    <Link
      className="inline-flex h-10 max-w-full items-center gap-1.5 rounded-xl bg-brand px-4 font-semibold text-[13.5px] text-white shadow-[var(--shadow-brand)] transition-opacity hover:opacity-90"
      href={`/textbook/${target.slug}`}
    >
      <BookOpenIcon className="size-4 shrink-0" />
      <span className="truncate">
        {last ? `이어 읽기 · ${target.title}` : "첫 단원부터 읽기"}
      </span>
    </Link>
  );
}
