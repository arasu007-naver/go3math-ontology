import { requireSession } from "@/lib/server/auth";
import { jobVM } from "@/lib/server/e2cService";
import { errorResponse } from "../../respond";

const UUID = /^[0-9a-f-]{36}$/i;

// GET /api/e2c/jobs/:id → JobVM
export async function GET(_req: Request, ctx: RouteContext<"/api/e2c/jobs/[id]">) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  try {
    const j = await jobVM(id);
    return j ? Response.json(j) : Response.json({ error: "없는 작업입니다." }, { status: 404 });
  } catch (e) {
    return errorResponse(e);
  }
}
