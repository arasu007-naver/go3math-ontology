import { requireSession } from "@/lib/server/auth";
import { getText, listKeys } from "@/lib/server/s3";

// 페이지 이미지 목록·추출 JSON 을 S3(MinIO)에서 직접 읽는다. 응답 형태는 unlimited-ocr 의 같은 이름 API 와 같다.
// (문서 목록·TOC 는 /api/docs 가 DB 에서 직접 읽는다)

const stemOf = (pdfName: string) => (pdfName.toLowerCase().endsWith(".pdf") ? pdfName.slice(0, -4) : pdfName);
const baseName = (key: string) => key.slice(key.lastIndexOf("/") + 1);

// origin/<stem>/<n>.png|pdf (해설서는 commentaries/)
async function listPages(params: URLSearchParams) {
  const stem = stemOf(params.get("pdf_name") || "");
  const prefix = params.get("kind") === "commentary" ? "commentaries" : "origin";
  const pages = [];
  for (const key of await listKeys(`${prefix}/${stem}/`)) {
    const m = baseName(key).match(/^(\d+)(\.(png|pdf))$/i);
    if (m) pages.push({ page: Number(m[1]), filename: baseName(key), key, ext: m[2] });
  }
  pages.sort((a, b) => a.page - b.page);
  return Response.json({ pdf_name: stem, prefix: `${prefix}/${stem}/`, pages });
}

async function jsonPages(prefix: string) {
  const pages = new Set<number>();
  for (const key of await listKeys(prefix)) {
    const m = baseName(key).match(/^(\d+)\.json$/);
    if (m) pages.add(Number(m[1]));
  }
  return [...pages].sort((a, b) => a - b);
}

// batch/main/<stem>/, main/<stem>/ (해설서는 batch/subs/, sub/)
async function listJsonPages(params: URLSearchParams) {
  const stem = stemOf(params.get("pdf_name") || "");
  const kind = params.get("kind") || "main";
  const [batchPfx, directPfx] = kind === "commentary" ? [`batch/subs/${stem}/`, `sub/${stem}/`] : [`batch/main/${stem}/`, `main/${stem}/`];
  const [batch_pages, main_pages] = await Promise.all([jsonPages(batchPfx), jsonPages(directPfx)]);
  return Response.json({ pdf_name: stem, kind, batch_pages, batch_count: batch_pages.length, main_pages, main_count: main_pages.length });
}

async function getJson(params: URLSearchParams) {
  const key = (params.get("key") || "").replaceAll("\\", "/").trim();
  if (!key.endsWith(".json")) return Response.json({ error: "Invalid key format" }, { status: 400 });
  const text = await getText(key);
  if (text === null) return Response.json({ error: `S3 Key ${key} not found` }, { status: 404 });
  return new Response(text, { headers: { "Content-Type": "application/json" } });
}

const HANDLERS: Record<string, (p: URLSearchParams) => Promise<Response>> = {
  "list-pages": listPages,
  "list-json-pages": listJsonPages,
  "get-json": getJson,
};

export async function GET(request: Request, ctx: RouteContext<"/api/ocr/[...path]">) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const { path } = await ctx.params;
  const handler = path.length === 1 ? HANDLERS[path[0]] : undefined;
  if (!handler) return Response.json({ error: "허용되지 않은 경로" }, { status: 404 });
  try {
    return await handler(new URL(request.url).searchParams);
  } catch (e) {
    console.warn(`[ocr] S3 조회 실패 ${path[0]}: ${(e as Error).message}`);
    return Response.json({ error: `S3 조회 실패: ${(e as Error).message}` }, { status: 502 });
  }
}
