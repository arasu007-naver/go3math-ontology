import { requireSession } from "@/lib/server/auth";
import { listWorkLogByDate } from "@/lib/server/workLog";
import { isValidDate } from "@/lib/l2o/workLogUtil";

export async function GET(req: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const date = new URL(req.url).searchParams.get("date") || undefined;
  if (date !== undefined && !isValidDate(date)) return Response.json({ error: "date 형식이 올바르지 않습니다 (YYYY-MM-DD)." }, { status: 400 });
  try {
    return Response.json(await listWorkLogByDate(date));
  } catch (e) {
    console.error("[API /api/work-log]", e);
    return Response.json({ error: (e as Error).message || "작업 이력을 불러오지 못했습니다." }, { status: 500 });
  }
}
