import { JobError } from "@/lib/server/e2cJobs";
import { OverrideError } from "@/lib/server/e2cOverride";

// e2c 라우트 공통 오류 응답
export function errorResponse(e: unknown) {
  if (e instanceof JobError) return Response.json({ error: e.message, jobId: e.jobId }, { status: e.status });
  if (e instanceof OverrideError) return Response.json({ error: e.message }, { status: e.status });
  return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
}
