import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { applyOverride } from "@/lib/server/e2cOverride";
import { pgOverrideStore } from "@/lib/server/e2cService";
import { errorResponse } from "../respond";

const Body = z.object({
  problemId: z.number().int().positive(),
  unitId: z.string().optional(),
  primaryConceptId: z.string().optional(),
  secondaryConceptIds: z.array(z.string()).optional(),
  reason: z.string(),
});

// POST /api/e2c/override → 갱신된 결과. 채택 단원 밖 개념이거나 보조가 3개를 넘으면 400
export async function POST(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  try {
    return Response.json(await applyOverride(pgOverrideStore, body.data, s.user.email || s.user.name));
  } catch (e) {
    return errorResponse(e);
  }
}
