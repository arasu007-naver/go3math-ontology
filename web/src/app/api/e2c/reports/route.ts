import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { createReport } from "@/lib/server/e2cQueries";
import { errorResponse } from "../respond";

// POST /api/e2c/reports {jobRunId} → {path} (reports/ 아래 파일 생성)
export async function POST(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const body = z.object({ jobRunId: z.string().regex(/^[0-9a-f-]{36}$/i) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  try {
    return Response.json({ path: await createReport(body.data.jobRunId) });
  } catch (e) {
    return errorResponse(e);
  }
}
