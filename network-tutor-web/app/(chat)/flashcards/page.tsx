"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StarIcon } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { ExamRunner, type ExamStartResponse } from "@/components/exam/exam-runner";
import { toast } from "@/components/chat/toast";

interface TreeNode {
  id: number;
  sectionNo: string;
  title: string;
  topic: string;
}
type Tree = Record<string, Record<string, TreeNode[]>>;

interface FlatCard extends TreeNode {
  subject: string;
  category: string;
}

export default function FlashcardsPage() {
  const searchParams = useSearchParams();
  const targetNodeId = searchParams.get("nodeId");
  const jumpedRef = useRef(false);
  const [tree, setTree] = useState<Tree | null>(null);
  const [subject, setSubject] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [showBookmarkedOnly, setShowBookmarkedOnly] = useState(false);
  const [bookmarked, setBookmarked] = useState<Set<number>>(new Set());
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [bodyMd, setBodyMd] = useState<string | null>(null);
  const [startingPractice, setStartingPractice] = useState(false);
  const [practiceStart, setPracticeStart] = useState<ExamStartResponse | null>(null);

  useEffect(() => {
    fetch("/api/ontology/tree").then((r) => r.json()).then(setTree);
    fetch("/api/bookmarks")
      .then((r) => r.json())
      .then((rows: { concept_node_id: number }[]) => setBookmarked(new Set(rows.map((r) => r.concept_node_id))))
      .catch(() => undefined);
  }, []);

  const allCards = useMemo<FlatCard[]>(() => {
    if (!tree) return [];
    const out: FlatCard[] = [];
    for (const [subj, categories] of Object.entries(tree)) {
      for (const [cat, nodes] of Object.entries(categories)) {
        for (const n of nodes) out.push({ ...n, subject: subj, category: cat });
      }
    }
    return out;
  }, [tree]);

  const cards = useMemo(() => {
    let list = subject === "all" ? allCards : allCards.filter((c) => c.subject === subject);
    if (showBookmarkedOnly) list = list.filter((c) => bookmarked.has(c.id));
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) => c.title.toLowerCase().includes(q) || c.topic.toLowerCase().includes(q) || c.sectionNo.toLowerCase().includes(q),
      );
    }
    return list;
  }, [allCards, subject, showBookmarkedOnly, bookmarked, search]);

  const current = cards[index];

  // 오답노트 등 다른 화면에서 "이 개념 플래시카드로 복습"으로 넘어올 때 그 카드로 바로 열리게 한다 —
  // 한 번만 점프하고, 그 뒤엔 사용자가 직접 넘기는 대로 둔다.
  useEffect(() => {
    if (jumpedRef.current || !targetNodeId || allCards.length === 0) return;
    const idx = allCards.findIndex((c) => c.id === Number(targetNodeId));
    if (idx !== -1) {
      jumpedRef.current = true;
      setSubject("all");
      setShowBookmarkedOnly(false);
      setIndex(idx);
      setFlipped(true);
    }
  }, [targetNodeId, allCards]);

  useEffect(() => {
    setIndex(0);
    setFlipped(false);
  }, [subject, showBookmarkedOnly, search]);

  useEffect(() => {
    setFlipped(false);
    setBodyMd(null);
    if (!current) return;
    fetch(`/api/ontology/node/${current.id}`)
      .then((r) => r.json())
      .then((d) => setBodyMd(d.node?.body_md ?? d.node?.body_text ?? ""));
  }, [current]);

  const toggleBookmark = async () => {
    if (!current) return;
    const isBookmarked = bookmarked.has(current.id);
    setBookmarked((prev) => {
      const next = new Set(prev);
      isBookmarked ? next.delete(current.id) : next.add(current.id);
      return next;
    });
    await fetch(`/api/bookmarks/${current.id}`, { method: isBookmarked ? "DELETE" : "POST" });
  };

  const subjects = Object.keys(tree ?? {});

  const practiceThisConcept = async () => {
    if (!current) return;
    setStartingPractice(true);
    try {
      const res = await fetch(`/api/exam/concept/${current.id}/practice-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: current.title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "시작할 수 없습니다.");
      setPracticeStart(data);
    } catch (err) {
      toast({ type: "error", description: err instanceof Error ? err.message : "오류가 발생했습니다." });
    } finally {
      setStartingPractice(false);
    }
  };

  if (practiceStart) {
    return <ExamRunner proctored={false} start={practiceStart} />;
  }

  if (!tree) return <div className="px-4 py-10 text-center text-muted-foreground">불러오는 중...</div>;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-6 sm:px-4 sm:py-8">
      <div>
        <h1 className="font-semibold text-xl">플래시카드</h1>
        <p className="text-muted-foreground text-sm">카드를 눌러 뒤집으면 정의를 확인할 수 있습니다.</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          className="sm:w-56"
          onChange={(e) => setSearch(e.target.value)}
          placeholder="개념 이름/단원 검색"
          value={search}
        />
        <Select onValueChange={setSubject} value={subject}>
          <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 과목</SelectItem>
            {subjects.map((s) => (
              <SelectItem key={s} value={s}>{s.replace(/^\d과목_/, "")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-[13px]">
          <input
            checked={showBookmarkedOnly}
            onChange={(e) => setShowBookmarkedOnly(e.target.checked)}
            type="checkbox"
          />
          북마크만 보기
        </label>
      </div>

      {cards.length === 0 ? (
        <p className="text-muted-foreground text-sm">해당하는 카드가 없습니다.</p>
      ) : (
        <>
          <div className="flex items-center justify-between text-muted-foreground text-sm">
            <span>{index + 1} / {cards.length}</span>
            <button onClick={toggleBookmark} type="button">
              <StarIcon className={`size-5 ${bookmarked.has(current.id) ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
            </button>
          </div>

          <div className="min-h-64 overflow-hidden rounded-2xl border border-border/50 bg-card shadow-[var(--shadow-card)] transition-shadow duration-200 hover:shadow-[var(--shadow-float)]">
            {!flipped ? (
              <button
                className="flex h-full min-h-64 w-full flex-col items-center justify-center gap-2 p-6 text-center transition-colors hover:border-ring"
                onClick={() => setFlipped(true)}
                type="button"
              >
                <span className="text-muted-foreground text-xs">{current.subject.replace(/^\d과목_/, "")} · {current.topic}</span>
                <span className="font-semibold text-lg">{current.title}</span>
                <span className="mt-4 text-muted-foreground text-xs">눌러서 정의 보기</span>
              </button>
            ) : (
              <div className="flex flex-col gap-3 p-6">
                <div className="overflow-x-auto">
                  {bodyMd === null ? (
                    <p className="text-muted-foreground text-sm">불러오는 중...</p>
                  ) : (
                    <MessageResponse>{bodyMd}</MessageResponse>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <button
                    className="text-muted-foreground text-xs transition-colors hover:text-foreground"
                    onClick={() => setFlipped(false)}
                    type="button"
                  >
                    ← 앞면으로
                  </button>
                  <Button disabled={startingPractice} onClick={practiceThisConcept} size="sm" variant="outline">
                    {startingPractice ? "준비 중..." : "이 개념 문제 풀어보기"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-between gap-2">
            <Button
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              variant="outline"
            >
              이전
            </Button>
            <Button
              disabled={index === cards.length - 1}
              onClick={() => setIndex((i) => Math.min(cards.length - 1, i + 1))}
            >
              다음
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
