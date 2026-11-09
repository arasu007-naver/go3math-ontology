import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { getGraphOverview } from "@/lib/server/kgGraphQueries";

const Query = z.object({
  includeConcepts: z.enum(["0", "1"]).optional().default("0"),
  includeBooks: z.enum(["0", "1"]).optional().default("0"),
  areaId: z.string().optional(),
});

// GET /api/graph/overview — KG 전체 골격 + 통계 + 레이어별 노드/엣지
export async function GET(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;

  const parsed = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json({ error: "잘못된 요청 파라미터입니다." }, { status: 400 });
  }

  try {
    const data = await getGraphOverview({
      includeConcepts: parsed.data.includeConcepts === "1",
      includeBooks: parsed.data.includeBooks === "1",
      areaId: parsed.data.areaId,
    });
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

