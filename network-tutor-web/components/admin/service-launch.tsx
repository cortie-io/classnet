"use client";
import { useEffect, useState } from "react";
import { useAdminPeriod } from "./service-period";
import { adminFetch } from "@/lib/admin-period";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Launch = {
  stage: "beta" | "starting" | "official";
  started_at: string | null;
  last_error: string | null;
};
export function ServiceLaunchPanel() {
  const { period } = useAdminPeriod();
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (period !== "2") return;
    let live = true;
    const load = () =>
      adminFetch("/api/admin/service-launch")
        .then(async (r) => {
          if (!r.ok) throw Error("운영 상태를 불러오지 못했습니다.");
          return r.json();
        })
        .then((d) => {
          if (live) {
            setLaunch(d);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [period]);
  if (period === "1")
    return (
      <section className="surface p-5 text-sm">
        1차 보관 기록 · 조회 전용입니다. 2차 정식 시작의 영향을 받지
        않습니다.
      </section>
    );
  async function start() {
    if (confirmation !== "2차 정식 시작" || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await adminFetch("/api/admin/service-launch/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error ?? "전환 요청에 실패했습니다.");
      setLaunch({ stage: "starting", started_at: null, last_error: null });
      setConfirming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "전환 요청에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="surface flex flex-col gap-3 p-5"
      aria-label="2차 운영 관리"
    >
      <h2 className="font-bold">
        {!launch
          ? "운영 상태 확인 중…"
          : launch.stage === "official"
            ? "2차 정식 운영"
            : launch.stage === "starting"
              ? "2차 정식 운영으로 전환 중"
              : "2차 사전 운영"}
      </h2>
      {launch?.stage === "beta" && (
        <>
          <p className="text-sm text-muted-foreground">
            지금은 사전 운영입니다. 정식 시작 후에도 대화·응시·점수·활동·북마크와
            현재 순위를 그대로 이어갑니다. 계정·비밀번호·학생 기본정보·반
            배정·문제은행·시험 설정도 유지됩니다. 1차 기록은 계속 관리자 조회가
            가능합니다.
          </p>
          {launch.last_error && (
            <p role="alert" className="text-sm text-destructive">
              {launch.last_error}
            </p>
          )}
          {!confirming ? (
            <Button className="self-start" onClick={() => setConfirming(true)}>
              정식 시작
            </Button>
          ) : (
            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <p className="text-sm">
                사전 운영 기록을 백업하고 모든 학생의 현재 데이터를 보존합니다. 전환 중에는 접속이 잠시
                중단될 수 있습니다. 정식 시작은 한
                번만 가능합니다.
              </p>
              <label className="text-sm" htmlFor="launch-confirmation">
                확인하려면 ‘2차 정식 시작’을 입력하세요.
              </label>
              <Input
                id="launch-confirmation"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
              />
              <div className="flex gap-2">
                <Button
                  variant="default"
                  disabled={busy || confirmation !== "2차 정식 시작"}
                  onClick={start}
                >
                  {busy ? "요청 중…" : "현재 기록을 유지하고 정식 시작"}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false);
                    setConfirmation("");
                  }}
                >
                  취소
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      {launch?.stage === "starting" && (
        <p role="status" className="text-sm">
          기존 기록을 보존하고 정식 운영으로 전환하고 있습니다. 접속이 잠시 끊길 수 있습니다. 잠시
          후 새로고침하고 다시 로그인해 주세요. 1차 보관 기록은 유지됩니다.
        </p>
      )}
      {launch?.stage === "official" && (
        <p className="text-sm text-muted-foreground">
          {launch.started_at
            ? new Date(launch.started_at).toLocaleString("ko-KR", {
                timeZone: "Asia/Seoul",
              })
            : ""}{" "}
          기존 학생 기록을 유지한 채 정식 운영을 시작했습니다. 1차 기록은
          차수 선택에서 조회할 수 있습니다.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {launch?.stage === "starting"
            ? "전환 중에는 연결이 잠시 끊길 수 있습니다. 잠시 후 다시 로그인해 주세요."
            : error}
        </p>
      )}
    </section>
  );
}
