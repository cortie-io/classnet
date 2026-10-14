"use client";
import { useEffect, useRef, useState } from "react";
import { adminFetch } from "@/lib/admin-period";
import { Button } from "@/components/ui/button";
interface Chat {
  id: string;
  title: string;
  created_at: string;
  message_count: number;
}
interface Message {
  id: string;
  role: string;
  parts: { type: string; text?: string; url?: string }[];
  created_at: string;
}
export function StudentChats({ userId }: { userId: string }) {
  const [chats, setChats] = useState<Chat[]>([]),
    [total, setTotal] = useState(0),
    [moreChats, setMoreChats] = useState(false);
  const [selected, setSelected] = useState<Chat | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [moreMessages, setMoreMessages] = useState(false);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const loadChats = async (offset = 0, signal?: AbortSignal) => {
    setError("");
    setLoading(true);
    try {
      const r = await adminFetch(
        `/api/admin/users/${userId}/chats?limit=20&offset=${offset}`,
        { signal }
      );
      const d = await r.json();
      if (!r.ok) throw Error(d.error ?? "대화를 불러오지 못했어요.");
      if (signal?.aborted) return;
      setChats((old) => (offset ? [...old, ...d.items] : d.items));
      setTotal(d.total);
      setMoreChats(d.hasMore);
    } catch (e) {
      if (!signal?.aborted)
        setError(e instanceof Error ? e.message : "대화를 불러오지 못했어요.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };
  const loadMessages = async (chat: Chat, offset = 0) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setSelected(chat);
    if (!offset) setMessages([]);
    setError("");
    setLoading(true);
    try {
      const r = await adminFetch(
        `/api/admin/chats/${chat.id}/messages?limit=50&offset=${offset}`,
        { signal: controller.signal }
      );
      const d = await r.json();
      if (!r.ok) throw Error(d.error ?? "메시지를 불러오지 못했어요.");
      if (controller.signal.aborted) return;
      setMessages((old) => (offset ? [...old, ...d.items] : d.items));
      setMoreMessages(d.hasMore);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "메시지를 불러오지 못했어요."
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    void loadChats(0, controller.signal);
    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, [userId]);
  return (
    <section className="surface p-5">
      <h2 className="mb-1 font-semibold text-sm">채팅 대화 원문 · {total}개</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        학생이 채팅 화면에서 주고받은 메시지를 대화별로 조회합니다.
      </p>
      {error && (
        <p role="alert" className="my-2 text-sm text-destructive">
          {error}{" "}
          <Button
            onClick={() =>
              selected ? void loadMessages(selected) : void loadChats()
            }
            size="sm"
          >
            다시 시도
          </Button>
        </p>
      )}
      {!chats.length && !loading && !error && (
        <p className="text-sm text-muted-foreground">
          이 차수의 채팅 기록이 없습니다.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {chats.map((chat) => (
          <Button
            key={chat.id}
            disabled={loading}
            variant={selected?.id === chat.id ? "secondary" : "outline"}
            className="h-auto justify-between gap-4 py-3 text-left"
            onClick={() => void loadMessages(chat)}
          >
            <span className="min-w-0 whitespace-normal">{chat.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {chat.message_count}개 메시지
            </span>
          </Button>
        ))}
      </div>
      {moreChats && (
        <Button
          className="mt-3"
          disabled={loading}
          onClick={() => void loadChats(chats.length)}
          variant="outline"
        >
          이전 대화 더 보기
        </Button>
      )}
      {selected && (
        <div className="mt-5 border-t pt-4">
          <h3 className="mb-3 font-medium text-sm">{selected.title}</h3>
          <div className="flex flex-col gap-3">
            {messages.map((message) => (
              <article key={message.id} className="rounded-xl bg-muted/40 p-3">
                <p className="mb-1 text-xs text-muted-foreground">
                  {message.role === "user" ? "학생" : "AI 튜터"} ·{" "}
                  {new Date(message.created_at).toLocaleString("ko-KR")}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm">
                  {(message.parts ?? [])
                    .filter((p) => p.type === "text")
                    .map((p) => p.text ?? "")
                    .join("\n")
                    .replace(/<!--AUDIT_LOG_ID:\d+-->/g, "")}
                </p>
                {(message.parts ?? [])
                  .filter(
                    (p) =>
                      p.type === "file" &&
                      /^data:image\/(png|jpeg|webp);base64,/.test(p.url ?? "")
                  )
                  .map((part, index) => (
                    <img
                      key={index}
                      src={part.url}
                      alt="학생이 첨부한 이미지"
                      className="mt-2 max-h-80 max-w-full rounded-lg"
                    />
                  ))}
              </article>
            ))}
          </div>
          {moreMessages && (
            <Button
              className="mt-3"
              disabled={loading}
              onClick={() => void loadMessages(selected, messages.length)}
              variant="outline"
            >
              다음 메시지 더 보기
            </Button>
          )}
        </div>
      )}
      {loading && (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          불러오는 중…
        </p>
      )}
    </section>
  );
}
