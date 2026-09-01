"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useActionState, useEffect, useState } from "react";

import { AuthForm } from "@/components/chat/auth-form";
import { SubmitButton } from "@/components/chat/submit-button";
import { toast } from "@/components/chat/toast";
import { type LoginActionState, login } from "../actions";

export default function Page() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [isSuccessful, setIsSuccessful] = useState(false);
  // 접속 도메인으로 학생용/관리자용을 구분한다 — admin.classnet.chat은 이메일 로그인,
  // 그 외(classnet.chat)는 학번 로그인. 서버 인증(auth.ts)에서도 역할을 다시 검증하므로
  // 여기서는 어떤 입력창을 보여줄지만 결정한다.
  const [mode, setMode] = useState<"student" | "admin">("student");

  useEffect(() => {
    if (window.location.hostname.startsWith("admin.")) {
      setMode("admin");
    }
  }, []);

  const [state, formAction] = useActionState<LoginActionState, FormData>(
    login,
    { status: "idle" }
  );

  const { update: updateSession } = useSession();

  // biome-ignore lint/correctness/useExhaustiveDependencies: router and updateSession are stable refs
  useEffect(() => {
    // state.status만 의존성으로 두면 연속으로 같은 결과(예: 두 번 다 "failed")가 나올 때 문자열이
    // 안 바뀌었다고 판단해 이펙트가 다시 안 돌아서 두 번째부터는 토스트가 안 뜨는 버그가 있었다
    // (실측 확인됨). useActionState가 매 제출마다 새 객체를 반환하는 걸 이용해 state 전체를 봐야 한다.
    if (state.status === "failed") {
      toast({
        description: mode === "admin" ? "이메일 또는 비밀번호가 올바르지 않습니다." : "학번 또는 비밀번호가 올바르지 않습니다.",
        type: "error",
      });
    } else if (state.status === "invalid_data") {
      toast({
        description: "입력값을 확인해주세요.",
        type: "error",
      });
    } else if (state.status === "success") {
      setIsSuccessful(true);
      updateSession();
      router.refresh();
    }
  }, [state]);

  const handleSubmit = (formData: FormData) => {
    setIdentifier((formData.get(mode === "admin" ? "email" : "studentId") as string) ?? "");
    formAction(formData);
  };

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">classnet</h1>
      <p className="text-sm text-muted-foreground">
        네트워크관리사 2급 필기시험 대비 AI 튜터 ·{" "}
        {mode === "admin" ? "관리자 이메일과 비밀번호로 로그인하세요" : "학번과 비밀번호로 로그인하세요"}
      </p>
      <AuthForm action={handleSubmit} defaultValue={identifier} mode={mode}>
        <SubmitButton isSuccessful={isSuccessful}>로그인</SubmitButton>
        <p className="text-center text-[13px] text-muted-foreground">
          계정이 없으신가요? 회원가입은 지원하지 않으며, 학교 관리자가 발급한
          계정으로만 로그인할 수 있습니다.
        </p>
      </AuthForm>
    </>
  );
}
