import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { candidatesFor, OverrideError } from "@/lib/server/l2oOverride";

const Query = z.object({ groupId: z.coerce.number().int().positive() });

// GET /api/l2o/units/candidates?groupId= → 결정 창용 후보(최근 투표의 후보) + 전체 단원(창에서 검색)
export async function GET(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const q = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!q.success) return Response.json({ error: "groupId 가 필요합니다." }, { status: 400 });
  try {
    return Response.json(await candidatesFor(q.data.groupId));
  } catch (e) {
    if (e instanceof OverrideError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
