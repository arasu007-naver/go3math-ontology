import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { OverrideError, overrideUnit } from "@/lib/server/l2oOverride";

const Body = z.object({
  groupId: z.number().int().positive(),
  unitId: z.string().min(1).max(64),
  reason: z.string().trim().max(500).optional(),
});

// POST /api/l2o/override {groupId, unitId, reason?} → 수동 단원 + 즉시 KG 반영 (사유는 선택)
export async function POST(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: body.error.issues[0]?.message ?? "잘못된 요청입니다.", issues: body.error.issues }, { status: 400 });
  try {
    return Response.json(await overrideUnit(body.data.groupId, body.data.unitId, body.data.reason || null, s.user.email || s.user.name));
  } catch (e) {
    if (e instanceof OverrideError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: `단원 결정 실패: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
}
