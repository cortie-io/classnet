"use client";

import { useEffect, useState } from "react";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari 전용 속성 — 표준 API가 아니라 타입 정의에 없어 별도로 캐스팅한다.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function InstallAppButton() {
  const [installed, setInstalled] = useState(true); // 서버 렌더링 시에는 숨겨두고, 클라이언트에서 판단되면 보여준다
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;
  // 안드로이드/크롬은 beforeinstallprompt가 와야 실제 설치가 가능하고, iOS는 그 이벤트 자체가 없어
  // 수동 안내로 대신한다. 둘 다 아니면(설치를 지원 안 하는 브라우저) 버튼을 아예 숨긴다.
  if (!deferredPrompt && !isIOS()) return null;

  const handleClick = async () => {
    if (isIOS()) {
      setShowIosGuide(true);
      return;
    }
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  return (
    <>
      <Button
        className="h-8 gap-1.5 rounded-lg text-[13px]"
        onClick={handleClick}
        size="sm"
        variant="outline"
      >
        <DownloadIcon className="size-3.5" />
        홈 화면에 추가
      </Button>

      <Dialog onOpenChange={setShowIosGuide} open={showIosGuide}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>홈 화면에 추가하기</DialogTitle>
          </DialogHeader>
          <ol className="flex flex-col gap-2 text-sm">
            <li>1. 하단(또는 상단)의 공유 버튼 <span aria-hidden>⬆️</span>을 누르세요.</li>
            <li>2. 아래로 스크롤해 <b>"홈 화면에 추가"</b>를 선택하세요.</li>
            <li>3. 오른쪽 위 <b>"추가"</b>를 누르면 완료됩니다.</li>
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}
