"use client";

import { isToday, isYesterday, subMonths, subWeeks } from "date-fns";
import { motion } from "framer-motion";
import { Trash2Icon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "next-auth";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import useSWRInfinite from "swr/infinite";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  useSidebar,
} from "@/components/ui/sidebar";
import type { Chat } from "@/lib/db/schema";
import { fetcher } from "@/lib/utils";
import { LoaderIcon } from "./icons";
import { ChatItem } from "./sidebar-history-item";

type GroupedChats = {
  today: Chat[];
  yesterday: Chat[];
  lastWeek: Chat[];
  lastMonth: Chat[];
  older: Chat[];
};

export type ChatHistory = {
  chats: Chat[];
  hasMore: boolean;
};

const PAGE_SIZE = 20;

const groupChatsByDate = (chats: Chat[]): GroupedChats => {
  const now = new Date();
  const oneWeekAgo = subWeeks(now, 1);
  const oneMonthAgo = subMonths(now, 1);

  return chats.reduce(
    (groups, chat) => {
      const chatDate = new Date(chat.createdAt);

      if (isToday(chatDate)) {
        groups.today.push(chat);
      } else if (isYesterday(chatDate)) {
        groups.yesterday.push(chat);
      } else if (chatDate > oneWeekAgo) {
        groups.lastWeek.push(chat);
      } else if (chatDate > oneMonthAgo) {
        groups.lastMonth.push(chat);
      } else {
        groups.older.push(chat);
      }

      return groups;
    },
    {
      lastMonth: [],
      lastWeek: [],
      older: [],
      today: [],
      yesterday: [],
    } as GroupedChats
  );
};

