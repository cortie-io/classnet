"use client";

import { SHOW_OFFICIAL_EXAMS } from "@/lib/student-features";

import {
  AwardIcon,
  LibraryBigIcon,
  BarChart3Icon,
  BookOpenCheckIcon,
  CalendarClockIcon,
  LayersIcon,
  type LucideIcon,
  NotebookPenIcon,
  PanelLeftIcon,
  PlusIcon,
  ShieldIcon,
  TimerIcon,
  TrendingUpIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BrandMark, BrandWordmark } from "@/components/brand/logo";
import { ExamCountdown } from "@/components/chat/exam-countdown";
import { InstallAppButton } from "@/components/chat/install-app-button";
import type { User } from "next-auth";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import {
  getChatHistoryPaginationKey,
  SidebarHistory,
} from "@/components/chat/sidebar-history";
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
  useSidebar,
} from "@/components/ui/sidebar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

type NavItem = { href: string; label: string; icon: LucideIcon };

const STUDY_NAV: NavItem[] = [
  { href: "/textbook", label: "교재", icon: LibraryBigIcon },
  ...(SHOW_OFFICIAL_EXAMS
    ? [{ href: "/official-exams", label: "공식 모의시험", icon: AwardIcon }]
    : []),
  { href: "/practice", label: "과목별 문제 연습", icon: BookOpenCheckIcon },
  { href: "/mock-exam", label: "모의고사", icon: TimerIcon },
  { href: "/rounds", label: "기출문제", icon: CalendarClockIcon },
  { href: "/flashcards", label: "플래시카드", icon: LayersIcon },
];

const RECORD_NAV: NavItem[] = [
  { href: "/wrong-answers", label: "오답노트", icon: NotebookPenIcon },
  { href: "/my-exams", label: "내 응시 기록", icon: BarChart3Icon },
  { href: "/my-report", label: "나의 학습 리포트", icon: TrendingUpIcon },
];

function NavGroup({
  label,
  items,
  pathname,
  onNavigate,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <SidebarGroup className="py-1">
      <SidebarGroupLabel className="h-7 px-2.5 font-semibold text-[11px] text-sidebar-foreground/45 tracking-normal normal-case">
        {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5">
          {items.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  onClick={onNavigate}
                  tooltip={item.label}
                >
                  <Link href={item.href}>
                    <Icon
                      className={
                        active ? "text-primary" : "text-sidebar-foreground/45"
                      }
                    />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppSidebar({ user }: { user: User | undefined }) {
  const router = useRouter();
  const pathname = usePathname();
  const { setOpenMobile, toggleSidebar } = useSidebar();
  const { mutate } = useSWRConfig();
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);

  const closeMobile = useCallback(() => {
    setOpenMobile(false);
  }, [setOpenMobile]);

  const handleToggleSidebar = useCallback(() => {
    toggleSidebar();
  }, [toggleSidebar]);

  const handleNewChat = useCallback(() => {
    setOpenMobile(false);
    router.push("/");
  }, [router, setOpenMobile]);

  const handleShowDeleteAllDialog = useCallback(() => {
    setShowDeleteAllDialog(true);
  }, []);

  const handleDeleteAll = useCallback(() => {
    setShowDeleteAllDialog(false);
    router.replace("/");
    mutate(unstable_serialize(getChatHistoryPaginationKey), [], {
      revalidate: false,
    });

    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/history`, {
      method: "DELETE",
    });

    toast.success("모든 대화를 삭제했어요");
  }, [mutate, router]);

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader className="gap-3 px-3 pt-4 pb-2 group-data-[collapsible=icon]:px-2">
          <SidebarMenu>
            <SidebarMenuItem className="flex flex-row items-center justify-between">
              <div className="group/logo relative flex min-w-0 items-center">
                <SidebarMenuButton
                  asChild
                  className="!px-0.5 h-9 min-w-0 items-center justify-start gap-2.5 hover:bg-transparent group-data-[collapsible=icon]:size-9 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:group-hover/logo:opacity-0"
                  tooltip="classnet"
                >
                  <Link href="/" onClick={closeMobile}>
                    <BrandMark
                      className="size-8! drop-shadow-[0_4px_10px_rgb(67_56_202/0.3)]"
                      title="classnet"
                    />
                    <BrandWordmark className="truncate text-[17px] group-data-[collapsible=icon]:hidden" />
                  </Link>
                </SidebarMenuButton>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SidebarMenuButton
                      className="pointer-events-none absolute inset-0 size-8 opacity-0 group-data-[collapsible=icon]:pointer-events-auto group-data-[collapsible=icon]:group-hover/logo:opacity-100"
                      onClick={handleToggleSidebar}
                    >
                      <PanelLeftIcon className="size-4" />
                    </SidebarMenuButton>
                  </TooltipTrigger>
                  <TooltipContent className="hidden md:block" side="right">
                    사이드바 열기
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="group-data-[collapsible=icon]:hidden">
                <SidebarTrigger className="text-sidebar-foreground/45 transition-colors duration-150 hover:text-sidebar-foreground" />
              </div>
            </SidebarMenuItem>
          </SidebarMenu>

          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="h-10 justify-center gap-1.5 rounded-xl bg-brand font-semibold text-[13.5px] text-white shadow-[var(--shadow-brand)] transition-[filter,transform] duration-150 hover:bg-brand hover:text-white hover:brightness-110 active:scale-[0.98] group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:rounded-lg"
                onClick={handleNewChat}
                tooltip="새 대화"
              >
                <PlusIcon className="size-4" strokeWidth={2.5} />
                <span>새 대화</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <div className="group-data-[collapsible=icon]:hidden empty:hidden">
            <InstallAppButton />
          </div>
        </SidebarHeader>
        <SidebarContent className="gap-0 px-1">
          {user ? <ExamCountdown /> : null}
          {user ? (
            <>
              <NavGroup
                items={STUDY_NAV}
                label="학습하기"
                onNavigate={closeMobile}
                pathname={pathname}
              />
              <NavGroup
                items={RECORD_NAV}
                label="나의 기록"
                onNavigate={closeMobile}
                pathname={pathname}
              />
              {user.role === "admin" ? (
                <NavGroup
                  items={[
                    { href: "/admin", label: "관리자 콘솔", icon: ShieldIcon },
                  ]}
                  label="관리"
                  onNavigate={closeMobile}
                  pathname={pathname}
                />
              ) : null}
            </>
          ) : null}
          <SidebarHistory
            onDeleteAll={user ? handleShowDeleteAllDialog : undefined}
            user={user}
          />
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border px-3 pt-2.5 pb-3 group-data-[collapsible=icon]:px-2">
          {user ? <SidebarUserNav user={user} /> : null}
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <AlertDialog
        onOpenChange={setShowDeleteAllDialog}
        open={showDeleteAllDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>모든 대화를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              지금까지의 대화 기록이 전부 지워지며, 되돌릴 수 없어요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAll}>
              모두 삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
