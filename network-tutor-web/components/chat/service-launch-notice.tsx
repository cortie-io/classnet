"use client";
import { useEffect, useState } from "react";
export function ServiceLaunchNotice() {
  const [stage, setStage] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/settings/service-launch", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (live && d) setStage(d.stage);
        })
        .catch(() => {});
    void load();
    const t = setInterval(load, 15000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  if (!stage || stage === "official") return null;
  return (
    <div
      role="status"
      className="border-b bg-accent px-4 py-2 text-center text-xs text-accent-foreground"
    >
      {stage === "starting"
        ? "정식 운영 전환 중입니다. 기존 학습 기록은 유지됩니다. 잠시 후 다시 접속해 주세요."
        : "2차 사전 운영 중입니다. 정식 시작 후에도 현재 학습 기록과 순위를 이어갑니다."}
    </div>
  );
}
