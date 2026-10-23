"use client";

import { subjectLabel } from "@/lib/subject";
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
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LayersIcon,
  RotateCwIcon,
  StarIcon,
} from "lucide-react";
import {
  PageIntro,
  PageLoading,
  PageNotice,
} from "@/components/chat/page-intro";
import { MessageResponse } from "@/components/ai-elements/message";
import { handOffAttempt } from "@/lib/attempt-handoff";
import { useRouter } from "next/navigation";
import { toast } from "@/components/chat/toast";
import { loadJson } from "@/components/load-json";

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
  const router = useRouter();
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

  useEffect(() => {
    loadJson("/api/ontology/tree", setTree);
    fetch("/api/bookmarks")
      .then((r) => r.json())
      .then((rows: { concept_node_id: number }[]) =>
        setBookmarked(new Set(rows.map((r) => r.concept_node_id)))
      )
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
    let list =
      subject === "all"
        ? allCards
        : allCards.filter((c) => c.subject === subject);
    if (showBookmarkedOnly) list = list.filter((c) => bookmarked.has(c.id));
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.topic.toLowerCase().includes(q) ||
          c.sectionNo.toLowerCase().includes(q)
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
    await fetch(`/api/bookmarks/${current.id}`, {
      method: isBookmarked ? "DELETE" : "POST",
    });
  };

  const subjects = Object.keys(tree ?? {});

  const practiceThisConcept = async () => {
    if (!current) return;
    setStartingPractice(true);
    try {
      const res = await fetch(
        `/api/exam/concept/${current.id}/practice-start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: current.title }),
        }
      );
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
      setStartingPractice(false);
    }
  };

  if (!tree) return <PageLoading />;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
      <PageIntro
        description="카드를 눌러 뒤집으면 개념의 정의를 확인할 수 있어요."
        icon={LayersIcon}
        title="플래시카드"
      />

      <div className="surface flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
        <Input
          className="sm:w-56"
          onChange={(e) => setSearch(e.target.value)}
          placeholder="개념 이름/단원 검색"
          value={search}
        />
        <Select onValueChange={setSubject} value={subject}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 과목</SelectItem>
            {subjects.map((s) => (
              <SelectItem key={s} value={s}>
                {subjectLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 px-1 font-medium text-[13px] sm:ml-auto">
          <input
            className="size-4 accent-primary"
            checked={showBookmarkedOnly}
            onChange={(e) => setShowBookmarkedOnly(e.target.checked)}
            type="checkbox"
          />
          북마크만 보기
        </label>
      </div>

      {cards.length === 0 ? (
        <PageNotice icon={LayersIcon} title="해당하는 카드가 없어요" />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-1 items-center gap-3">
              <span className="font-semibold text-[13px] text-foreground tabular-nums">
                {index + 1}
                <span className="font-normal text-muted-foreground">
                  {" "}
                  / {cards.length}
                </span>
              </span>
              <div className="h-1.5 max-w-60 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-300"
                  style={{ width: `${((index + 1) / cards.length) * 100}%` }}
                />
              </div>
            </div>
            <button
              aria-label={bookmarked.has(current.id) ? "북마크 해제" : "북마크"}
              className="flex size-9 items-center justify-center rounded-full border border-border bg-card shadow-[var(--shadow-card)] transition-colors hover:border-amber-300"
              onClick={toggleBookmark}
              type="button"
            >
              <StarIcon
                className={`size-[18px] ${bookmarked.has(current.id) ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
              />
            </button>
          </div>

          <div
            className={`min-h-72 overflow-hidden rounded-[1.5rem] border shadow-[var(--shadow-card)] transition-shadow duration-200 hover:shadow-[var(--shadow-float)] ${flipped ? "border-border bg-card" : "border-primary/15 bg-brand-soft"}`}
          >
            {!flipped ? (
              <button
                className="relative flex h-full min-h-72 w-full flex-col items-center justify-center gap-3 p-8 text-center"
                onClick={() => setFlipped(true)}
                type="button"
              >
                <span className="absolute inset-0 bg-dots opacity-60 [mask-image:radial-gradient(closest-side,transparent_40%,black)]" />
                <span className="relative rounded-full bg-white/80 px-3 py-1 font-medium text-[12px] text-primary shadow-[var(--shadow-card)]">
                  {subjectLabel(current.subject)} · {current.topic}
                </span>
                <span className="relative font-bold text-[26px] text-foreground tracking-[-0.03em]">
                  {current.title}
                </span>
                <span className="relative mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                  <RotateCwIcon className="size-3.5" />
                  눌러서 정의 보기
                </span>
              </button>
            ) : (
              <div className="flex flex-col gap-4 p-6 sm:p-8">
                <span className="w-fit rounded-full bg-accent px-3 py-1 font-semibold text-[12px] text-primary">
                  {current.title}
                </span>
                <div className="overflow-x-auto text-[14px] leading-[1.75]">
                  {bodyMd === null ? (
                    <p className="text-muted-foreground text-sm">
                      불러오는 중...
                    </p>
                  ) : (
                    <MessageResponse>{bodyMd}</MessageResponse>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 border-border border-t pt-4">
                  <button
                    className="rounded-full px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
                    onClick={() => setFlipped(false)}
                    type="button"
                  >
                    ← 앞면으로
                  </button>
                  <Button
                    disabled={startingPractice}
                    onClick={practiceThisConcept}
                    size="sm"
                    variant="outline"
                  >
                    {startingPractice ? "준비 중..." : "이 개념 문제 풀어보기"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-between gap-2">
            <Button
              className="h-11 rounded-xl px-5"
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              variant="outline"
            >
              <ChevronLeftIcon className="size-4" />
              이전
            </Button>
            <Button
              className="h-11 rounded-xl bg-brand px-5"
              disabled={index === cards.length - 1}
              onClick={() => setIndex((i) => Math.min(cards.length - 1, i + 1))}
            >
              다음
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
