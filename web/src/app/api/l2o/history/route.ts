import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { historyOf } from "@/lib/server/l2oOverride";

const Query = z.object({ groupId: z.coerce.number().int().positive() });

// GET /api/l2o/history?groupId= → 선택기 표 · 수동 결정 · KG 엣지 이력
export async function GET(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const q = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!q.success) return Response.json({ error: "groupId 가 필요합니다." }, { status: 400 });
  return Response.json(await historyOf(q.data.groupId));
}
