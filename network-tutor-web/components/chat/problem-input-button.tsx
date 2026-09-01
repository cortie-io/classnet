"use client";

import { type Dispatch, type SetStateAction, useState } from "react";
import { FileQuestionIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// 예전에는 이 기능이 별도 페이지(/problem)였는데, 실제로는 "채팅 안에서 바로 문제를 입력해서 보낼 수
// 있게" 해달라는 요청이었다 — 그래서 별도 화면 대신 채팅 입력창 툴바에 버튼 하나로 넣고, 제출하면
// 채팅 입력창에 정리된 문장을 채워 넣는다(전송은 기존 전송 버튼으로). 이렇게 하면 대화 맥락(꼬리질문)도
// 그대로 이어진다 — /problem은 단발성 폼이라 그게 안 됐다.
export function ProblemInputButton({ setInput }: { setInput: Dispatch<SetStateAction<string>> }) {
  const [open, setOpen] = useState(false);
  const [stem, setStem] = useState("");
  const [choices, setChoices] = useState(["", "", "", "", ""]);

  const insert = () => {
    if (!stem.trim()) return;
    const choiceLines = choices
      .map((c, i) => c.trim() && `${String.fromCharCode(9312 + i)} ${c.trim()}`)
      .filter(Boolean)
      .join("\n");
    const composed = ["[문제]", stem.trim(), choiceLines, "", "정답과 해설을 근거와 함께 알려줘."]
      .filter(Boolean)
      .join("\n");
    setInput(composed);
    setOpen(false);
    setStem("");
    setChoices(["", "", "", "", ""]);
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className="h-8 gap-1.5 rounded-full text-muted-foreground"
            onClick={() => setOpen(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <FileQuestionIcon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">문제 입력해서 질문</TooltipContent>
      </Tooltip>

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>문제 입력해서 질문</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>문제 지문</Label>
              <Textarea
                onChange={(e) => setStem(e.target.value)}
                placeholder="예) 클래스 C 네트워크에서 서브넷 마스크가 255.255.255.192일 때, 사용 가능한 호스트 수는?"
                rows={4}
                value={stem}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>선택지 (객관식이면 입력, 아니면 비워두세요)</Label>
              {choices.map((c, i) => (
                <div className="flex items-center gap-2" key={i}>
                  <span className="w-5 text-muted-foreground text-sm">{i + 1}</span>
                  <Textarea
                    className="min-h-9 resize-none py-2"
                    onChange={(e) => {
                      const next = [...choices];
                      next[i] = e.target.value;
                      setChoices(next);
                    }}
                    rows={1}
                    value={c}
                  />
                </div>
              ))}
            </div>
            <Button disabled={!stem.trim()} onClick={insert}>
              채팅에 입력하기
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
