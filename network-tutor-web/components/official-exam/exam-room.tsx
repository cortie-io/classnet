"use client";

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExpandIcon,
  Loader2Icon,
  LockIcon,
  SendIcon,
  ShieldCheckIcon,
  TimerIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrandMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

// 공식 모의시험 응시 화면. 브라우저로 막을 수 있는 것은 막고(전체화면 강제, 복사·붙여넣기·우클릭·인쇄·
// 단축키 차단, 화면을 벗어나면 문제 가림), 막을 수 없는 것(다른 기기로 검색, 화면 촬영)은 기록·억제한다
// (모든 이탈을 서버에 기록, 이름·학번 워터마크). 실제 판정(마감·위반 누적 자동 제출·다른 기기 차단)은
// 전부 서버가 한다 — 이 화면을 고쳐도 우회할 수 없다(network-tutor-server/src/exam/officialExam.ts).

interface Question {
  questionId: number;
  stem: string;
  questionType: "multiple_choice" | "short_answer" | "subjective" | "essay";
  choices: string[];
  maxScore: number;
  stemImageUrl: string | null;
}

interface StartPayload {
  attemptId: number;
  examId: number;
  title: string;
  questions: Question[];
  savedAnswers: Record<number, { selectedIndex?: number; answerText?: string }>;
  deadlineAt: string;
  serverNow: string;
  maxViolations: number;
  violations: number;
  deviceToken?: string;
  watermark: string;
}

interface ExamInfo {
  id: number;
  title: string;
  description: string | null;
  durationMinutes: number;
  scheduledStart: string;
  scheduledEnd: string;
  questionCount: number;
  status: "upcoming" | "open" | "closed";
  myStatus: string;
}

type Phase = "loading" | "intro" | "taking" | "finished" | "error";

const tokenKey = (examId: number) => `classnet:official-exam-token:${examId}`;
function readToken(examId: number): string | null {
  try {
    return localStorage.getItem(tokenKey(examId));
  } catch {
    return null;
  }
}
function writeToken(examId: number, token: string) {
  try {
    localStorage.setItem(tokenKey(examId), token);
  } catch {
    /* 저장이 막힌 브라우저 — 이 탭이 살아 있는 동안은 메모리 값으로 계속 응시할 수 있다 */
  }
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
  }
}

