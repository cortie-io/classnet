"use server";

import { z } from "zod";

import { signIn } from "./auth";

// 학생은 학번, 관리자는 이메일로 로그인한다 — 폼에서 둘 중 실제로 채워진 쪽만 온다.
const authFormSchema = z
  .object({
    studentId: z.string().trim().optional(),
    email: z.email().optional(),
    password: z.string().min(6),
  })
  .refine((data) => Boolean(data.studentId) || Boolean(data.email), {
    message: "학번 또는 이메일이 필요합니다.",
  });

export type LoginActionState = {
  status: "idle" | "in_progress" | "success" | "failed" | "invalid_data";
};

export const login = async (
  _: LoginActionState,
  formData: FormData
): Promise<LoginActionState> => {
  try {
    const rawStudentId = formData.get("studentId");
    const rawEmail = formData.get("email");
    const validatedData = authFormSchema.parse({
      studentId: typeof rawStudentId === "string" && rawStudentId ? rawStudentId : undefined,
      email: typeof rawEmail === "string" && rawEmail ? rawEmail : undefined,
      password: formData.get("password"),
    });

    // studentId/email 중 안 쓰는 쪽을 값 undefined인 채로 넘기면(예: {studentId: undefined}) NextAuth
    // 내부 직렬화 과정에서 문자열 "undefined"로 변해버려("undefined" ?? "" 는 "undefined"라 truthy)
    // authorize()가 항상 학번 로그인으로 오인하는 버그가 있었다(실측 확인됨). 값이 있는 필드만 아예
    // 키 자체를 넣어서 이 문제를 피한다.
    const signInCredentials: Record<string, string> = { password: validatedData.password };
    if (validatedData.studentId) signInCredentials.studentId = validatedData.studentId;
    if (validatedData.email) signInCredentials.email = validatedData.email;

    await signIn("credentials", { ...signInCredentials, redirect: false });

    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data" };
    }

    return { status: "failed" };
  }
};
