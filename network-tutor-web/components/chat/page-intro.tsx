import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// 학습 페이지 상단 제목 영역. 모든 페이지가 같은 아이콘 타일·제목·설명 구성을 쓰게 한다.
export function PageIntro({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="flex items-start gap-3.5">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand text-white shadow-[var(--shadow-brand)]">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 pt-0.5">
          <h1 className="font-bold text-[22px] text-foreground tracking-[-0.035em]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-[13.5px] text-muted-foreground leading-relaxed">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {children ? (
        <div className="flex shrink-0 flex-wrap gap-2">{children}</div>
      ) : null}
    </div>
  );
}

// 불러오는 중·빈 목록 등 본문 대신 보여줄 안내.
export function PageNotice({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[1.125rem] border border-border border-dashed bg-card/60 px-6 py-12 text-center">
      {Icon ? (
        <div className="mb-1 flex size-11 items-center justify-center rounded-2xl bg-accent text-primary">
          <Icon className="size-5" />
        </div>
      ) : null}
      <p className="font-semibold text-[15px] text-foreground">{title}</p>
      {description ? (
        <p className="max-w-sm text-[13px] text-muted-foreground leading-relaxed">
          {description}
        </p>
      ) : null}
      {children ? (
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function PageLoading({ label = "불러오는 중…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-16 text-[13px] text-muted-foreground">
      <span className="size-4 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
      {label}
    </div>
  );
}
