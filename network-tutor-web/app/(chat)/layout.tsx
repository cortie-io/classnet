import { OfficialExamGuard } from "@/components/official-exam/exam-guard";
import { cookies } from "next/headers";
import Script from "next/script";
import { Suspense } from "react";
import { ServiceLaunchNotice } from "@/components/chat/service-launch-notice";
import { AppSidebar } from "@/components/chat/app-sidebar";
import { ChatShellGate } from "@/components/chat/chat-shell-gate";
import { DataStreamProvider } from "@/components/chat/data-stream-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { auth } from "../(auth)/auth";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script
        src="https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js"
        strategy="lazyOnload"
      />
      <DataStreamProvider>
        <Suspense fallback={<div className="flex h-dvh bg-sidebar" />}>
          <SidebarShell>{children}</SidebarShell>
        </Suspense>
      </DataStreamProvider>
    </>
  );
}

async function SidebarShell({ children }: { children: React.ReactNode }) {
  const [session, cookieStore] = await Promise.all([auth(), cookies()]);
  // 처음 들어온 학생에게 아이콘만 보이면 메뉴가 뭔지 알 수 없다 — 직접 접은 경우에만 접힌 채로 연다
  const isCollapsed = cookieStore.get("sidebar_state")?.value === "false";

  return (
    <SidebarProvider defaultOpen={!isCollapsed}>
      <AppSidebar user={session?.user} />
      {session?.user?.role === "student" ? <OfficialExamGuard /> : null}
      <SidebarInset>
        <ServiceLaunchNotice />
        <Suspense fallback={<div className="flex h-dvh" />}>
          <ChatShellGate />
        </Suspense>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
