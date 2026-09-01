"use client";

import {
  ClipboardListIcon,
  LayoutDashboardIcon,
  MessageSquareIcon,
  ScrollTextIcon,
  TimerIcon,
  TrophyIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { User } from "next-auth";
import { SidebarUserNav } from "@/components/chat/sidebar-user-nav";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const NAV_ITEMS = [
  { href: "/admin", label: "대시보드", icon: LayoutDashboardIcon },
  { href: "/admin/students", label: "학생 관리", icon: UsersIcon },
  { href: "/admin/ranking", label: "학습 순위", icon: TrophyIcon },
  { href: "/admin/questions", label: "문제 검수", icon: ClipboardListIcon },
  { href: "/admin/exams", label: "시험 관리", icon: TimerIcon },
  { href: "/admin/audit", label: "질의응답 감사로그", icon: ScrollTextIcon },
];

export function AdminSidebar({ user }: { user: User }) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="pb-0 pt-3">
        <SidebarMenu>
          <SidebarMenuItem className="flex flex-row items-center justify-between">
            <div className="flex min-w-0 items-center gap-2 px-2">
              {/* biome-ignore lint/performance/noImgElement: 고정 로고 자산, next/image 불필요 */}
              <img alt="classnet" className="size-7 shrink-0" src="/logo.svg" />
              <span className="truncate font-semibold text-[13px] text-sidebar-foreground group-data-[collapsible=icon]:hidden">
                classnet 관리자
              </span>
            </div>
            <SidebarTrigger className="shrink-0 text-sidebar-foreground/60 transition-colors duration-150 hover:text-sidebar-foreground group-data-[collapsible=icon]:hidden" />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="pt-1">
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                      <Link href={item.href}>
                        <Icon className="size-4" />
                        <span className="text-[13px]">{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel className="text-[11px]">학생 화면</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="학생 페이지로 이동">
                  <Link href="/">
                    <MessageSquareIcon className="size-4" />
                    <span className="text-[13px]">학생 페이지로</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border pt-2 pb-3">
        <SidebarUserNav user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
