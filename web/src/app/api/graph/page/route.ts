import { requireSession } from "@/lib/server/auth";
import { getPage, savePage } from "@/lib/graphDb";
import { PARAGRAPH_KINDS, type PageInput } from "@/lib/types";

export async function GET(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const sp = new URL(request.url).searchParams;
  const stem = sp.get("stem");
  const kind = sp.get("kind") || "main";
  const page = parseInt(sp.get("page") || "", 10);
  if (!stem || isNaN(page)) return Response.json({ error: "stem, page 파라미터가 필요합니다" }, { status: 400 });
  return Response.json({ page: await getPage(stem, kind, page) });
}

export async function POST(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const body = (await request.json()) as PageInput;
  if (!body?.stem || !Number.isInteger(body.page) || !["main", "commentary"].includes(body.kind)) {
    return Response.json({ error: "stem, kind, page가 필요합니다" }, { status: 400 });
  }
  const paras = body.paragraphs || [];
  const bad = paras.findIndex((p) => !PARAGRAPH_KINDS.includes(p.kind) || !p.content?.trim() || !Number.isInteger(p.idx) || p.idx < 0);
  if (bad !== -1) return Response.json({ error: `문단 #${bad + 1}: 종류, 내용, idx를 확인하세요` }, { status: 400 });
  if (new Set(paras.map((p) => p.idx)).size !== paras.length) {
    return Response.json({ error: "문단 idx가 중복됩니다" }, { status: 400 });
  }
  try {
    return Response.json(await savePage(body));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
