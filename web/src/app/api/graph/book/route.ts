import { requireSession } from "@/lib/server/auth";
import { getBookSummary, saveBook } from "@/lib/graphDb";
import type { BookInput } from "@/lib/types";

export async function GET(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const stem = new URL(request.url).searchParams.get("stem");
  if (!stem) return Response.json({ error: "stem 파라미터가 필요합니다" }, { status: 400 });
  return Response.json({ book: await getBookSummary(stem) });
}

export async function POST(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const body = (await request.json()) as BookInput;
  if (!body?.stem || !body?.title) return Response.json({ error: "stem, title이 필요합니다" }, { status: 400 });
  if (!Array.isArray(body.toc) || body.toc.length === 0) {
    return Response.json({ error: "TOC 항목이 없습니다. TOC 중심 그래프라 TOC 없는 도서는 넣지 않습니다." }, { status: 400 });
  }
  try {
    return Response.json(await saveBook(body));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