async function api<T>(
  path: string,
  init: {
    method?: "GET" | "POST";
    body?: unknown;
    token?: string | null;
    keepalive?: boolean;
  } = {}
): Promise<T> {
  const res = await fetch(
    path ? `/api/official-exams/${path}` : "/api/official-exams",
    {
      method: init.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(init.token ? { "x-exam-token": init.token } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      keepalive: init.keepalive,
      cache: "no-store",
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new ApiError(
      data?.error ?? "요청을 처리하지 못했어요.",
      res.status,
      data?.code
    );
  return data as T;
}

const fullscreenSupported = () =>
  typeof document !== "undefined" && !!document.fullscreenEnabled;
const isFullscreen = () =>
  typeof document !== "undefined" && !!document.fullscreenElement;

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function OfficialExamRoom({ examId }: { examId: number }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [info, setInfo] = useState<ExamInfo | null>(null);
  const [errorText, setErrorText] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [exam, setExam] = useState<StartPayload | null>(null);
  const [finishedReason, setFinishedReason] = useState<
    "submitted" | "auto" | "already"
  >("submitted");

  const tokenRef = useRef<string | null>(null);
  const offsetRef = useRef(0);

  useEffect(() => {
    api<ExamInfo[]>("")
      .then((list) => {
        const found = Array.isArray(list)
          ? (list.find((e) => e.id === examId) ?? null)
          : null;
        if (!found) {
          setErrorText("시험을 찾을 수 없어요.");
          setPhase("error");
          return;
        }
        setInfo(found);
        if (
          found.myStatus === "submitted" ||
          found.myStatus === "auto_submitted"
        ) {
          setFinishedReason("already");
          setPhase("finished");
        } else {
          setPhase("intro");
        }
      })
      .catch((err) => {
        setErrorText(
          err instanceof Error ? err.message : "시험 정보를 불러오지 못했어요."
        );
        setPhase("error");
      });
  }, [examId]);

  const begin = async () => {
    setStarting(true);
    try {
      if (fullscreenSupported() && !isFullscreen()) {
        await document.documentElement
          .requestFullscreen({ navigationUI: "hide" })
          .catch(() => undefined);
      }
      const token = readToken(examId);
      const payload = await api<StartPayload>(`${examId}/start`, {
        method: "POST",
        body: {},
        token,
      });
      if (payload.deviceToken) writeToken(examId, payload.deviceToken);
      tokenRef.current = payload.deviceToken ?? token;
      offsetRef.current = new Date(payload.serverNow).getTime() - Date.now();
      setExam(payload);
      setPhase("taking");
    } catch (err) {
      if (err instanceof ApiError && err.code === "ALREADY_SUBMITTED") {
        setFinishedReason("already");
        setPhase("finished");
      } else {
        setErrorText(
          err instanceof Error ? err.message : "시험을 시작하지 못했어요."
        );
      }
      if (isFullscreen()) document.exitFullscreen().catch(() => undefined);
    } finally {
      setStarting(false);
    }
  };

  const finish = useCallback((reason: "submitted" | "auto") => {
    setFinishedReason(reason);
    setPhase("finished");
    if (isFullscreen()) document.exitFullscreen().catch(() => undefined);
  }, []);

  if (phase === "loading") {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> 시험 정보를 불러오는
          중…
        </div>
      </Shell>
    );
  }

  if (phase === "error") {
    return (
      <Shell>
        <div className="surface mx-auto mt-16 max-w-md p-8 text-center">
          <AlertTriangleIcon className="mx-auto size-8 text-amber-500" />
          <p className="mt-3 font-semibold text-[15px]">{errorText}</p>
          <Button asChild className="mt-6" variant="outline">
            <Link href="/official-exams">시험 목록으로</Link>
          </Button>
        </div>
      </Shell>
    );
  }

  if (phase === "finished") {
    return (
      <Shell>
        <div className="surface mx-auto mt-16 max-w-md p-8 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-600">
            <CheckCircle2Icon className="size-7" />
          </div>
          <p className="mt-4 font-bold text-[20px] tracking-tight">
            {finishedReason === "auto"
              ? "시험이 자동으로 제출됐어요"
              : finishedReason === "already"
                ? "이미 응시를 마친 시험이에요"
                : "제출을 마쳤어요"}
          </p>
          <p className="mt-2 text-[13.5px] text-muted-foreground leading-relaxed">
            {finishedReason === "auto"
              ? "제한 시간이 끝났거나, 화면 이탈 같은 위반이 정해진 횟수에 닿아 서버가 제출했어요. "
              : ""}
            결과는 선생님이 공개하면{" "}
            <b className="text-foreground">공식 모의시험</b> 메뉴에서 확인할 수
            있어요.
          </p>
          <Button asChild className="mt-6 rounded-xl bg-brand">
            <Link href="/official-exams">공식 모의시험 목록으로</Link>
          </Button>
        </div>
      </Shell>
    );
  }

  if (phase === "intro" && info) {
    const fsOk = fullscreenSupported();
    return (
      <Shell>
        <div className="mx-auto mt-10 max-w-2xl">
          <div className="surface overflow-hidden">
            <div className="border-border border-b bg-brand-soft px-6 py-5">
              <span className="rounded-full bg-white/80 px-2.5 py-1 font-semibold text-[11.5px] text-primary">
                공식 모의시험
              </span>
              <h1 className="mt-3 font-bold text-[24px] tracking-tight">
                {info.title}
              </h1>
              {info.description ? (
                <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] text-muted-foreground">
                  {info.description}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-foreground/80">
                <span>
                  문항 <b>{info.questionCount}</b>개
                </span>
                <span>
                  제한 시간 <b>{info.durationMinutes}</b>분
                </span>
                <span>
                  마감 {new Date(info.scheduledEnd).toLocaleString("ko-KR")}
                </span>
              </div>
            </div>
            <div className="px-6 py-5">
              <h2 className="flex items-center gap-2 font-semibold text-[14px]">
                <ShieldCheckIcon className="size-4 text-primary" /> 응시 규칙
              </h2>
              <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-[13.5px] text-foreground/85 leading-relaxed">
                <li>
                  응시는 한 번만 할 수 있고, 시작하면 제한 시간이 흐릅니다(응시
                  기간 마감 시각을 넘을 수 없어요).
                </li>
                {fsOk ? (
                  <li>
                    시험은 전체화면에서만 볼 수 있어요. 전체화면을 벗어나면
                    문제가 가려지고 위반으로 기록돼요.
                  </li>
                ) : null}
                <li>
                  다른 탭·창·앱으로 이동하면 위반으로 기록되고, 위반이 쌓이면
                  시험이 자동으로 제출돼요.
                </li>
                <li>
                  응시 중에는 AI 튜터·문제은행 등 다른 기능을 쓸 수 없어요.
                </li>
                <li>처음 시작한 기기(브라우저)에서만 이어서 풀 수 있어요.</li>
                <li>
                  복사·붙여넣기·우클릭·인쇄·화면 캡처 키는 막혀 있고, 화면에는
                  이름·학번이 표시돼요.
                </li>
                <li>
                  답은 고를 때마다 바로 저장돼요. 점수와 정답은 선생님이 공개한
                  뒤에 볼 수 있어요.
                </li>
              </ul>
              <label className="mt-5 flex items-center gap-2.5 rounded-xl bg-muted/70 px-4 py-3 font-medium text-[13.5px]">
                <input
                  checked={agreed}
                  className="size-4"
                  onChange={(e) => setAgreed(e.target.checked)}
                  type="checkbox"
                />
                위 규칙을 확인했고, 부정행위를 하지 않겠습니다.
              </label>
              {errorText ? (
                <p className="mt-3 rounded-xl bg-destructive/8 px-4 py-3 text-[13px] text-destructive">
                  {errorText}
                </p>
              ) : null}
              <Button
                className="mt-5 h-12 w-full gap-2 rounded-xl bg-brand text-[15px]"
                disabled={
                  !agreed ||
                  starting ||
                  (info.status !== "open" && info.myStatus !== "in_progress")
                }
                onClick={begin}
              >
                {starting ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <ExpandIcon className="size-4" />
                )}
                {info.myStatus === "in_progress"
                  ? "이어서 응시하기"
                  : info.status === "upcoming"
                    ? "아직 응시 기간이 아니에요"
                    : info.status === "closed"
                      ? "응시 기간이 끝났어요"
                      : fsOk
                        ? "전체화면으로 시험 시작"
                        : "시험 시작"}
              </Button>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === "taking" && exam) {
    return (
      <TakingView
        exam={exam}
        offsetRef={offsetRef}
        onFinish={finish}
        tokenRef={tokenRef}
      />
    );
  }
  return null;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background px-4 pb-16">
      <header className="mx-auto flex max-w-5xl items-center gap-2.5 py-5">
        <BrandMark className="size-8" />
        <span className="font-extrabold text-[17px] tracking-[-0.04em]">
          classnet
        </span>
        <span className="rounded-md bg-brand px-1.5 py-0.5 font-bold text-[10px] text-white">
          공식 모의시험
        </span>
      </header>
      {children}
    </div>
  );
}

const VIOLATION_LABEL: Record<string, string> = {
  tab_hidden: "다른 탭·앱으로 이동",
  window_blur: "다른 창으로 이동",
  fullscreen_exit: "전체화면 해제",
  multiple_tabs: "같은 시험을 여러 탭에서 열기",
  devtools_open: "개발자 도구 열기",
  screenshot_key: "화면 캡처 키",
};

function TakingView({
  exam,
  tokenRef,
  offsetRef,
  onFinish,
}: {
  exam: StartPayload;
  tokenRef: React.MutableRefObject<string | null>;
  offsetRef: React.MutableRefObject<number>;
  onFinish: (reason: "submitted" | "auto") => void;
}) {
  const { attemptId, questions } = exam;
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Record<number, number>>(() =>
    Object.fromEntries(
      Object.entries(exam.savedAnswers)
        .filter(([, a]) => a.selectedIndex !== undefined)
        .map(([q, a]) => [Number(q), a.selectedIndex!])
    )
  );
  const [texts, setTexts] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      Object.entries(exam.savedAnswers)
        .filter(([, a]) => a.answerText !== undefined)
        .map(([q, a]) => [Number(q), a.answerText!])
    )
  );
  const [saveState, setSaveState] = useState<
    Record<number, "saving" | "saved" | "failed">
  >(() =>
    Object.fromEntries(
      Object.keys(exam.savedAnswers).map((q) => [Number(q), "saved" as const])
    )
  );
  const [deadline, setDeadline] = useState(new Date(exam.deadlineAt).getTime());
  const [now, setNow] = useState(Date.now() + offsetRef.current);
  const [violations, setViolations] = useState(exam.violations);
  const [warning, setWarning] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<"fullscreen" | "hidden" | null>(
    fullscreenSupported() && !isFullscreen() ? "fullscreen" : null
  );
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const doneRef = useRef(false);
  const lastIncidentRef = useRef(0);
  const saveChain = useRef<Record<number, Promise<unknown>>>({});

  const end = useCallback(
    (reason: "submitted" | "auto") => {
      if (doneRef.current) return;
      doneRef.current = true;
      onFinish(reason);
    },
    [onFinish]
  );

  const handleApiError = useCallback(
    (err: unknown) => {
      if (
        err instanceof ApiError &&
        (err.status === 409 || err.status === 404)
      ) {
        // 다른 기기로 잠겼거나, 서버가 이미 제출(시간 종료·위반 누적)한 경우.
        end("auto");
        return true;
      }
      return false;
    },
    [end]
  );

  /** 위반 한 건 보고. 한 행동(예: Alt+Tab)이 탭 이탈·전체화면 해제·창 이동을 동시에 일으키므로 2초 안의 신호는 한 건으로 묶는다. */
  const report = useCallback(
    (
      eventType: string,
      detail: Record<string, unknown> = {},
      opts: { violation?: boolean } = { violation: true }
    ) => {
      if (doneRef.current) return;
      if (opts.violation) {
        const t = Date.now();
        if (t - lastIncidentRef.current < 2000) return;
        lastIncidentRef.current = t;
        setWarning(VIOLATION_LABEL[eventType] ?? "부정행위 의심 행동");
      }
      api<{ autoSubmitted: boolean; violations: number }>(
        `attempts/${attemptId}/event`,
        {
          method: "POST",
          body: { eventType, detail },
          token: tokenRef.current,
          keepalive: true,
        }
      )
        .then((r) => {
          setViolations(r.violations);
          if (r.autoSubmitted) end("auto");
        })
        .catch(handleApiError);
    },
    [attemptId, end, handleApiError, tokenRef]
  );

  // ----- 시계·서버 신호 -----
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now() + offsetRef.current), 500);
    return () => clearInterval(tick);
  }, [offsetRef]);

  const heartbeat = useCallback(() => {
    if (doneRef.current) return;
    api<{
      status: string;
      deadlineAt: string;
      serverNow: string;
      violations: number;
    }>(`attempts/${attemptId}/heartbeat`, {
      method: "POST",
      body: {},
      token: tokenRef.current,
    })
      .then((r) => {
        offsetRef.current = new Date(r.serverNow).getTime() - Date.now();
        setDeadline(new Date(r.deadlineAt).getTime());
        setViolations(r.violations);
        if (r.status !== "in_progress") end("auto");
      })
      .catch(handleApiError);
  }, [attemptId, end, handleApiError, offsetRef, tokenRef]);

  useEffect(() => {
    const id = setInterval(heartbeat, 15_000);
    return () => clearInterval(id);
  }, [heartbeat]);

  useEffect(() => {
    if (now >= deadline) heartbeat(); // 서버가 마감 처리를 하고 status로 알려 준다
  }, [now, deadline, heartbeat]);

  // ----- 감독(차단 + 기록) -----
  useEffect(() => {
    let blurredAt: number | null = null;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        setBlocked("hidden");
        report("tab_hidden");
      } else {
        setBlocked(
          fullscreenSupported() && !isFullscreen() ? "fullscreen" : null
        );
        heartbeat();
      }
    };
    const onBlur = () => {
      blurredAt = Date.now();
    };
    const onFocus = () => {
      if (
        blurredAt &&
        Date.now() - blurredAt > 2000 &&
        document.visibilityState === "visible"
      ) {
        report("window_blur", {
          sec: Math.round((Date.now() - blurredAt) / 1000),
        });
      }
      blurredAt = null;
    };
    const onFullscreen = () => {
      if (!isFullscreen() && fullscreenSupported()) {
        setBlocked("fullscreen");
        report("fullscreen_exit");
      } else if (document.visibilityState === "visible") {
        setBlocked(null);
      }
    };
    const block = (type: string) => (e: Event) => {
      e.preventDefault();
      report(type, {}, { violation: false });
    };
    const onCopy = block("copy");
    const onCut = block("cut");
    const onPaste = block("paste");
    const onContext = block("right_click");
    const onDrag = (e: Event) => e.preventDefault();
    const onSelect = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("textarea, input")) return;
      e.preventDefault();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      const devtools =
        k === "f12" ||
        (mod && e.shiftKey && ["i", "j", "c"].includes(k)) ||
        (e.metaKey && e.altKey && ["i", "j", "c"].includes(k));
      if (
        devtools ||
        (mod && ["c", "x", "v", "a", "p", "s", "u", "f", "g"].includes(k)) ||
        k === "printscreen"
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (k === "printscreen") report("screenshot_key");
        else
          report(
            devtools ? "shortcut" : k === "p" ? "print" : "shortcut",
            { key: k },
            { violation: false }
          );
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "printscreen") {
        report("screenshot_key");
        navigator.clipboard?.writeText("").catch(() => undefined);
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (doneRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onContext);
    document.addEventListener("dragstart", onDrag);
    document.addEventListener("selectstart", onSelect);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("beforeunload", onBeforeUnload);

    if (!fullscreenSupported())
      report("fullscreen_unsupported", {}, { violation: false });

    // 개발자 도구 감지(완벽하지 않은 휴리스틱): 도킹된 개발자 도구는 창 안쪽 크기를 줄인다.
    let devtoolsOpen = false;
    const devtoolsTimer = setInterval(() => {
      const open =
        window.outerWidth - window.innerWidth > 200 ||
        window.outerHeight - window.innerHeight > 200;
      if (open && !devtoolsOpen && isFullscreen()) report("devtools_open");
      devtoolsOpen = open;
    }, 2000);

    // 같은 응시를 다른 탭에서 열었는지(같은 브라우저).
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(`classnet-official-${attemptId}`);
      channel.onmessage = (e) => {
        if (e.data === "ping") channel?.postMessage("pong");
        if (e.data === "ping" || e.data === "pong") report("multiple_tabs");
      };
      channel.postMessage("ping");
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onContext);
      document.removeEventListener("dragstart", onDrag);
      document.removeEventListener("selectstart", onSelect);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
      clearInterval(devtoolsTimer);
      channel?.close();
    };
  }, [attemptId, heartbeat, report]);

  // ----- 답 저장 -----
  const save = (
    questionId: number,
    body: { selectedIndex?: number; answerText?: string }
  ) => {
    setSaveState((s) => ({ ...s, [questionId]: "saving" }));
    const send = () =>
      api(`attempts/${attemptId}/answer`, {
        method: "POST",
        body: { questionId, ...body },
        token: tokenRef.current,
      })
        .then(() => setSaveState((s) => ({ ...s, [questionId]: "saved" })))
        .catch((err) => {
          if (!handleApiError(err))
            setSaveState((s) => ({ ...s, [questionId]: "failed" }));
        });
    saveChain.current[questionId] = (
      saveChain.current[questionId] ?? Promise.resolve()
    ).then(send);
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      await Promise.allSettled(Object.values(saveChain.current));
      await api(`attempts/${attemptId}/submit`, {
        method: "POST",
        body: {},
        token: tokenRef.current,
      });
      end("submitted");
    } catch (err) {
      if (!handleApiError(err)) {
        setSubmitting(false);
        setWarning(
          err instanceof Error
            ? err.message
            : "제출하지 못했어요. 다시 눌러 주세요."
        );
      }
    }
  };

  const current = questions[index];
  const remaining = deadline - now;
  const answeredCount = questions.filter((q) =>
    q.questionType === "multiple_choice"
      ? selected[q.questionId] !== undefined
      : !!texts[q.questionId]?.trim()
  ).length;
  const unanswered = questions.length - answeredCount;
  const watermarkText = useMemo(
    () => `${exam.watermark} · classnet 공식 모의시험`,
    [exam.watermark]
  );

  return (
    <div
      className="relative min-h-dvh select-none bg-background print:hidden"
      onCopy={(e) => e.preventDefault()}
    >
      <style>{"@media print { body { display: none !important; } }"}</style>

      {/* 상단 바 */}
      <header className="sticky top-0 z-30 border-border border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <BrandMark className="size-7" />
          <span className="min-w-0 flex-1 truncate font-bold text-[15px]">
            {exam.title}
          </span>
          <span className="text-[12.5px] text-muted-foreground">
            {answeredCount}/{questions.length} 답함
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold text-[12px] ${
              violations > 0
                ? "bg-destructive/10 text-destructive"
                : "bg-muted text-muted-foreground"
            }`}
            title="위반이 이 횟수에 닿으면 자동 제출돼요"
          >
            <AlertTriangleIcon className="size-3.5" />
            경고 {violations}/{exam.maxViolations}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-bold text-[14px] tabular-nums ${
              remaining < 5 * 60_000
                ? "animate-pulse bg-destructive/10 text-destructive"
                : "bg-accent text-primary"
            }`}
          >
            <TimerIcon className="size-4" />
            {formatRemaining(remaining)}
          </span>
        </div>
      </header>

      <main className="relative mx-auto max-w-5xl px-4 py-6">
        {/* 워터마크 — 화면을 찍어 돌리면 누구 화면인지 드러난다 */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
        >
          <div className="absolute -inset-1/2 flex rotate-[-24deg] flex-wrap content-start gap-x-24 gap-y-20 opacity-[0.07]">
            {Array.from({ length: 120 }, (_, i) => (
              <span
                className="whitespace-nowrap font-bold text-[15px] text-foreground"
                key={i}
              >
                {watermarkText}
              </span>
            ))}
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_240px]">
          <section
            className={`surface relative p-5 sm:p-7 ${blocked ? "blur-xl" : ""}`}
          >
            {current ? (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <span className="rounded-lg bg-brand px-2.5 py-1 font-bold text-[12px] text-white">
                    Q{index + 1}
                  </span>
                  <span className="text-[12px] text-muted-foreground">
                    배점 {current.maxScore}
                  </span>
                  <span className="ml-auto text-[12px] text-muted-foreground">
                    {saveState[current.questionId] === "saving"
                      ? "저장 중…"
                      : saveState[current.questionId] === "saved"
                        ? "저장됨"
                        : saveState[current.questionId] === "failed"
                          ? "저장 실패 — 다시 선택해 주세요"
                          : ""}
                  </span>
                </div>
                <p className="whitespace-pre-wrap font-semibold text-[16px] leading-[1.7] tracking-[-0.02em]">
                  {current.stem}
                </p>
                {current.stemImageUrl ? (
                  // biome-ignore lint/performance/noImgElement: 문제 지문 이미지는 public/exam-images의 고정 자산
                  <img
                    alt="문제 지문 이미지"
                    className="pointer-events-none mt-4 max-h-80 w-fit max-w-full rounded-xl border"
                    draggable={false}
                    src={current.stemImageUrl}
                  />
                ) : null}
                {current.questionType === "multiple_choice" ? (
                  <div className="mt-5 flex flex-col gap-2.5">
                    {current.choices.map((choice, i) => {
                      const on = selected[current.questionId] === i;
                      return (
                        <button
                          aria-pressed={on}
                          className={`flex items-start gap-3 rounded-2xl border px-4 py-3.5 text-left text-[14.5px] leading-relaxed transition-all ${
                            on
                              ? "border-primary bg-accent ring-2 ring-primary/15"
                              : "border-border bg-card hover:border-primary/40"
                          }`}
                          key={i}
                          onClick={() => {
                            setSelected((s) => ({
                              ...s,
                              [current.questionId]: i,
                            }));
                            save(current.questionId, { selectedIndex: i });
                          }}
                          type="button"
                        >
                          <span
                            className={`flex size-6 shrink-0 items-center justify-center rounded-full font-bold text-[12px] ${
                              on
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {i + 1}
                          </span>
                          <span className="pt-px">{choice}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <textarea
                    className="mt-5 min-h-32 w-full rounded-xl border border-input bg-card p-3 text-[14px]"
                    onBlur={() =>
                      texts[current.questionId]?.trim() &&
                      save(current.questionId, {
                        answerText: texts[current.questionId],
                      })
                    }
                    onChange={(e) =>
                      setTexts((t) => ({
                        ...t,
                        [current.questionId]: e.target.value,
                      }))
                    }
                    placeholder="답을 입력하세요 (입력 칸을 벗어나면 저장돼요)"
                    value={texts[current.questionId] ?? ""}
                  />
                )}
                <div className="mt-6 flex items-center justify-between gap-2">
                  <Button
                    className="h-11 rounded-xl"
                    disabled={index === 0}
                    onClick={() => setIndex((i) => i - 1)}
                    variant="outline"
                  >
                    <ChevronLeftIcon className="size-4" /> 이전
                  </Button>
                  {index < questions.length - 1 ? (
                    <Button
                      className="h-11 rounded-xl bg-brand px-5"
                      onClick={() => setIndex((i) => i + 1)}
                    >
                      다음 <ChevronRightIcon className="size-4" />
                    </Button>
                  ) : (
                    <Button
                      className="h-11 gap-1.5 rounded-xl bg-brand px-5"
                      onClick={() => setConfirming(true)}
                    >
                      <SendIcon className="size-4" /> 제출하기
                    </Button>
                  )}
                </div>
              </>
            ) : null}
          </section>

          <aside className="surface h-fit p-4 lg:sticky lg:top-20">
            <p className="mb-3 font-semibold text-[13px]">문항 이동</p>
            <div className="grid grid-cols-6 gap-1.5 lg:grid-cols-5">
              {questions.map((q, i) => {
                const done =
                  q.questionType === "multiple_choice"
                    ? selected[q.questionId] !== undefined
                    : !!texts[q.questionId]?.trim();
                return (
                  <button
                    className={`h-8 rounded-lg border font-medium text-[12.5px] tabular-nums transition-colors ${
                      i === index
                        ? "border-primary bg-primary text-primary-foreground"
                        : saveState[q.questionId] === "failed"
                          ? "border-destructive bg-destructive/10 text-destructive"
                          : done
                            ? "border-primary/20 bg-accent text-primary"
                            : "border-border bg-card text-muted-foreground"
                    }`}
                    key={q.questionId}
                    onClick={() => setIndex(i)}
                    type="button"
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <Button
              className="mt-4 h-10 w-full gap-1.5 rounded-xl"
              onClick={() => setConfirming(true)}
              variant="outline"
            >
              <SendIcon className="size-4" /> 제출하기
            </Button>
          </aside>
        </div>
      </main>

      {/* 화면을 벗어났거나 전체화면이 풀리면 문제를 가린다 */}
      {blocked ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-6 backdrop-blur-xl">
          <div className="surface max-w-sm p-7 text-center">
            <LockIcon className="mx-auto size-8 text-primary" />
            <p className="mt-3 font-bold text-[17px]">
              {blocked === "fullscreen"
                ? "전체화면으로 돌아가 주세요"
                : "시험 화면으로 돌아왔어요"}
            </p>
            <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
              시험 화면을 벗어나면 위반으로 기록돼요. 현재 경고 {violations}/
              {exam.maxViolations}회 — 정해진 횟수에 닿으면 자동 제출돼요.
            </p>
            {blocked === "fullscreen" ? (
              <Button
                className="mt-5 h-11 w-full gap-2 rounded-xl bg-brand"
                onClick={() =>
                  document.documentElement
                    .requestFullscreen({ navigationUI: "hide" })
                    .catch(() => undefined)
                }
              >
                <ExpandIcon className="size-4" /> 전체화면으로 계속하기
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {warning && !blocked ? (
        <div className="fixed inset-x-0 top-16 z-40 mx-auto w-fit max-w-[92vw]">
          <div className="flex items-center gap-2.5 rounded-xl border border-destructive/30 bg-card px-4 py-2.5 text-[13px] shadow-[var(--shadow-float)]">
            <AlertTriangleIcon className="size-4 shrink-0 text-destructive" />
            <span>
              <b>{warning}</b> — 위반으로 기록됐어요 ({violations}/
              {exam.maxViolations})
            </span>
            <button
              className="ml-1 text-muted-foreground hover:text-foreground"
              onClick={() => setWarning(null)}
              type="button"
            >
              닫기
            </button>
          </div>
        </div>
      ) : null}

      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-6">
          <div className="surface w-full max-w-sm p-6">
            <p className="font-bold text-[17px]">답안을 제출할까요?</p>
            <p className="mt-2 text-[13.5px] text-muted-foreground">
              {unanswered > 0 ? (
                <>
                  아직 답하지 않은 문제가{" "}
                  <b className="text-destructive">{unanswered}개</b> 있어요.{" "}
                </>
              ) : null}
              제출하면 다시 응시할 수 없어요.
            </p>
            <div className="mt-5 flex gap-2">
              <Button
                className="h-11 flex-1 rounded-xl"
                disabled={submitting}
                onClick={() => setConfirming(false)}
                variant="outline"
              >
                계속 풀기
              </Button>
              <Button
                className="h-11 flex-1 gap-1.5 rounded-xl bg-brand"
                disabled={submitting}
                onClick={submit}
              >
                {submitting ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <SendIcon className="size-4" />
                )}
                제출
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
