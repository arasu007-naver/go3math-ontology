import { requireSession } from "@/lib/server/auth";
import { getJob } from "@/lib/server/l2oJobs";

const UUID = /^[0-9a-f-]{36}$/i;

// GET /api/l2o/jobs/:id → 진행률
export async function GET(_req: Request, ctx: RouteContext<"/api/l2o/jobs/[id]">) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "잘못된 작업 id 입니다." }, { status: 400 });
  const job = await getJob(id);
  return job ? Response.json(job) : Response.json({ error: "없는 작업입니다." }, { status: 404 });
}
