import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { startE2cJob } from "@/lib/server/e2cService";
import { errorResponse } from "../respond";

const Body = z.object({
  kind: z.enum(["pilot", "run_all", "run_ids", "rerun_review"]),
  mode: z.enum(["realtime", "batch"]).optional(),
  scope: z.union([z.object({ ids: z.array(z.number().int().positive()).min(1) }), z.object({ all: z.literal(true) }), z.object({ pilot: z.literal(true) })]),
  dryRun: z.boolean().default(true),
  shadowGrok: z.boolean().optional(),
  force: z.boolean().optional(),
});

// POST /api/e2c/jobs → JobVM. 이미 running 이면 409, 예상 비용이 상한을 넘는데 force 가 없으면 202 {budgetWarning, estimatedCostUsd}
export async function POST(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  try {
    const r = await startE2cJob(body.data, s.user.email || s.user.name);
    if ("budgetWarning" in r) return Response.json(r, { status: 202 });
    return Response.json(r.job, { status: 202 });
  } catch (e) {
    return errorResponse(e);
  }
}
