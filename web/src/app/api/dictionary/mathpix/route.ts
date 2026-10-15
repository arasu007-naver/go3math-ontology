import { requireSession } from "@/lib/server/auth";
import { latestLog, refreshStatus, saveMd, submitPdf } from "@/lib/server/mathpix";

const fail = (e: unknown) => {
  console.error("[API /api/dictionary/mathpix]", e);
  return Response.json({ error: (e as Error).message || "Mathpix 처리 실패" }, { status: 500 });
};

// 선택된 도서의 최근 전환 기록. 제출 상태면 Mathpix 에 처리 상태를 조회해 갱신한다
export async function GET(req: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const bookStem = new URL(req.url).searchParams.get("bookStem");
  if (!bookStem) return Response.json({ error: "bookStem 이 필요합니다." }, { status: 400 });
  try {
    const log = await latestLog(bookStem);
    return Response.json({ log: log && (await refreshStatus(log)) });
  } catch (e) {
    return fail(e);
  }
}

// PDF → Mathpix 제출
export async function POST(req: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const { bookStem, bookTitle } = (await req.json()) as { bookStem?: string; bookTitle?: string };
  if (!bookStem) return Response.json({ error: "bookStem 이 필요합니다." }, { status: 400 });
  try {
    return Response.json({ log: await submitPdf(bookStem, bookTitle ?? null) });
  } catch (e) {
    return fail(e);
  }
}

// MD 전환 완료된 기록의 MD 를 qoollastorage 의 S3_MD_PREFIX 아래에 저장
export async function PUT(req: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const { bookStem } = (await req.json()) as { bookStem?: string };
  if (!bookStem) return Response.json({ error: "bookStem 이 필요합니다." }, { status: 400 });
  try {
    const log = await latestLog(bookStem);
    if (!log) return Response.json({ error: "전환 기록이 없습니다." }, { status: 404 });
    return Response.json({ log: await saveMd(log) });
  } catch (e) {
    return fail(e);
  }
}
