import { requireSession } from "@/lib/server/auth";
import { getText } from "@/lib/server/s3";

// office-manager md-viewer 에서 작성한 라인 TOC (qoollastorage 의 <S3_MD_PREFIX>/<stem>.toc.json). 없으면 toc: null
const MD_PREFIX = process.env.S3_MD_PREFIX || "mathpix";

export async function GET(req: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const bookStem = new URL(req.url).searchParams.get("bookStem");
  if (!bookStem) return Response.json({ error: "bookStem 이 필요합니다." }, { status: 400 });
  const key = `${MD_PREFIX}/${bookStem}.toc.json`;
  try {
    const text = await getText(key);
    return Response.json({ toc: text ? JSON.parse(text) : null, key });
  } catch (e) {
    console.error("[API /api/dictionary/line-toc]", e);
    return Response.json({ error: (e as Error).message || "라인 TOC 조회 실패" }, { status: 500 });
  }
}
