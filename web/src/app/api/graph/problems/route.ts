import { requireSession } from "@/lib/server/auth";
import { listProblems } from "@/lib/graphDb";

export async function GET(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const stem = new URL(request.url).searchParams.get("stem");
  if (!stem) return Response.json({ error: "stem 파라미터가 필요합니다" }, { status: 400 });
  return Response.json({ problems: await listProblems(stem) });
}
