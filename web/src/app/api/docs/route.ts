import { requireSession } from "@/lib/server/auth";
import { getOcrToc, listOcrDocs } from "@/lib/graphDb";

// unlimited-ocr 문서 목록·TOC 를 DB(public.documents)에서 직접 읽는다
// ?page=n&page_size=m 이면 목록, ?id= 이면 그 문서의 TOC
export async function GET(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  if (id) {
    const toc = /^\d+$/.test(id) ? await getOcrToc(Number(id)) : null;
    return toc ? Response.json(toc) : Response.json({ error: "TOC를 찾을 수 없습니다" }, { status: 404 });
  }
  const page = Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(params.get("page_size") || "24", 10) || 24));
  return Response.json(await listOcrDocs(page, pageSize));
}
