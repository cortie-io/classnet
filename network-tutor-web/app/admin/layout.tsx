import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/app/(auth)/auth";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

// 세션 확인(auth())은 요청마다 달라지는 동적 데이터라 cacheComponents 실험 기능 아래서는
// Suspense 경계 없이 쓸 수 없다 — 그래서 동적 부분을 별도 컴포넌트로 분리해 Suspense로 감쌌다.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground text-sm">불러오는 중...</div>}>
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}

async function AdminGate({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/");

  return (
    <SidebarProvider defaultOpen={true}>
      <AdminSidebar user={session.user} />
      <SidebarInset>
        <div className="mx-auto w-full max-w-5xl px-6 py-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
