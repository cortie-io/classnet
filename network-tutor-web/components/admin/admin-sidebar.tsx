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
import { AdminLink as Link } from "@/components/admin/service-period";
import { usePathname } from "next/navigation";
import type { User } from "next-auth";
import { BrandMark } from "@/components/brand/logo";
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
      <SidebarHeader className="px-3 pt-4 pb-2 group-data-[collapsible=icon]:px-2">
        <SidebarMenu>
          <SidebarMenuItem className="flex flex-row items-center justify-between">
            <Link className="flex min-w-0 items-center gap-2.5 px-0.5" href="/admin">
              <BrandMark className="size-8 drop-shadow-[0_4px_10px_rgb(67_56_202/0.3)]" title="classnet" />
              <span className="flex min-w-0 items-center gap-1.5 group-data-[collapsible=icon]:hidden">
                <span className="truncate font-extrabold text-[17px] text-foreground tracking-[-0.04em]">classnet</span>
                <span className="rounded-md bg-brand px-1.5 py-0.5 font-bold text-[10px] text-white">관리자</span>
              </span>
            </Link>
            <SidebarTrigger className="shrink-0 text-sidebar-foreground/45 transition-colors duration-150 hover:text-sidebar-foreground group-data-[collapsible=icon]:hidden" />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="px-1">
        <SidebarGroup className="pt-1">
          <SidebarGroupLabel className="h-7 px-2.5">관리 메뉴</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                      <Link href={item.href}>
                        <Icon className={active ? "text-primary" : "text-sidebar-foreground/45"} />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel className="h-7 px-2.5">학생 화면</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="학생 페이지로 이동">
                  <Link href="/">
                    <MessageSquareIcon className="text-sidebar-foreground/45" />
                    <span>학생 페이지로</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border px-3 pt-2.5 pb-3 group-data-[collapsible=icon]:px-2">
        <SidebarUserNav user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
