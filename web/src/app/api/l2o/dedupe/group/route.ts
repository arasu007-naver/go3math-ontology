import { requireSession } from "@/lib/server/auth";
import { getGroupDetail } from "@/lib/server/l2oDedupe";

// GET /api/l2o/dedupe/group?groupId= → 그룹 편집 창용 멤버 + 이력
export async function GET(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const groupId = Number(new URL(request.url).searchParams.get("groupId"));
  if (!Number.isInteger(groupId) || groupId < 1) return Response.json({ error: "groupId 가 필요합니다." }, { status: 400 });
  const g = await getGroupDetail(groupId);
  return g ? Response.json(g) : Response.json({ error: "없는 그룹입니다." }, { status: 404 });
}
