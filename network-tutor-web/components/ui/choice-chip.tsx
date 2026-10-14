import type * as React from "react";
import { cn } from "@/lib/utils";

// 과목·문항 수 같은 단일 선택 칩. 선택된 칩은 브랜드 색으로 채운다.
export function ChoiceChip({
  active,
  className,
  ...props
}: React.ComponentProps<"button"> & { active: boolean }) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 font-medium text-[13px] transition-all duration-150 active:scale-[0.97]",
        active
          ? "border-primary bg-primary text-primary-foreground shadow-[var(--shadow-brand)]"
          : "border-border bg-card text-foreground/80 hover:border-primary/40 hover:text-primary",
        className
      )}
      type="button"
      {...props}
    />
  );
}
