import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { searchGraphNodes } from "@/lib/server/kgGraphQueries";

const Query = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
});

// GET /api/graph/search?q=... — 단원, 수학 개념, 도서/목차, 용어 사전 통합 검색
export async function GET(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;

  const parsed = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json({ items: [] });
  }

  try {
    const items = await searchGraphNodes(parsed.data.q, parsed.data.limit);
    return Response.json({ items });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

