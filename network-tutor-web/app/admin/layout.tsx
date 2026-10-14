import { AdminPeriodProvider, AdminPeriodSelector } from "@/components/admin/service-period";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/app/(auth)/auth";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { BrandMark } from "@/components/brand/logo";
import { PageLoading } from "@/components/chat/page-intro";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

// 세션 확인(auth())은 요청마다 달라지는 동적 데이터라 cacheComponents 실험 기능 아래서는
// Suspense 경계 없이 쓸 수 없다 — 그래서 동적 부분을 별도 컴포넌트로 분리해 Suspense로 감쌌다.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<PageLoading />}>
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}

async function AdminGate({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/");

  return (
    <AdminPeriodProvider><SidebarProvider defaultOpen={true}>
      <AdminSidebar user={session.user} />
      <SidebarInset>
        {/* 휴대폰에서는 사이드바가 닫힌 시트라 그 안의 토글을 누를 방법이 없었다 — 본문 위에 여는 버튼을 둔다. */}
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2.5 border-border/70 border-b bg-card/90 px-3 backdrop-blur-lg md:hidden">
          <SidebarTrigger aria-label="메뉴 열기" />
          <BrandMark className="size-6" />
          <span className="font-bold text-[15px]">classnet</span>
          <span className="rounded-md bg-brand px-1.5 py-0.5 font-bold text-[10px] text-white">관리자</span>
        </header>
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-10"><AdminPeriodSelector />{children}</div>
      </SidebarInset>
    </SidebarProvider></AdminPeriodProvider>
  );
}
