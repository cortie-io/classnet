import { useId } from "react";
import { cn } from "@/lib/utils";

// classnet 로고: 수업·대화를 뜻하는 "c"와, 그 끝에 이어진 네트워크 노드(민트 점).
// public/logo.svg·앱 아이콘과 같은 도형이며, 한 화면에 여러 번 그려져도 그라데이션 id가 겹치지 않게 useId를 쓴다.
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  const id = useId();
  return (
    <svg
      aria-hidden={title ? undefined : true}
      className={cn("size-8 shrink-0", className)}
      fill="none"
      role={title ? "img" : undefined}
      viewBox="0 0 64 64"
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient gradientUnits="userSpaceOnUse" id={`${id}-bg`} x1="6" x2="58" y1="2" y2="62">
          <stop offset="0" stopColor="#6271FF" />
          <stop offset="0.55" stopColor="#4338CA" />
          <stop offset="1" stopColor="#2E2A85" />
        </linearGradient>
        <radialGradient
          cx="0"
          cy="0"
          gradientTransform="translate(16 6) rotate(55) scale(58)"
          gradientUnits="userSpaceOnUse"
          id={`${id}-shine`}
          r="1"
        >
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.32" />
          <stop offset="0.6" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect fill={`url(#${id}-bg)`} height="64" rx="16" width="64" />
      <rect fill={`url(#${id}-shine)`} height="64" rx="16" width="64" />
      <path d="M41.1 21.4A15 15 0 1 0 41.1 42.6" stroke="#FFFFFF" strokeLinecap="round" strokeWidth="6.6" />
      <circle cx="47.6" cy="32" fill="#5EEAD4" fillOpacity="0.2" r="8.2" />
      <circle cx="47.6" cy="32" fill="#5EEAD4" r="4.6" />
    </svg>
  );
}

export function BrandWordmark({ className, suffix = true }: { className?: string; suffix?: boolean }) {
  return (
    <span className={cn("font-extrabold text-foreground tracking-[-0.04em]", className)}>
      classnet
      {suffix ? <span className="font-medium text-muted-foreground/70">.chat</span> : null}
    </span>
  );
}
