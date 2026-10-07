import { requireSession } from "@/lib/server/auth";
import { addTocUnitLinks, deleteTocUnitLink, listTocUnitLinks, listUnitTocLinks } from "@/lib/graphDb";

// 교재 TOC 항목 → 대단원(또는 등록된 TOC 노드) 아래 TOC 노드 등록 (kg.toc_unit_links + TOC level 노드)

// ?stem= 그 도서의 등록 목록 / ?units=a,b 그 대단원들 안에 등록된 TOC 노드 (모든 도서)
export async function GET(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const params = new URL(request.url).searchParams;
  const units = params.get("units");
  if (units != null) return Response.json({ links: units ? await listUnitTocLinks(units.split(",")) : [] });
  const stem = params.get("stem");
  if (!stem) return Response.json({ error: "stem 또는 units 가 필요합니다" }, { status: 400 });
  return Response.json({ links: await listTocUnitLinks(stem) });
}

// { stem, title, documentId, toc: { key, level, label, page }, parentIds, pageKind, page }
//   parentIds: 대단원 또는 등록된 TOC 노드 / page: 등록 때 왼쪽 미리보기 페이지
export async function POST(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const b = await request.json();
  if (!b.stem || !b.title || !b.toc?.key || !b.toc?.label || !Array.isArray(b.parentIds) || b.parentIds.length === 0) {
    return Response.json({ error: "stem, title, toc, parentIds 가 필요합니다" }, { status: 400 });
  }
  try {
    const count = await addTocUnitLinks({
      stem: b.stem,
      title: b.title,
      documentId: b.documentId ?? null,
      toc: { key: b.toc.key, level: b.toc.level, label: b.toc.label, page: b.toc.page ?? null },
      parentIds: b.parentIds,
      pageKind: b.pageKind ?? null,
      page: b.page ?? null,
      user: s.user.id,
    });
    return Response.json({ count });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

// ?id= 등록 하나 해제 (만든 TOC 노드와 그 아래 등록된 TOC 노드도 지운다)
export async function DELETE(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return Response.json({ error: "id 가 필요합니다" }, { status: 400 });
  return Response.json({ deleted: await deleteTocUnitLink(id) });
}
