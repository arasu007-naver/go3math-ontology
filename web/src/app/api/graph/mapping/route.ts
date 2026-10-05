import { requireSession } from "@/lib/server/auth";
import { getMappings, setMappings } from "@/lib/graphDb";

export async function GET(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const stem = new URL(request.url).searchParams.get("stem");
  if (!stem) return Response.json({ error: "stem 파라미터가 필요합니다" }, { status: 400 });
  return Response.json({ mappings: await getMappings(stem) });
}

export async function POST(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const b = (await request.json()) as { stem?: string; tocKey?: string; curriculumIds?: string[] };
  if (!b.stem || !b.tocKey || !Array.isArray(b.curriculumIds)) {
    return Response.json({ error: "stem, tocKey, curriculumIds가 필요합니다" }, { status: 400 });
  }
  try {
    await setMappings(b.stem, b.tocKey, b.curriculumIds);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
