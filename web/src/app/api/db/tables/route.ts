import { requireSession } from "@/lib/server/auth";
import { getTableRows, listTables } from "@/lib/graphDb";

// ?name 없으면 테이블 목록, ?name=스키마.테이블&page=n 이면 그 테이블의 n 쪽(24행)
export async function GET(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const params = new URL(request.url).searchParams;
  const name = params.get("name");
  if (!name) return Response.json({ tables: await listTables() });
  const page = Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1);
  const data = await getTableRows(name, page);
  return data ? Response.json(data) : Response.json({ error: `없는 테이블입니다: ${name}` }, { status: 404 });
}
