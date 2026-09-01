import NextAuth, { type DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/lib/auth/password";
import { getUserByEmail, getUserByStudentId } from "@/lib/db/queries";
import { authConfig } from "./auth.config";

// 게스트 없음: 이 서비스는 로그인 없이는 사용할 수 없다(회원가입도 없음 — 계정은 관리자가 발급).
export type UserType = "regular";
export type UserRole = "admin" | "student";
export type UserLevel = "beginner" | "intermediate" | "advanced";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      type: UserType;
      role: UserRole;
      level: UserLevel;
    } & DefaultSession["user"];
  }

  interface User {
    email?: string | null;
    id?: string;
    type: UserType;
    role: UserRole;
    level: UserLevel;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    type: UserType;
    role: UserRole;
    level: UserLevel;
  }
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.type = user.type;
        token.role = user.role;
        token.level = user.level;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.type = token.type;
        session.user.role = token.role;
        session.user.level = token.level;
      }

      return session;
    },
  },
  providers: [
    Credentials({
      // 학생은 학번, 관리자는 학교 이메일로 로그인한다(요청 반영) — 로그인 폼은 접속 도메인
      // (classnet.chat / admin.classnet.chat)에 따라 둘 중 하나만 보여주지만, 혹시 다른 경로로
      // 잘못된 자격 종류가 넘어와도 여기서 역할까지 다시 검증해 어긋나면 거부한다.
      async authorize(credentials) {
        const studentId = String(credentials.studentId ?? "").trim();
        const email = String(credentials.email ?? "").trim().toLowerCase();
        const password = String(credentials.password ?? "");

        let user: Awaited<ReturnType<typeof getUserByEmail>> = null;
        let expectedRole: "admin" | "student" | null = null;

        if (studentId) {
          user = await getUserByStudentId(studentId);
          expectedRole = "student";
        } else if (email) {
          user = await getUserByEmail(email);
          expectedRole = "admin";
        }

        if (!user || user.role !== expectedRole) {
          // 계정이 없거나(또는 역할이 안 맞아도) 동일한 시간이 걸리도록 더미 해시와 대조(타이밍 공격 방지)
          await verifyPassword(password, DUMMY_PASSWORD_HASH);
          return null;
        }

        const passwordsMatch = await verifyPassword(password, user.passwordHash);
        if (!passwordsMatch) {
          return null;
        }

        return {
          email: user.email,
          id: String(user.id),
          level: user.level,
          name: user.name,
          role: user.role,
          type: "regular",
        };
      },
      credentials: {
        studentId: { label: "Student ID", type: "text" },
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
    }),
  ],
});
