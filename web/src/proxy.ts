import { NextResponse, type NextRequest } from "next/server";
import { openSession, SESSION_COOKIE } from "@/lib/server/session";

// 로그인하지 않았거나 세션(=apiv3 토큰)이 만료되면 화면은 /login 으로, API 는 401 로 보낸다.
export function proxy(request: NextRequest) {
  if (openSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const res = pathname.startsWith("/api/")
    ? NextResponse.json({ error: "로그인이 필요합니다.", reauth: true }, { status: 401 })
    : NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname + search)}`, request.url));
  if (request.cookies.has(SESSION_COOKIE)) res.cookies.delete(SESSION_COOKIE);
  return res;
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico|login|api/auth/login).*)"],
};
