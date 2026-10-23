"use client";

import { subjectLabel } from "@/lib/subject";
import { LibraryIcon, SearchIcon, SearchXIcon } from "lucide-react";
import {
  PageIntro,
  PageLoading,
  PageNotice,
} from "@/components/chat/page-intro";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { handOffAttempt } from "@/lib/attempt-handoff";
import { useRouter } from "next/navigation";
import { toast } from "@/components/chat/toast";
import { loadJson } from "@/components/load-json";

const SUBJECTS = [
  "1과목_네트워크_일반",
  "2과목_TCP_IP",
  "3과목_NOS",
  "4과목_네트워크_운용기기",
  "5과목_정보보호개론",
];

const QUESTION_TYPE_LABEL: Record<string, string> = {
  multiple_choice: "객관식",
  short_answer: "단답식",
  subjective: "주관식",
  essay: "서술형",
};

const SOURCE_LABEL: Record<string, string> = {
  ai_generated: "AI 생성",
  admin_authored: "관리자 작성",
  past_exam: "기출",
};

interface BankItem {
  id: number;
  subject: string;
  question_type: string;
  source: string;
  stem: string;
  stem_image_url: string | null;
}

const PAGE_SIZE = 20;

export default function QuestionBankPage() {
  const router = useRouter();
  const [subject, setSubject] = useState("all");
  const [questionType, setQuestionType] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<BankItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState<number | null>(null);

  // 검색어는 "검색"을 눌렀을 때만 반영한다. 예전엔 setPage(0) 직후 load()가 아직 이전 page 값으로 한 번 더
  // 요청해서, 3페이지에서 검색하면 두 응답 중 늦게 온 쪽이 이겨 결과가 비거나 엉뚱하게 나왔다.
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const requestSeqRef = useRef(0);

  const load = () => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    const params = new URLSearchParams();
    if (subject !== "all") params.set("subject", subject);
    if (questionType !== "all") params.set("questionType", questionType);
    if (appliedKeyword.trim()) params.set("q", appliedKeyword.trim());
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    loadJson<{ items?: BankItem[]; total?: number }>(
      `/api/exam/bank?${params.toString()}`,
      (d) => {
        if (seq !== requestSeqRef.current) return; // 더 나중에 보낸 요청이 있으면 이 응답은 버린다
        setItems(d.items ?? []);
        setTotal(d.total ?? 0);
      }
    ).finally(() => {
      if (seq === requestSeqRef.current) setLoading(false);
    });
  };

  useEffect(load, [subject, questionType, page, appliedKeyword]);

  const search = () => {
    setPage(0);
    setAppliedKeyword(keyword);
  };

  const solve = async (id: number) => {
    setStartingId(id);
    try {
      const res = await fetch(`/api/exam/bank/${id}/start`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "시작할 수 없습니다.");
      router.push(handOffAttempt(data));
    } catch (err) {
      toast({
        type: "error",
        description:
          err instanceof Error ? err.message : "오류가 발생했습니다.",
      });
    } finally {
      setStartingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
      <PageIntro
        description="승인된 문제를 직접 검색하고 골라서 풀어볼 수 있어요."
        icon={LibraryIcon}
        title="문제은행"
      />

      <div className="surface flex flex-col gap-2 p-3 sm:flex-row">
        <Select
          onValueChange={(v) => {
            setSubject(v);
            setPage(0);
          }}
          value={subject}
        >
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 과목</SelectItem>
            {SUBJECTS.map((s) => (
              <SelectItem key={s} value={s}>
                {subjectLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          onValueChange={(v) => {
            setQuestionType(v);
            setPage(0);
          }}
          value={questionType}
        >
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 유형</SelectItem>
            <SelectItem value="multiple_choice">객관식</SelectItem>
            <SelectItem value="short_answer">단답식</SelectItem>
            <SelectItem value="subjective">주관식</SelectItem>
            <SelectItem value="essay">서술형</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex flex-1 gap-2">
          <div className="relative flex-1">
            <SearchIcon className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="문제 내용 검색"
              value={keyword}
            />
          </div>
          <Button className="rounded-xl" onClick={search}>
            검색
          </Button>
        </div>
      </div>

      <p className="-mb-3 px-1 text-[12.5px] text-muted-foreground">
        총{" "}
        <b className="font-semibold text-foreground">
          {total.toLocaleString()}
        </b>
        개
      </p>

      {loading ? (
        <PageLoading />
      ) : items.length === 0 ? (
        <PageNotice
          description="과목·유형을 바꾸거나 다른 검색어로 찾아보세요."
          icon={SearchXIcon}
          title="조건에 맞는 문제가 없어요"
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((item) => (
            <div
              className="surface surface-hover flex items-center justify-between gap-4 p-4"
              key={item.id}
            >
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">
                    {subjectLabel(item.subject)}
                  </Badge>
                  <Badge variant="outline">
                    {QUESTION_TYPE_LABEL[item.question_type] ??
                      item.question_type}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    {SOURCE_LABEL[item.source] ?? item.source}
                  </span>
                </div>
                <p className="line-clamp-2 whitespace-pre-wrap font-medium text-[13.5px] text-foreground leading-relaxed">
                  {item.stem}
                </p>
              </div>
              <Button
                className="shrink-0 rounded-lg"
                disabled={startingId === item.id}
                onClick={() => solve(item.id)}
                size="sm"
              >
                {startingId === item.id ? "시작 중..." : "풀어보기"}
              </Button>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            size="sm"
            variant="outline"
          >
            이전
          </Button>
          <span className="text-muted-foreground text-xs">
            {page + 1} / {totalPages}
          </span>
          <Button
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            size="sm"
            variant="outline"
          >
            다음
          </Button>
        </div>
      )}
    </div>
  );
}