export function getChatHistoryPaginationKey(
  pageIndex: number,
  previousPageData: ChatHistory
) {
  if (previousPageData && previousPageData.hasMore === false) {
    return null;
  }

  if (pageIndex === 0) {
    return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/history?limit=${PAGE_SIZE}`;
  }

  const firstChatFromPage = previousPageData.chats.at(-1);

  if (!firstChatFromPage) {
    return null;
  }

  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/history?ending_before=${firstChatFromPage.id}&limit=${PAGE_SIZE}`;
}

export function SidebarHistory({
  user,
  onDeleteAll,
}: {
  user: User | undefined;
  onDeleteAll?: () => void;
}) {
  const { setOpenMobile } = useSidebar();
  const pathname = usePathname();
  const id = pathname?.startsWith("/chat/") ? pathname.split("/")[2] : null;

  const {
    data: paginatedChatHistories,
    setSize,
    isValidating,
    isLoading,
    mutate,
  } = useSWRInfinite<ChatHistory>(
    user ? getChatHistoryPaginationKey : () => null,
    fetcher,
    { fallbackData: [], revalidateOnFocus: false }
  );

  const router = useRouter();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const hasReachedEnd = paginatedChatHistories
    ? paginatedChatHistories.some((page) => page.hasMore === false)
    : false;

  const hasEmptyChatHistory = paginatedChatHistories
    ? paginatedChatHistories.every((page) => page.chats.length === 0)
    : false;

  const handleDelete = useCallback(() => {
    const chatToDelete = deleteId;
    const isCurrentChat = pathname === `/chat/${chatToDelete}`;

    setShowDeleteDialog(false);

    if (isCurrentChat) {
      router.replace("/");
    }

    mutate((chatHistories) => {
      if (chatHistories) {
        return chatHistories.map((chatHistory) => ({
          ...chatHistory,
          chats: chatHistory.chats.filter((chat) => chat.id !== chatToDelete),
        }));
      }
    });

    fetch(
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat?id=${chatToDelete}`,
      { method: "DELETE" }
    );

    toast.success("대화를 삭제했어요");
  }, [deleteId, mutate, pathname, router]);

  const handleShowDeleteDialog = useCallback((chatId: string) => {
    setDeleteId(chatId);
    setShowDeleteDialog(true);
  }, []);

  const handleViewportEnter = useCallback(() => {
    if (!isValidating && !hasReachedEnd) {
      setSize((size) => size + 1);
    }
  }, [hasReachedEnd, isValidating, setSize]);

  if (!user) {
    return (
      <SidebarGroup className="mt-1 group-data-[collapsible=icon]:hidden">
        <SidebarGroupContent>
          <div className="flex w-full flex-row items-center gap-2 px-2 text-[12.5px] text-sidebar-foreground/50 leading-relaxed">
            로그인하면 대화 기록이 저장돼요.
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (isLoading) {
    return (
      <SidebarGroup className="mt-1 group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel className="px-2 text-[11px] font-semibold text-sidebar-foreground/45 tracking-normal normal-case">
          대화 기록
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex flex-col gap-0.5 px-1">
            {[44, 32, 28, 64, 52].map((item) => (
              <div
                className="flex h-8 items-center gap-2 rounded-lg px-2"
                key={item}
              >
                <div
                  className="h-3 max-w-(--skeleton-width) flex-1 animate-pulse rounded-md bg-sidebar-foreground/[0.06]"
                  style={
                    {
                      "--skeleton-width": `${item}%`,
                    } as React.CSSProperties
                  }
                />
              </div>
            ))}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (hasEmptyChatHistory) {
    return (
      <SidebarGroup className="mt-1 group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel className="px-2 text-[11px] font-semibold text-sidebar-foreground/45 tracking-normal normal-case">
          대화 기록
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex w-full flex-row items-center gap-2 px-2 text-[12.5px] text-sidebar-foreground/50 leading-relaxed">
            아직 대화가 없어요. 궁금한 걸 물어보면 여기에 차곡차곡 쌓여요.
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <>
      <SidebarGroup className="mt-1 group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel className="px-2 text-[11px] font-semibold text-sidebar-foreground/45 tracking-normal normal-case">
          대화 기록
        </SidebarGroupLabel>
        {onDeleteAll ? (
          <SidebarGroupAction
            className="text-sidebar-foreground/35 hover:bg-destructive/10 hover:text-destructive"
            onClick={onDeleteAll}
            title="대화 기록 모두 삭제"
          >
            <Trash2Icon />
            <span className="sr-only">대화 기록 모두 삭제</span>
          </SidebarGroupAction>
        ) : null}
        <SidebarGroupContent>
          <SidebarMenu>
            {paginatedChatHistories
              ? (() => {
                  const chatsFromHistory = paginatedChatHistories.flatMap(
                    (paginatedChatHistory) => paginatedChatHistory.chats
                  );

                  const groupedChats = groupChatsByDate(chatsFromHistory);

                  return (
                    <div className="flex flex-col gap-4">
                      {groupedChats.today.length > 0 && (
                        <div>
                          <div className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-sidebar-foreground/40">
                            오늘
                          </div>
                          {groupedChats.today.map((chat) => (
                            <ChatItem
                              chat={chat}
                              isActive={chat.id === id}
                              key={chat.id}
                              onDelete={handleShowDeleteDialog}
                              setOpenMobile={setOpenMobile}
                            />
                          ))}
                        </div>
                      )}

                      {groupedChats.yesterday.length > 0 && (
                        <div>
                          <div className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-sidebar-foreground/40">
                            어제
                          </div>
                          {groupedChats.yesterday.map((chat) => (
                            <ChatItem
                              chat={chat}
                              isActive={chat.id === id}
                              key={chat.id}
                              onDelete={handleShowDeleteDialog}
                              setOpenMobile={setOpenMobile}
                            />
                          ))}
                        </div>
                      )}

                      {groupedChats.lastWeek.length > 0 && (
                        <div>
                          <div className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-sidebar-foreground/40">
                            지난 7일
                          </div>
                          {groupedChats.lastWeek.map((chat) => (
                            <ChatItem
                              chat={chat}
                              isActive={chat.id === id}
                              key={chat.id}
                              onDelete={handleShowDeleteDialog}
                              setOpenMobile={setOpenMobile}
                            />
                          ))}
                        </div>
                      )}

                      {groupedChats.lastMonth.length > 0 && (
                        <div>
                          <div className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-sidebar-foreground/40">
                            지난 30일
                          </div>
                          {groupedChats.lastMonth.map((chat) => (
                            <ChatItem
                              chat={chat}
                              isActive={chat.id === id}
                              key={chat.id}
                              onDelete={handleShowDeleteDialog}
                              setOpenMobile={setOpenMobile}
                            />
                          ))}
                        </div>
                      )}

                      {groupedChats.older.length > 0 && (
                        <div>
                          <div className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-sidebar-foreground/40">
                            이전
                          </div>
                          {groupedChats.older.map((chat) => (
                            <ChatItem
                              chat={chat}
                              isActive={chat.id === id}
                              key={chat.id}
                              onDelete={handleShowDeleteDialog}
                              setOpenMobile={setOpenMobile}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()
              : null}
          </SidebarMenu>

          <motion.div onViewportEnter={handleViewportEnter} />

          {hasReachedEnd ? null : (
            <div className="mt-1 flex flex-row items-center gap-2 px-4 py-2 text-sidebar-foreground/50">
              <div className="animate-spin">
                <LoaderIcon />
              </div>
              <div className="text-[11px]">불러오는 중…</div>
            </div>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      <AlertDialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이 대화를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              삭제한 대화는 다시 되돌릴 수 없어요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
