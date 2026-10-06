import { requireSession } from "@/lib/server/auth";
import { getLevelNetwork, setLevelPrereq } from "@/lib/graphDb";

// Level 1~5 노드와 HAS_CHILD·PREREQUISITE_OF 간선 (level-spec.md)
export async function GET() {
  const s = await requireSession();
  if (s instanceof Response) return s;
  return Response.json(await getLevelNetwork());
}

// 선수 관계 on/off: { src, dst, on } — src 가 dst 의 선수
export async function POST(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const b = (await request.json()) as { src?: string; dst?: string; on?: boolean };
  if (!b.src || !b.dst || typeof b.on !== "boolean") return Response.json({ error: "src, dst, on 이 필요합니다" }, { status: 400 });
  try {
    await setLevelPrereq(b.src, b.dst, b.on);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
