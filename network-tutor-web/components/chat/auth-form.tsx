"use client";

import { EyeIcon, EyeOffIcon } from "lucide-react";
import Form from "next/form";
import { useState } from "react";

import { Input } from "../ui/input";
import { Label } from "../ui/label";

export function AuthForm({
  action,
  children,
  mode = "student",
  defaultValue = "",
}: {
  action: NonNullable<
    string | ((formData: FormData) => void | Promise<void>) | undefined
  >;
  children: React.ReactNode;
  mode?: "student" | "admin";
  defaultValue?: string;
}) {
  const isAdmin = mode === "admin";
  const [showPassword, setShowPassword] = useState(false);
  return (
    <Form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label className="font-normal text-muted-foreground" htmlFor={isAdmin ? "email" : "studentId"}>
          {isAdmin ? "Email" : "학번"}
        </Label>
        {isAdmin ? (
          <Input
            autoComplete="email"
            autoFocus
            className="h-10 rounded-lg border-border/50 bg-muted/50 text-sm transition-colors focus:border-foreground/20 focus:bg-muted"
            defaultValue={defaultValue}
            id="email"
            name="email"
            placeholder="you@school.ac.kr"
            required
            type="email"
          />
        ) : (
          <Input
            autoComplete="username"
            autoFocus
            className="h-10 rounded-lg border-border/50 bg-muted/50 text-sm transition-colors focus:border-foreground/20 focus:bg-muted"
            defaultValue={defaultValue}
            id="studentId"
            name="studentId"
            placeholder="학번을 입력하세요"
            required
            type="text"
          />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label className="font-normal text-muted-foreground" htmlFor="password">
          Password
        </Label>
        <div className="relative">
          <Input
            className="h-10 rounded-lg border-border/50 bg-muted/50 pr-10 text-sm transition-colors focus:border-foreground/20 focus:bg-muted"
            id="password"
            name="password"
            placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"
            required
            type={showPassword ? "text" : "password"}
          />
          <button
            aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
            className="-translate-y-1/2 absolute top-1/2 right-3 text-muted-foreground hover:text-foreground"
            onClick={() => setShowPassword((v) => !v)}
            tabIndex={-1}
            type="button"
          >
            {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </button>
        </div>
      </div>

      {children}
    </Form>
  );
}
