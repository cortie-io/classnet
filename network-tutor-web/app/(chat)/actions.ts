"use server";

import type { UIMessage } from "ai";
import { cookies } from "next/headers";
import { auth } from "@/app/(auth)/auth";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import {
  deleteMessagesByChatIdAfterTimestamp,
  getChatById,
  getMessageById,
  updateChatVisibilityById,
} from "@/lib/db/queries";
import { getTextFromMessage } from "@/lib/utils";

export async function saveChatModelAsCookie(model: string) {
  const cookieStore = await cookies();
  cookieStore.set("chat-model", model);
}

const TITLE_MAX_LENGTH = 60;

// 별도 LLM 호출 없이 첫 질문 텍스트를 그대로 잘라 제목으로 쓴다 — 채팅마다 타이틀 생성을 위해
// 추가 모델 호출을 하나 더 넣는 건 이 서비스의 답변 파이프라인(이미 여러 단계) 위에 불필요한
// 지연을 더할 뿐이라 판단했다.
export async function generateTitleFromUserMessage({
  message,
}: {
  message: UIMessage;
}): Promise<string> {
  const text = getTextFromMessage(message).trim().replace(/\s+/g, " ");
  if (text.length <= TITLE_MAX_LENGTH) return text || "새 대화";
  return `${text.slice(0, TITLE_MAX_LENGTH)}…`;
}

export async function deleteTrailingMessages({ id }: { id: string }) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const [message] = await getMessageById({ id });
  if (!message) {
    throw new Error("Message not found");
  }

  const chat = await getChatById({ id: message.chatId });
  if (!chat || chat.userId !== Number(session.user.id)) {
    throw new Error("Unauthorized");
  }

  await deleteMessagesByChatIdAfterTimestamp({
    chatId: message.chatId,
    timestamp: message.createdAt,
  });
}

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const chat = await getChatById({ id: chatId });
  if (!chat || chat.userId !== Number(session.user.id)) {
    throw new Error("Unauthorized");
  }

  await updateChatVisibilityById({ chatId, visibility });
}
