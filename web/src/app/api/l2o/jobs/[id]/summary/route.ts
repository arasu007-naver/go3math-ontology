import { requireSession } from "@/lib/server/auth";
import { jobSummary } from "@/lib/server/l2oJobs";

const UUID = /^[0-9a-f-]{36}$/i;

// GET /api/l2o/jobs/:id/summary → 테스트 요약(자동일치·검토 수, 선택기별 오류·평균 지연·일치율)
export async function GET(_req: Request, ctx: RouteContext<"/api/l2o/jobs/[id]/summary">) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "잘못된 작업 id 입니다." }, { status: 400 });
  const r = await jobSummary(id);
  return r ? Response.json(r) : Response.json({ error: "없는 작업입니다." }, { status: 404 });
}
