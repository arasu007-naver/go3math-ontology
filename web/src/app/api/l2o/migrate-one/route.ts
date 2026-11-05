import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { pool } from "@/lib/server/l2oPool";
import { selectForGroup } from "@/lib/server/l2oSelect";

const Body = z.object({ groupId: z.number().int().positive(), force: z.boolean().optional() });

// POST /api/l2o/migrate-one {groupId, force?} → 단건 재선택 + 이전(3/3 자동일치면 KG 기록, 아니면 검토 필요로 남김)
export async function POST(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "잘못된 요청입니다.", issues: body.error.issues }, { status: 400 });
  const job = await pool.query(
    `INSERT INTO l2o.job_run (kind, dry_run, scope, status, total, created_by, started_at) VALUES ('migrate_one', false, $1, 'running', 1, $2, now()) RETURNING id`,
    [JSON.stringify({ ids: [body.data.groupId] }), s.user.email || s.user.name]
  );
  const jobId: string = job.rows[0].id;
  try {
    const r = await selectForGroup(body.data.groupId, { jobId, dryRun: false, force: body.data.force });
    await pool.query(
      `UPDATE l2o.job_run SET status='done', processed=1, succeeded=$2, needs_review=$3, failed=$4, finished_at=now() WHERE id=$1`,
      [jobId, r.status === "migrated" ? 1 : 0, r.status === "needs_review" ? 1 : 0, r.votes.some((v) => v.error) ? 1 : 0]
    );
    return Response.json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await pool.query(`UPDATE l2o.job_run SET status='failed', error=$2, finished_at=now() WHERE id=$1`, [jobId, msg]);
    return Response.json({ error: msg }, { status: 500 });
  }
}
