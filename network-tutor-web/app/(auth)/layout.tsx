import {
  BookOpenCheckIcon,
  CalculatorIcon,
  NotebookPenIcon,
} from "lucide-react";
import { BrandMark, BrandWordmark } from "@/components/brand/logo";

const FEATURES = [
  {
    icon: CalculatorIcon,
    title: "개념 질문 · 서브넷 계산",
    body: "헷갈리는 개념과 계산 문제를 바로 물어보세요.",
  },
  {
    icon: BookOpenCheckIcon,
    title: "기출 회차 · 모의고사",
    body: "실제 시험과 같은 구성으로 실전 감각을 길러요.",
  },
  {
    icon: NotebookPenIcon,
    title: "오답노트 · 학습 리포트",
    body: "틀린 문제와 약한 주제를 한눈에 모아 복습해요.",
  },
];

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-dvh w-full bg-background">
      {/* 브랜드 패널(넓은 화면 전용) */}
      <aside className="relative hidden flex-1 flex-col justify-between overflow-hidden border-border border-r bg-brand-soft p-12 lg:flex xl:p-16">
        <div className="pointer-events-none absolute inset-0 bg-dots opacity-70 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
        <div className="pointer-events-none absolute -top-40 -right-32 size-[520px] rounded-full bg-[radial-gradient(closest-side,oklch(0.75_0.14_277/0.35),transparent)]" />
        <div className="pointer-events-none absolute -bottom-48 -left-24 size-[480px] rounded-full bg-[radial-gradient(closest-side,oklch(0.85_0.1_182/0.45),transparent)]" />

        <div className="relative flex items-center gap-3">
          <BrandMark className="size-10 drop-shadow-[0_8px_18px_rgb(67_56_202/0.35)]" />
          <BrandWordmark className="text-[24px]" />
        </div>

        <div className="relative max-w-lg">
          <h2 className="font-extrabold text-[40px] text-foreground leading-[1.2] tracking-[-0.045em] xl:text-[46px]">
            네트워크관리사 2급,
            <br />
            <span className="text-brand">AI 튜터</span>와 함께 합격까지
          </h2>
          <p className="mt-4 text-[15px] text-muted-foreground leading-relaxed">
            개념 설명부터 서브넷 계산, 기출 해설과 오답 관리까지 — 한 곳에서
            꾸준히 공부하세요.
          </p>

          <div className="mt-10 flex flex-col gap-3">
            {FEATURES.map((f) => (
              <div
                className="flex items-center gap-4 rounded-2xl border border-white/70 bg-white/70 p-4 shadow-[var(--shadow-card)] backdrop-blur"
                key={f.title}
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white shadow-[var(--shadow-brand)]">
                  <f.icon className="size-5" />
                </div>
                <div>
                  <p className="font-semibold text-[14px] text-foreground">
                    {f.title}
                  </p>
                  <p className="text-[13px] text-muted-foreground">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-[12.5px] text-muted-foreground">
          학교 자체 호스팅 AI로 운영됩니다
        </p>
      </aside>

      {/* 로그인 폼 */}
      <main className="relative flex w-full flex-col items-center justify-center px-5 py-12 lg:w-[520px] lg:shrink-0 xl:w-[600px]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-brand-soft opacity-70 [mask-image:linear-gradient(to_bottom,black,transparent)] lg:hidden" />
        <div className="relative flex w-full max-w-[380px] flex-col gap-8">
          <div className="flex items-center gap-2.5 lg:hidden">
            <BrandMark className="size-9 drop-shadow-[0_6px_14px_rgb(67_56_202/0.3)]" />
            <BrandWordmark className="text-[21px]" />
          </div>
          <div className="flex flex-col gap-2">{children}</div>
        </div>
      </main>
    </div>
  );
}
