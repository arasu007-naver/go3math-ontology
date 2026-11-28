import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { savePilotLabel } from "@/lib/server/e2cOverride";
import { pgOverrideStore } from "@/lib/server/e2cService";
import { errorResponse } from "../respond";

const Body = z.object({ problemId: z.number().int().positive(), unitId: z.string(), primaryConceptId: z.string(), secondaryConceptIds: z.array(z.string()) });

// PUT /api/e2c/pilot-label
export async function PUT(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  try {
    await savePilotLabel(pgOverrideStore, body.data, s.user.email || s.user.name);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
