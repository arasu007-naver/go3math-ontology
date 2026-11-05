import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { startJob } from "@/lib/server/l2oJobs";
import { jobErrorResponse } from "../jobs/respond";

const Body = z.union([
  z.object({ page: z.number().int().positive(), pageSize: z.number().int().min(1).max(100) }),
  z.object({ ids: z.array(z.number().int().positive()).min(1).max(1000) }),
  z.object({ all: z.literal(true) }),
]);

// POST /api/l2o/test {page,pageSize} | {ids} | {all:true} → dry-run 작업(KG 미기록). 진행은 GET /api/l2o/jobs/:id
export async function POST(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "잘못된 요청입니다.", issues: body.error.issues }, { status: 400 });
  try {
    return Response.json(await startJob("test", body.data, s.user.email || s.user.name), { status: 202 });
  } catch (e) {
    return jobErrorResponse(e);
  }
}
