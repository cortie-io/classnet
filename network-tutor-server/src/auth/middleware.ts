import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import { config } from "../config.js";
import { getSessionUser, getUserById, type SessionUser } from "./session.js";

export const SESSION_COOKIE = "ntutor_session";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionToken?: string;
    }
  }
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: "lax",
      domain: config.cookieDomain,
      expires: expiresAt,
      path: "/",
    }),
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, "", {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: "lax",
      domain: config.cookieDomain,
      expires: new Date(0),
      path: "/",
    }),
  );
}

function tokenFromRequest(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  const parsed = parseCookie(header);
  return parsed[SESSION_COOKIE] ?? null;
}

function isValidInternalSecret(header: string | undefined): boolean {
  if (!header || !config.internalApiSecret) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(config.internalApiSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * 모든 요청에 부착 — 로그인돼 있으면 req.user를 채우고, 아니면 그냥 통과(다음 미들웨어가 판단).
 * network-tutor-web(Next.js)이 x-internal-secret 헤더 + body.userId로 서버 간 호출을 하는 경우,
 * 그 요청은 브라우저 쿠키가 없으므로(각자 별도 인증 체계) 이 신뢰 경로로 사용자를 직접 식별한다.
 * 이 헤더 값은 두 백엔드 프로세스만 알고 있고 어떤 브라우저에도 절대 전달되지 않는다.
 */
export async function attachUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const internalSecret = req.headers["x-internal-secret"];
  if (isValidInternalSecret(typeof internalSecret === "string" ? internalSecret : undefined)) {
    // GET/HEAD 요청은 body를 못 보내므로 쿼리스트링(userId=)으로도 받는다.
    const userId = Number(req.body?.userId ?? req.query?.userId);
    if (Number.isFinite(userId)) {
      const user = await getUserById(userId);
      if (user) {
        req.user = user;
        return next();
      }
    }
    res.status(401).json({ error: "internal call: invalid userId" });
    return;
  }

  const token = tokenFromRequest(req);
  if (!token) return next();
  const user = await getSessionUser(token);
  if (user) {
    req.user = user;
    req.sessionToken = token;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "로그인이 필요합니다." });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "로그인이 필요합니다." });
    return;
  }
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "관리자만 접근할 수 있습니다." });
    return;
  }
  next();
}
