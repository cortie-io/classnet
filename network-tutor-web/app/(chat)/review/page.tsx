"use client";

import {
  ArrowRightIcon,
  CalendarCheckIcon,
  PartyPopperIcon,
  RepeatIcon,
  TrophyIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageIntro, PageLoading } from "@/components/chat/page-intro";
import { toast } from "@/components/chat/toast";
import { loadJson } from "@/components/load-json";
import { Button } from "@/components/ui/button";
import { handOffAttempt } from "@/lib/attempt-handoff";
import { daysFromToday, type StudySummary } from "@/lib/study-summary";

// 오늘의 복습 — 틀린 문제를 정해진 간격으로 다시 내 준다(서버 reviewSchedule.ts). 학생은 버튼만 누르면 되고
// 선생님이 따로 설정할 것은 없다.
export default function ReviewPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<StudySummary | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    loadJson("/api/exam/study-summary", setSummary);
  }, []);

  const begin = async () => {
    setStarting(true);
    try {
      const res = await fetch("/api/exam/review/start", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "시작할 수 없어요.");
      }
      if (data.dueCount > data.includedCount) {
        toast({
          description: `복습할 문제가 ${data.dueCount}개라 이번엔 오래된 것부터 ${data.includedCount}개만 담았어요. 끝나면 이어서 더 할 수 있어요.`,
          type: "success",
        });
      }
      router.push(handOffAttempt(data));
    } catch (err) {
      toast({
        description: err instanceof Error ? err.message : "오류가 발생했어요.",
        type: "error",
      });
    } finally {
      setStarting(false);
    }
  };

  const r = summary?.review;
  const totalTracked = r ? r.dueCount + r.waitingCount + r.masteredCount : 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:py-12">
      <PageIntro
        description="틀린 문제를 잊을 만할 때 다시 풀어요. 맞히면 다음 복습이 뒤로 밀리고, 두 번 연속 맞히면 극복이에요."
        icon={RepeatIcon}
        title="오늘의 복습"
      />

      {r === undefined ? (
        <PageLoading />
      ) : (
        <>
          <div className="surface flex flex-col gap-5 p-5 sm:p-7">
            {r.dueCount > 0 ? (
              <>
                <div className="flex items-end gap-2">
                  <span className="font-bold text-[40px] text-foreground leading-none tracking-tight tabular-nums">
                    {r.dueCount}
                  </span>
                  <span className="mb-1 text-[14px] text-muted-foreground">
                    문제를 오늘 다시 풀 차례예요
                  </span>
                </div>
                <Button
                  className="h-12 gap-1.5 rounded-xl bg-brand text-[15px]"
                  disabled={starting}
                  onClick={begin}
                >
                  {starting
                    ? "준비 중..."
                    : `복습 시작 (${Math.min(r.dueCount, 20)}문제)`}
                  {starting ? null : <ArrowRightIcon className="size-4" />}
                </Button>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <PartyPopperIcon className="size-8 text-primary" />
                <p className="font-semibold text-[15px] text-foreground">
                  {totalTracked === 0
                    ? "아직 복습할 문제가 없어요"
                    : "오늘 복습은 끝났어요!"}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  {r.nextDueAt
                    ? `다음 복습은 ${daysFromToday(r.nextDueAt)} 열려요.`
                    : "문제를 풀다 틀리면 여기서 다시 만나요."}
                </p>
                <Button asChild className="mt-2" variant="outline">
                  <Link href="/practice">새 문제 풀러 가기</Link>
                </Button>
              </div>
            )}
          </div>

          {totalTracked > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <Stat icon={RepeatIcon} label="오늘 복습" value={r.dueCount} />
              <Stat
                icon={CalendarCheckIcon}
                label="기다리는 중"
                value={r.waitingCount}
              />
              <Stat icon={TrophyIcon} label="극복" value={r.masteredCount} />
            </div>
          )}

          <div className="rounded-2xl bg-muted/60 px-5 py-4 text-[12.5px] text-muted-foreground leading-relaxed">
            <p className="mb-1 font-semibold text-foreground">
              이렇게 돌아와요
            </p>
            틀린 문제는 <b className="text-foreground">다음 날</b>, 그다음
            맞히면 <b className="text-foreground">3일 뒤</b> 한 번 더 나와요.
            틀린 뒤 두 번 연속 맞히면 극복으로 빠지고, 다시 틀리면 처음부터예요.
            오답노트에서 문제마다 다음 복습 날짜를 볼 수 있어요.
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof RepeatIcon;
}) {
  return (
    <div className="surface flex flex-col gap-1.5 p-4">
      <Icon className="size-4 text-primary" />
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="font-bold text-[22px] text-foreground tabular-nums">
        {value}
      </span>
    </div>
  );
}
