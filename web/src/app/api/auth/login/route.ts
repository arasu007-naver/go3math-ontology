import { NextResponse } from "next/server";
import { loginOfficeManager } from "@/lib/server/officeManager";
import { jwtExp, sealSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/session";

export async function POST(request: Request) {
  const { email, password } = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!email?.trim() || !password) return Response.json({ error: "아이디와 비밀번호를 입력하세요." }, { status: 400 });

  const om = await loginOfficeManager(email.trim(), password);
  if (!om.ok) return Response.json({ error: om.error }, { status: om.status });

  // 로그인 때 받은 토큰을 모든 서비스가 공유한다. apiv3·unlimited-ocr 호출 때 Authorization: Bearer 로 붙이고, 각 서비스에 따로 로그인하지 않는다.
  const exp = jwtExp(om.token) ?? Math.floor(Date.now() / 1000) + 24 * 3600;
  const res = NextResponse.json({ ok: true, user: om.user });
  res.cookies.set(SESSION_COOKIE, sealSession({ user: om.user, token: om.token, exp }), sessionCookieOptions(exp));
  return res;
}
