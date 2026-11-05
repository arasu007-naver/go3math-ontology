import { requireSession } from "@/lib/server/auth";
import { pool } from "@/lib/server/l2oPool";
import { runDedupe } from "@/lib/server/l2oDedupe";
import { getActiveJob } from "@/lib/server/l2oJobs";

// POST /api/l2o/dedupe → 중복제거 실행 (job_run kind='dedupe'). 동시에 하나만.
export async function POST() {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const running = await pool.query(`SELECT id FROM l2o.job_run WHERE kind='dedupe' AND status='running' AND started_at > now() - interval '30 minutes'`);
  if (running.rows[0]) return Response.json({ error: "중복제거가 이미 실행 중입니다.", jobId: running.rows[0].id }, { status: 409 });
  // 단원 선택 작업 중에 그룹을 다시 묶으면 작업 대상이 바뀌므로 막는다
  const active = (await getActiveJob())?.status === "running";
  if (active) return Response.json({ error: "단원 선택 작업이 실행 중입니다. 끝나거나 일시정지한 뒤 실행하세요." }, { status: 409 });
  try {
    return Response.json(await runDedupe(s.user.email || s.user.name));
  } catch (e) {
    return Response.json({ error: `중복제거 실패: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
}
