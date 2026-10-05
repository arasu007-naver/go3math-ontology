// BookToc 목록은 qoolla-server-v3(apiv3)에서 직접 가져온다. v3는 Bearer 토큰이 필요하므로
// 서버에서 env 계정으로 로그인해 토큰을 캐시하고, 401이면 한 번 다시 로그인한다. 토큰은 브라우저로 나가지 않는다.
const API_V3_URL = (process.env.API_V3_URL || "https://apiv3.qoolla.com").replace(/\/$/, "");

let cachedToken: string | null = null;

async function login(): Promise<string> {
  const email = process.env.API_V3_EMAIL;
  const password = process.env.API_V3_PASSWORD;
  if (!email || !password) throw new Error("API_V3_EMAIL / API_V3_PASSWORD 가 설정되지 않았습니다.");
  const res = await fetch(`${API_V3_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`apiv3 로그인 실패 (HTTP ${res.status})`);
  const data = (await res.json()) as { accessToken?: string };
  if (!data.accessToken) throw new Error("apiv3 로그인 응답에 accessToken 이 없습니다.");
  cachedToken = data.accessToken;
  return cachedToken;
}

export async function GET(_req: Request, ctx: RouteContext<"/api/book-toc/by-writer/[writer]/[page]">) {
  const { writer, page } = await ctx.params;
  const url = `${API_V3_URL}/api/aux/book-toc/by-writer/${encodeURIComponent(writer)}/${encodeURIComponent(page)}`;
  try {
    let res = await fetch(url, { headers: { Authorization: `Bearer ${cachedToken ?? (await login())}` }, cache: "no-store" });
    if (res.status === 401 || res.status === 403) {
      res = await fetch(url, { headers: { Authorization: `Bearer ${await login()}` }, cache: "no-store" });
    }
    if (!res.ok) return Response.json({ error: `apiv3 HTTP ${res.status}` }, { status: 502 });
    return Response.json(await res.json());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
