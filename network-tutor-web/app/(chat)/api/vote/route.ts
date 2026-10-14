import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { getChatById, getMessagesByChatId, getVotesByChatId, voteMessage } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";

const voteSchema = z.object({
  chatId: z.string(),
  messageId: z.string(),
  type: z.enum(["up", "down"]),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");

  if (!chatId) {
    return new ChatbotError(
      "bad_request:api",
      "Parameter chatId is required."
    ).toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:vote").toResponse();
  }

  const chat = await getChatById({ id: chatId });

  if (!chat) {
    return new ChatbotError("not_found:chat").toResponse();
  }

  if (chat.userId !== Number(session.user.id)) {
    return new ChatbotError("forbidden:vote").toResponse();
  }

  const votes = await getVotesByChatId({ id: chatId });

  return Response.json(votes, { status: 200 });
}

export async function PATCH(request: Request) {
  let chatId: string;
  let messageId: string;
  let type: "up" | "down";

  try {
    ({ chatId, messageId, type } = voteSchema.parse(await request.json()));
  } catch {
    return new ChatbotError(
      "bad_request:api",
      "Parameters chatId, messageId, and type are required."
    ).toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:vote").toResponse();
  }

  const chat = await getChatById({ id: chatId });

  if (!chat) {
    return new ChatbotError("not_found:vote").toResponse();
  }

  if (chat.userId !== Number(session.user.id)) {
    return new ChatbotError("forbidden:vote").toResponse();
  }

  const messages = await getMessagesByChatId({ id: chatId });
  const message = messages.find((m) => m.id === messageId && m.role === "assistant");
  if (!message) return new ChatbotError("not_found:vote").toResponse();
  if (type === "down") {
    const text = (message.parts as Array<{type: string; text?: string}>)
      .filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
    const auditId = Array.from(text.matchAll(/<!--AUDIT_LOG_ID:(\d+)-->/g)).at(-1)?.[1];
    if (auditId) {
      const response = await fetch(`${process.env.BACKEND_API_URL ?? "http://127.0.0.1:3300"}/api/audit/${auditId}/report`, {
        method: "POST",
        headers: {"Content-Type": "application/json", "x-internal-secret": process.env.INTERNAL_API_SECRET ?? ""},
        body: JSON.stringify({userId: Number(session.user.id)}),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return new ChatbotError("offline:chat").toResponse();
    }
  }

  await voteMessage({
    chatId,
    messageId,
    type,
  });

  return Response.json({ok: true});
}
