import { requireSession } from "@/lib/server/auth";

// unlimited-ocr 조회 API 프록시. 로그인 때 받은 공유 토큰을 서버에서 Bearer 로 붙인다(unlimited-ocr 는 SHARED_JWT_SECRET 으로 검증).
const OCR_BACKEND_URL = (process.env.OCR_BACKEND_URL || "http://localhost:8088").replace(/\/$/, "");
// 이 화면이 쓰는 조회 API 만 연다
const ALLOWED = new Set(["toc-list", "get-toc", "list-pages", "list-json-pages", "get-json"]);

export async function GET(request: Request, ctx: RouteContext<"/api/ocr/[...path]">) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const { path } = await ctx.params;
  if (path.length !== 1 || !ALLOWED.has(path[0])) return Response.json({ error: "허용되지 않은 경로" }, { status: 404 });

  const res = await fetch(`${OCR_BACKEND_URL}/api/${path[0]}${new URL(request.url).search}`, {
    headers: { Authorization: `Bearer ${s.token}` },
    cache: "no-store",
  });
  if (res.status === 401) {
    console.warn(`[ocr] unlimited-ocr 401 ${OCR_BACKEND_URL}/api/${path[0]} — SHARED_JWT_SECRET 설정·재시작 확인`);
    return Response.json({ error: "unlimited-ocr 가 로그인 토큰을 거부했습니다 (HTTP 401)" }, { status: 502 });
  }
  return new Response(res.body, { status: res.status, headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" } });
}
