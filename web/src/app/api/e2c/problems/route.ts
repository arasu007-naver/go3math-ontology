import { requireSession } from "@/lib/server/auth";
import { listProblems } from "@/lib/server/e2cQueries";
import { errorResponse } from "../respond";

// GET /api/e2c/problems?status=&reason=&source=&subject=&year=&page=&pageSize= → { total, items: ProblemRowVM[] }
export async function GET(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const q = new URL(request.url).searchParams;
  const int = (k: string, d: number) => Math.max(1, Number.parseInt(q.get(k) ?? "", 10) || d);
  try {
    return Response.json(
      await listProblems({
        status: q.get("status") || undefined,
        reason: q.get("reason") || undefined,
        source: q.get("source") || undefined,
        subject: q.get("subject") || undefined,
        year: Number.parseInt(q.get("year") ?? "", 10) || undefined,
        page: int("page", 1),
        pageSize: Math.min(int("pageSize", 20), 100),
      })
    );
  } catch (e) {
    return errorResponse(e);
  }
}
