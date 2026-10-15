import { SHOW_OFFICIAL_EXAMS } from "@/lib/student-features";
import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

// 게스트 없음, 회원가입 없음: 로그인 안 된 사용자는 무조건 /login으로 보낸다.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Hide new student entry points without interrupting existing attempts/results.
  if (
    !SHOW_OFFICIAL_EXAMS &&
    ["/official-exams", "/api/official-exams"].includes(
      pathname.replace(/\/$/, "")
    )
  ) {
    return new NextResponse("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (pathname.startsWith("/ping")) {
    return new Response("pong", { status: 200 });
  }

  // 다른 사이트에서 보낸 상태 변경 요청(CSRF)을 막는다. classnet.chat과 admin.classnet.chat은 브라우저가 "같은
  // 사이트"로 봐서 SameSite=Lax 쿠키만으로는 막히지 않는다 — 브라우저가 붙이는 Sec-Fetch-Site로 같은 출처에서 온
  // 요청만 받는다(nginx의 Host 설정과 무관하게 동작한다). NextAuth 경로는 자체 CSRF 토큰으로 지킨다.
  if (
    pathname.startsWith("/api/") &&
    !["GET", "HEAD", "OPTIONS"].includes(request.method)
  ) {
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") {
      return NextResponse.json(
        { error: "허용되지 않은 요청입니다." },
        { status: 403 }
      );
    }
  }

  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  // public/ 아래 정적 자산(아이콘·매니페스트·문제 이미지 등)은 로그인 여부와 무관하게 항상 열려 있어야
  // 한다 — 브라우저/OS가 PWA 설치 판단이나 <img> 로딩을 할 때 세션 쿠키 없이 요청하는 경우가 흔해서,
  // 이게 막히면 파비콘·홈 화면 아이콘·문제 이미지가 로그인 여부에 따라 깨지는 문제가 생긴다(실측 확인됨).
  if (
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/admin") &&
    /\.(svg|png|jpe?g|gif|webp|ico|webmanifest|json)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  // getToken()의 secureCookie 자동판단은 request.nextUrl.protocol을 보는데, nginx가 TLS를 종료하고
  // 백엔드 Node 프로세스에는 평문 HTTP로 전달하는 이 배포 구조에서는 그게 항상 "http:"로 보여
  // __Secure- 접두어 쿠키를 못 찾는다(실측 확인됨: /api/auth/session은 되는데 미들웨어만 실패).
  // nginx가 명시적으로 보내주는 x-forwarded-proto를 직접 읽어 판단해야 한다.
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const secureCookie =
    forwardedProto === "https" || request.nextUrl.protocol === "https:";

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie,
  });

  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  if ((!token || token.servicePeriod !== "2") && pathname !== "/login") {
    const redirectUrl = encodeURIComponent(new URL(request.url).pathname);
    return NextResponse.redirect(
      new URL(`${base}/login?redirectUrl=${redirectUrl}`, request.url)
    );
  }

  // Login must stay reachable for revoked/deleted/stale JWTs. Server authentication
  // checks the active database; a merely decryptable cookie is not a valid session.

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/chat/:id",
    "/api/:path*",
    "/login",

    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
