import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { confirmResult } from "@/lib/server/e2cOverride";
import { pgOverrideStore } from "@/lib/server/e2cService";
import { errorResponse } from "../respond";

// POST /api/e2c/confirm {problemId} → status confirmed
export async function POST(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const body = z.object({ problemId: z.number().int().positive() }).safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  try {
    return Response.json(await confirmResult(pgOverrideStore, body.data.problemId, s.user.email || s.user.name));
  } catch (e) {
    return errorResponse(e);
  }
}
