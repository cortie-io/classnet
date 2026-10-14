"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import {
  AlertTriangleIcon,
  BookmarkIcon,
  ChevronDownIcon,
  InfoIcon,
  LightbulbIcon,
  TargetIcon,
} from "lucide-react";
import Link from "next/link";
import { Children, isValidElement, type ReactNode } from "react";
import { defaultRemarkPlugins, Streamdown, type Components } from "streamdown";
import type { CalloutType, Segment } from "@/lib/textbook/content";
import { cn } from "@/lib/utils";

// 교재 본문. 채팅 답변과 같은 마크다운 엔진(Streamdown)을 쓰되, 문서처럼 읽히게 글자 크기·간격·제목 링크를 바꾼다.

const plugins = { cjk, code };
// "1~4계층, 5~7계층"처럼 물결표를 범위로 쓴 문장이 취소선이 되지 않게 한 겹 물결표 취소선은 끈다.
const gfm = defaultRemarkPlugins.gfm as [unknown, object];
const remarkPlugins = [[gfm[0], { ...gfm[1], singleTilde: false }]] as never;

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node))
    return textOf(node.props.children);
  return "";
}

/** lib/textbook/content.ts의 headingId와 같은 규칙 — 오른쪽 "이 단원에서" 목록이 이 id로 이동한다. */
function headingId(text: string): string {
  return (
    "h-" +
    text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
  );
}

const components: Components = (() => {
  const idFor = (children: ReactNode) => headingId(textOf(children));
  return {
    h2: ({ children }) => (
      <h2
        className="mt-12 mb-4 scroll-mt-24 border-border/70 border-b pb-2 font-bold text-[22px] tracking-tight"
        id={idFor(children)}
      >
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3
        className="mt-8 mb-3 scroll-mt-24 font-semibold text-[18px] tracking-tight"
        id={idFor(children)}
      >
        {children}
      </h3>
    ),
    a: ({ href, children }) => {
      if (href?.startsWith("/")) {
        return (
          <Link
            className="font-medium text-brand underline decoration-brand/30 underline-offset-4 hover:decoration-brand"
            href={href}
          >
            {children}
          </Link>
        );
      }
      return <span className="font-medium">{children}</span>;
    },
  };
})();

const CALLOUT_STYLE: Record<
  Exclude<CalloutType, "answer">,
  { label: string; icon: typeof InfoIcon; box: string; head: string }
> = {
  goal: {
    label: "학습 목표",
    icon: TargetIcon,
    box: "border-primary/20 bg-brand-soft",
    head: "text-primary",
  },
  note: {
    label: "참고",
    icon: InfoIcon,
    box: "border-sky-200 bg-sky-50/70",
    head: "text-sky-700",
  },
  tip: {
    label: "기억 팁",
    icon: LightbulbIcon,
    box: "border-emerald-200 bg-emerald-50/70",
    head: "text-emerald-700",
  },
  exam: {
    label: "시험 포인트",
    icon: BookmarkIcon,
    box: "border-violet-200 bg-violet-50/70",
    head: "text-violet-700",
  },
  warning: {
    label: "헷갈리기 쉬워요",
    icon: AlertTriangleIcon,
    box: "border-amber-200 bg-amber-50/80",
    head: "text-amber-700",
  },
};

const PROSE =
  "textbook-prose text-[16px] leading-[1.85] text-foreground/90 [&_li]:my-1 [&_ol]:my-4 [&_p]:my-4 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:my-4 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

function Markdown({
  text,
  components,
  className,
}: {
  text: string;
  components: Components;
  className?: string;
}) {
  return (
    <Streamdown
      className={cn(PROSE, className)}
      components={components}
      controls={{ table: false, code: true, mermaid: false }}
      mode="static"
      plugins={plugins}
      remarkPlugins={remarkPlugins}
    >
      {text}
    </Streamdown>
  );
}

function Callout({
  type,
  children,
}: {
  type: CalloutType;
  children: ReactNode;
}) {
  if (type === "answer") {
    return (
      <details className="group my-4 rounded-xl border border-border bg-muted/40 px-4 py-3 open:bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold text-[14px] text-primary select-none">
          <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" />
          정답과 해설 보기
        </summary>
        <div className="mt-3 border-border/70 border-t pt-3">{children}</div>
      </details>
    );
  }
  const style = CALLOUT_STYLE[type];
  const Icon = style.icon;
  return (
    <aside className={cn("my-6 rounded-2xl border px-5 py-4", style.box)}>
      <p
        className={cn(
          "mb-2 flex items-center gap-1.5 font-bold text-[13px] tracking-tight",
          style.head
        )}
      >
        <Icon className="size-4" />
        {style.label}
      </p>
      {children}
    </aside>
  );
}

export function LessonBody({ segments }: { segments: Segment[] }) {
  return (
    <div className="min-w-0">
      {segments.map((s, i) =>
        s.kind === "md" ? (
          <Markdown components={components} key={i} text={s.text} />
        ) : (
          <Callout key={i} type={s.type}>
            <Markdown
              className="text-[15px] leading-[1.8]"
              components={components}
              text={s.text}
            />
          </Callout>
        )
      )}
    </div>
  );
}

export function HeadingList({
  headings,
}: {
  headings: { depth: number; text: string; id: string }[];
}) {
  const items = Children.toArray(
    headings
      .filter((h) => h.depth === 2)
      .map((h) => (
        <li key={h.id}>
          <a
            className="block truncate py-1 text-[13px] text-muted-foreground transition-colors hover:text-primary"
            href={`#${h.id}`}
          >
            {h.text}
          </a>
        </li>
      ))
  );
  if (items.length === 0) return null;
  return <ul className="space-y-0.5">{items}</ul>;
}
