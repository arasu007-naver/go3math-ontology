import { requireSession } from "@/lib/server/auth";

// BookToc 목록은 qoolla-server-v3(apiv3)에서 가져온다. 로그인 때 받은 토큰을 서버가 Authorization: Bearer 로 붙인다.
// 작성자는 로그인한 사용자 아이디(Office-Manager user.id)로 서버가 정한다.
const API_V3_URL = (process.env.API_V3_URL || "https://apiv3.qoolla.com").replace(/\/$/, "");

export async function GET(_req: Request, ctx: RouteContext<"/api/book-toc/[page]">) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const { page } = await ctx.params;
  const writer = s.user.id;
  try {
    const res = await fetch(`${API_V3_URL}/api/aux/book-toc/by-writer/${encodeURIComponent(writer)}/${encodeURIComponent(page)}`, {
      headers: { Authorization: `Bearer ${s.token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      // 다시 로그인해도 같은 토큰이므로 로그인 화면으로 보내지 않고 원인을 보여 준다 (토큰은 로그에 남기지 않는다)
      const body = (await res.text()).slice(0, 300);
      console.warn(`[book-toc] apiv3 ${res.status} ${API_V3_URL}: ${body}`);
      if (res.status === 401) console.warn(`[book-toc] 토큰 요약(서명 제외): ${describeToken(s.token)}`);
      const why = res.status === 401 || res.status === 403 ? "apiv3 가 로그인 토큰을 거부했습니다" : "apiv3 응답 오류";
      return Response.json({ error: `${why} (HTTP ${res.status})` }, { status: 502 });
    }
    const data = (await res.json()) as { totalElements?: number; content?: unknown[] };
    console.info(`[book-toc] writer=${writer} page=${page} → ${data.content?.length ?? 0}건 (전체 ${data.totalElements ?? "?"})`);
    return Response.json({ ...data, writer });
  } catch (e) {
    console.warn(`[book-toc] apiv3 연결 실패 ${API_V3_URL}: ${(e as Error).message}`);
    return Response.json({ error: `apiv3(${API_V3_URL}) 에 연결할 수 없습니다.` }, { status: 502 });
  }
}

// 401 원인 파악용: 헤더와 클레임 요약만 (서명·토큰 원문은 남기지 않는다)
function describeToken(token: string) {
  try {
    const [h, p] = token.split(".");
    const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    const t = (v: unknown) => (typeof v === "number" ? new Date(v * 1000).toISOString() : String(v));
    return `parts=${token.split(".").length} alg=${header.alg} sub=${claims.sub} id=${claims.id} iat=${t(claims.iat)} exp=${t(claims.exp)} now=${new Date().toISOString()} claims=[${Object.keys(claims).join(",")}]`;
  } catch {
    return `JWT 형식이 아님 (parts=${token.split(".").length}, length=${token.length})`;
  }
}

