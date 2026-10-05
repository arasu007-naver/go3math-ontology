import { cookies } from "next/headers";
import { openSession, SESSION_COOKIE, type Session } from "./session";

export async function getSession(): Promise<Session | null> {
  return openSession((await cookies()).get(SESSION_COOKIE)?.value);
}

// 라우트 핸들러용: 세션이 없으면 401 응답을 돌려준다 (proxy.ts 와 별도로 한 번 더 확인)
export async function requireSession(): Promise<Session | Response> {
  const s = await getSession();
  return s ?? Response.json({ error: "로그인이 필요합니다.", reauth: true }, { status: 401 });
}
