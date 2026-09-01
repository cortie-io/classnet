"use client";

import { useEffect, useState } from "react";
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
import { ExamRunner, type ExamStartResponse } from "@/components/exam/exam-runner";
import { toast } from "@/components/chat/toast";

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
  const [subject, setSubject] = useState("all");
  const [questionType, setQuestionType] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<BankItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState<number | null>(null);
  const [start, setStart] = useState<ExamStartResponse | null>(null);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (subject !== "all") params.set("subject", subject);
    if (questionType !== "all") params.set("questionType", questionType);
    if (keyword.trim()) params.set("q", keyword.trim());
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    fetch(`/api/exam/bank?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items ?? []);
        setTotal(d.total ?? 0);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [subject, questionType, page]);

  const search = () => {
    setPage(0);
    load();
  };

  const solve = async (id: number) => {
    setStartingId(id);
    try {
      const res = await fetch(`/api/exam/bank/${id}/start`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "시작할 수 없습니다.");
      setStart(data);
    } catch (err) {
      toast({ type: "error", description: err instanceof Error ? err.message : "오류가 발생했습니다." });
    } finally {
      setStartingId(null);
    }
  };

  if (start) {
    return <ExamRunner proctored={false} start={start} />;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-6 sm:px-4 sm:py-8">
      <div>
        <h1 className="font-semibold text-xl">문제은행</h1>
        <p className="text-muted-foreground text-sm">승인된 문제를 직접 검색하고 골라서 풀어볼 수 있습니다.</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Select onValueChange={(v) => { setSubject(v); setPage(0); }} value={subject}>
          <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 과목</SelectItem>
            {SUBJECTS.map((s) => (
              <SelectItem key={s} value={s}>{s.replace(/^\d과목_/, "")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select onValueChange={(v) => { setQuestionType(v); setPage(0); }} value={questionType}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 유형</SelectItem>
            <SelectItem value="multiple_choice">객관식</SelectItem>
            <SelectItem value="short_answer">단답식</SelectItem>
            <SelectItem value="subjective">주관식</SelectItem>
            <SelectItem value="essay">서술형</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex flex-1 gap-2">
          <Input
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="문제 내용 검색"
            value={keyword}
          />
          <Button onClick={search} variant="outline">검색</Button>
        </div>
      </div>

      <p className="text-muted-foreground text-xs">총 {total}개</p>

      {loading ? (
        <p className="text-muted-foreground text-sm">불러오는 중...</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">조건에 맞는 문제가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <div
              className="flex items-start justify-between gap-3 rounded-xl border border-border/50 bg-card p-3.5 shadow-[var(--shadow-card)] transition-shadow duration-200 hover:shadow-[var(--shadow-float)]"
              key={item.id}
            >
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">{item.subject.replace(/^\d과목_/, "")}</Badge>
                  <Badge variant="outline">{QUESTION_TYPE_LABEL[item.question_type] ?? item.question_type}</Badge>
                  <span className="text-muted-foreground text-xs">{SOURCE_LABEL[item.source] ?? item.source}</span>
                </div>
                <p className="line-clamp-2 whitespace-pre-wrap text-[13px]">{item.stem}</p>
              </div>
              <Button disabled={startingId === item.id} onClick={() => solve(item.id)} size="sm">
                {startingId === item.id ? "시작 중..." : "풀어보기"}
              </Button>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} size="sm" variant="outline">
            이전
          </Button>
          <span className="text-muted-foreground text-xs">{page + 1} / {totalPages}</span>
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
