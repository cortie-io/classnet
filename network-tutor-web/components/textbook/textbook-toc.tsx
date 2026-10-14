"use client";

import { CheckCircle2Icon, ClockIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { CURRICULUM } from "@/lib/textbook/curriculum";
import { cn } from "@/lib/utils";
import { useLearnProgress } from "./use-learn-progress";

// 교재 첫 화면의 목차. 단원 제목·범위로 찾을 수 있고, 다 읽은(끝낸) 단원에는 표시가 붙는다.
export function TextbookToc({
  minutes,
  basePath = "/textbook",
}: {
  minutes: Record<string, number>;
  basePath?: string;
}) {
  const [query, setQuery] = useState("");
  const { bySlug } = useLearnProgress();
  const q = query.trim().toLowerCase();
  let number = 0;

  return (
    <div className="space-y-6">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="단원 찾기"
          className="h-11 rounded-xl bg-card pl-10"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="찾고 싶은 내용 (예: 서브넷, OSPF, chmod)"
          value={query}
        />
      </div>
      {CURRICULUM.map((part) => {
        const lessons = part.lessons.map((l) => ({ ...l, number: ++number }));
        const shown = q
          ? lessons.filter((l) =>
              `${l.title} ${l.summary} ${part.title}`.toLowerCase().includes(q)
            )
          : lessons;
        if (shown.length === 0) return null;
        const done = part.lessons.filter(
          (l) => bySlug.get(l.slug)?.completedAt
        ).length;
        return (
          <section
            className="overflow-hidden rounded-[1.125rem] border border-border bg-card"
            key={part.id}
          >
            <header className="flex items-start justify-between gap-4 border-border border-b bg-muted/30 px-5 py-4">
              <div className="min-w-0">
                <p className="font-semibold text-[12px] text-primary">
                  {part.label}
                </p>
                <h2 className="mt-0.5 font-bold text-[17px] tracking-tight">
                  {part.title}
                </h2>
                <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed">
                  {part.description}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-background px-2.5 py-1 font-medium text-[12px] text-muted-foreground tabular-nums">
                {done}/{part.lessons.length}
              </span>
            </header>
            <ol className="divide-y divide-border/70">
              {shown.map((l) => {
                const completed = Boolean(bySlug.get(l.slug)?.completedAt);
                return (
                  <li key={l.slug}>
                    <Link
                      className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-accent/50"
                      href={`${basePath}/${l.slug}`}
                    >
                      <span
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-full font-semibold text-[12.5px] tabular-nums",
                          completed
                            ? "bg-emerald-50 text-emerald-600"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {completed ? (
                          <CheckCircle2Icon className="size-4.5" />
                        ) : (
                          l.number
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-[14.5px] text-foreground group-hover:text-primary">
                          {l.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
                          {l.summary}
                        </span>
                      </span>
                      {minutes[l.slug] ? (
                        <span className="hidden shrink-0 items-center gap-1 text-[12px] text-muted-foreground sm:flex">
                          <ClockIcon className="size-3.5" />약 {minutes[l.slug]}
                          분
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
      {q &&
      CURRICULUM.every((p) =>
        p.lessons.every(
          (l) => !`${l.title} ${l.summary} ${p.title}`.toLowerCase().includes(q)
        )
      ) ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-[13.5px] text-muted-foreground">
          "{query}"에 맞는 단원이 없어요. 다른 말로 찾아보거나 AI 튜터에게
          물어보세요.
        </p>
      ) : null}
    </div>
  );
}
