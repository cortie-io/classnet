"use client";

import { ChevronsUpDownIcon, LogOutIcon } from "lucide-react";
import type { User } from "next-auth";
import { signOut, useSession } from "next-auth/react";
import { useCallback } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { LoaderIcon } from "./icons";
import { toast } from "./toast";

function emailToHue(email: string): number {
  let hash = 0;
  for (const char of email) {
    hash = char.charCodeAt(0) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

// 아바타 색은 브랜드 톤(인디고~민트 사이)에서만 고른다 — 사람마다 다르되 화면 분위기를 해치지 않게.
function avatarBackground(seed: string): string {
  const hue = 200 + (emailToHue(seed) % 100);
  return `linear-gradient(135deg, oklch(0.72 0.13 ${hue}), oklch(0.55 0.19 ${hue + 25}))`;
}

function roleLabel(user: User): string {
  if (user.role === "admin") return "관리자";
  if (user.name === "나기수") return "교수";
  return "학생";
}

// 나기수 계정은 학생이 아니라 교수님이라 호칭만 예외 처리한다(요청 반영).
function displayLabel(user: User): string {
  if (user.role === "admin") return "관리자";
  if (user.name === "나기수") return `${user.name} 교수님`;
  return `${user.name} 학생`;
}

export function SidebarUserNav({ user }: { user: User }) {
  const { status } = useSession();

  const handleAuthClick = useCallback(() => {
    if (status === "loading") {
      toast({
        description:
          "로그인 상태를 확인하는 중이에요. 잠시 후 다시 시도해 주세요.",
        type: "error",
      });

      return;
    }

    signOut({
      redirectTo: "/login",
    });
  }, [status]);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {status === "loading" ? (
              <SidebarMenuButton className="h-10 justify-between rounded-lg bg-transparent text-sidebar-foreground/50 transition-colors duration-150 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                <div className="flex flex-row items-center gap-2">
                  <div className="size-6 animate-pulse rounded-full bg-sidebar-foreground/10" />
                  <span className="animate-pulse rounded-md bg-sidebar-foreground/10 text-transparent text-[13px]">
                    Loading...
                  </span>
                </div>
                <div className="animate-spin text-sidebar-foreground/50">
                  <LoaderIcon />
                </div>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton
                className="h-11 gap-2.5 rounded-xl px-1.5 text-sidebar-foreground transition-colors duration-150 hover:bg-sidebar-accent/60 data-[state=open]:bg-sidebar-accent group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-1!"
                data-testid="user-nav-button"
              >
                <div
                  className="flex size-8 shrink-0 items-center justify-center rounded-full font-bold text-[13px] text-white shadow-[var(--shadow-card)]"
                  style={{
                    background: avatarBackground(user.email ?? user.name ?? ""),
                  }}
                >
                  {(user.name ?? "?").slice(0, 1)}
                </div>
                <div className="flex min-w-0 flex-col leading-tight">
                  <span
                    className="truncate font-semibold text-[13px]"
                    data-testid="user-email"
                  >
                    {displayLabel(user)}
                  </span>
                  <span className="truncate text-[11px] text-sidebar-foreground/50">
                    {roleLabel(user)} 계정
                  </span>
                </div>
                <ChevronsUpDownIcon className="ml-auto size-3.5 text-sidebar-foreground/40" />
              </SidebarMenuButton>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-popper-anchor-width) min-w-48 rounded-xl border border-border/70 bg-card/95 p-1 backdrop-blur-xl shadow-[var(--shadow-float)]"
            data-testid="user-nav-menu"
            side="top"
          >
            <DropdownMenuItem asChild data-testid="user-nav-item-auth">
              <button
                className="w-full cursor-pointer gap-2 rounded-lg text-[13px] text-muted-foreground"
                onClick={handleAuthClick}
                type="button"
              >
                <LogOutIcon className="size-4" />
                로그아웃
              </button>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
