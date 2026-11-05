import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { getConceptsPage } from "@/lib/server/l2oDb";

const Query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// GET /api/l2o/concepts?page=&pageSize= → legacy 한 쪽 + 그룹/투표/결과 (RowVM[])
export async function GET(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const q = Query.safeParse(params);
  if (!q.success) return Response.json({ error: "잘못된 요청입니다.", issues: q.error.issues }, { status: 400 });
  return Response.json(await getConceptsPage(q.data.page, q.data.pageSize));
}
