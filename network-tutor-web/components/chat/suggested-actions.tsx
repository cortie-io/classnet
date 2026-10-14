"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { motion } from "framer-motion";
import { BinaryIcon, NetworkIcon, PlugZapIcon, SplitIcon } from "lucide-react";
import { memo, useCallback } from "react";
import { suggestions } from "@/lib/constants";
import type { ChatMessage } from "@/lib/types";
import { Suggestion } from "../ai-elements/suggestion";
import type { VisibilityType } from "./visibility-selector";

const KIND_STYLE = {
  subnet: { icon: NetworkIcon, tone: "bg-indigo-50 text-indigo-600" },
  binary: { icon: BinaryIcon, tone: "bg-violet-50 text-violet-600" },
  port: { icon: PlugZapIcon, tone: "bg-teal-50 text-teal-600" },
  concept: { icon: SplitIcon, tone: "bg-sky-50 text-sky-600" },
} as const;

type SuggestedActionsProps = {
  chatId: string;
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  selectedVisibilityType: VisibilityType;
};

function PureSuggestedActions({ chatId, sendMessage }: SuggestedActionsProps) {
  const suggestedActions = suggestions;
  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      window.history.pushState(
        {},
        "",
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
      );
      sendMessage({
        parts: [{ text: suggestion, type: "text" }],
        role: "user",
      });
    },
    [chatId, sendMessage]
  );

  return (
    <div
      className="flex w-full gap-2.5 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible"
      data-testid="suggested-actions"
      style={{
        msOverflowStyle: "none",
        scrollbarWidth: "none",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {suggestedActions.map((suggestedAction, index) => {
        const { icon: Icon, tone } = KIND_STYLE[suggestedAction.kind];
        return (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="w-[250px] shrink-0 sm:w-auto sm:shrink"
            exit={{ opacity: 0, y: 16 }}
            initial={{ opacity: 0, y: 16 }}
            key={suggestedAction.prompt}
            transition={{
              delay: 0.06 * index,
              duration: 0.4,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <Suggestion
              className="group/suggestion h-auto w-full items-start justify-start gap-3 whitespace-normal rounded-2xl border border-border/80 bg-card px-3.5 py-3 text-left shadow-[var(--shadow-card)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-card hover:shadow-[var(--shadow-float)]"
              onClick={handleSuggestionClick}
              suggestion={suggestedAction.prompt}
            >
              <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${tone}`}>
                <Icon className="size-4" />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-semibold text-[11.5px] text-muted-foreground">{suggestedAction.label}</span>
                <span className="font-medium text-[13px] text-foreground leading-snug">{suggestedAction.prompt}</span>
              </span>
            </Suggestion>
          </motion.div>
        );
      })}
    </div>
  );
}

export const SuggestedActions = memo(
  PureSuggestedActions,
  (prevProps, nextProps) => {
    if (prevProps.chatId !== nextProps.chatId) {
      return false;
    }
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
      return false;
    }

    return true;
  }
);
