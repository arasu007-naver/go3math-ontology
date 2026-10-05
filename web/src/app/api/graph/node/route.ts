import { requireSession } from "@/lib/server/auth";
import { getNodeView } from "@/lib/graphDb";

export async function GET(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id 파라미터가 필요합니다" }, { status: 400 });
  const node = await getNodeView(id);
  return node ? Response.json({ node }) : Response.json({ error: "그래프에 없는 노드입니다" }, { status: 404 });
}
