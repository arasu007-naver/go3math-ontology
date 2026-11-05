import { requireSession } from "@/lib/server/auth";
import { controlJob } from "@/lib/server/l2oJobs";
import { jobErrorResponse } from "../../respond";

const ACTIONS = ["pause", "resume", "cancel"] as const;
const UUID = /^[0-9a-f-]{36}$/i;

// POST /api/l2o/jobs/:id/(pause|resume|cancel)
export async function POST(_req: Request, ctx: RouteContext<"/api/l2o/jobs/[id]/[action]">) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const { id, action } = await ctx.params;
  const a = ACTIONS.find((x) => x === action);
  if (!a || !UUID.test(id)) return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  try {
    return Response.json(await controlJob(id, a));
  } catch (e) {
    return jobErrorResponse(e);
  }
}
