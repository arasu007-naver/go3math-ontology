import { JobError } from "@/lib/server/l2oJobs";

// 작업 라우트 공통 오류 응답
export function jobErrorResponse(e: unknown) {
  if (e instanceof JobError) return Response.json({ error: e.message, jobId: e.jobId }, { status: e.status });
  return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
}
