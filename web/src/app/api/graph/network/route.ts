import { requireSession } from "@/lib/server/auth";
import { deleteCurriculum, getNetwork, saveCurriculum, setPrereq } from "@/lib/graphDb";

export async function GET() {
  const s = await requireSession();
  if (s instanceof Response) return s;
  return Response.json(await getNetwork());
}

type Body =
  | { action: "saveCurriculum"; id?: string; name: string; level: string; categoryIds: string[] }
  | { action: "deleteCurriculum"; id: string }
  | { action: "prereq"; src: string; dst: string; on: boolean };

export async function POST(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const b = (await request.json()) as Body;
  try {
    switch (b.action) {
      case "saveCurriculum":
        if (!b.name?.trim() || !b.level) return Response.json({ error: "이름과 구분이 필요합니다" }, { status: 400 });
        return Response.json(await saveCurriculum({ id: b.id, name: b.name.trim(), level: b.level, categoryIds: b.categoryIds || [] }));
      case "deleteCurriculum":
        await deleteCurriculum(b.id);
        return Response.json({ ok: true });
      case "prereq":
        await setPrereq(b.src, b.dst, b.on);
        return Response.json({ ok: true });
      default:
        return Response.json({ error: "알 수 없는 action" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
