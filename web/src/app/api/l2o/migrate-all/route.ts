import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { migratePreview, startJob } from "@/lib/server/l2oJobs";
import { jobErrorResponse } from "../jobs/respond";

// GET  /api/l2o/migrate-all → 확인 창용 미리보기 {groups, targets, skipped, expectedCalls}
// POST /api/l2o/migrate-all {confirm:true} → 전체 이전 작업(3/3 자동일치만 KG 기록, 수동·이전됨은 건너뜀)
export async function GET() {
  const s = await requireSession();
  if (s instanceof Response) return s;
  return Response.json(await migratePreview());
}

const Body = z.object({ confirm: z.literal(true) });

export async function POST(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "확인(confirm:true)이 필요합니다." }, { status: 400 });
  try {
    return Response.json(await startJob("migrate_all", { all: true }, s.user.email || s.user.name), { status: 202 });
  } catch (e) {
    return jobErrorResponse(e);
  }
}
