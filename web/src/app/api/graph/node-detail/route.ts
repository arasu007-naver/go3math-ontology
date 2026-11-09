import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { getGraphNodeDetail } from "@/lib/server/kgGraphQueries";

const Query = z.object({
  id: z.string().min(1),
});

// GET /api/graph/node-detail?id=... — 우측 인스펙터용 단일 노드 상세 정보
export async function GET(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;

  const parsed = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json({ error: "id 가 필요합니다." }, { status: 400 });
  }

  try {
    const detail = await getGraphNodeDetail(parsed.data.id);
    if (!detail) return Response.json({ error: "노드를 찾을 수 없습니다." }, { status: 404 });
    return Response.json(detail);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

