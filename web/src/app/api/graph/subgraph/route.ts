import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { getNodeSubgraph } from "@/lib/server/kgGraphQueries";

const Query = z.object({
  nodeId: z.string().min(1),
  types: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(300).optional().default(150),
});

// GET /api/graph/subgraph?nodeId=... — 특정 노드 기준 1-hop 동적 확장
export async function GET(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;

  const parsed = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json({ error: "nodeId 가 필요합니다." }, { status: 400 });
  }

  const types = parsed.data.types
    ? parsed.data.types
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : undefined;

  try {
    const data = await getNodeSubgraph({
      nodeId: parsed.data.nodeId,
      types,
      limit: parsed.data.limit,
    });
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

