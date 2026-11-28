import { requireSession } from "@/lib/server/auth";
import { pgKg } from "@/lib/server/e2cService";
import { errorResponse } from "../respond";

// GET /api/e2c/units → 고등 단원 목록(수동 수정의 단원 선택용)
export async function GET() {
  const s = await requireSession();
  if (s instanceof Response) return s;
  try {
    return Response.json((await pgKg.units()).map((u) => ({ unitId: u.unitId, text: u.text, order: u.order, subjectId: u.subjectId })));
  } catch (e) {
    return errorResponse(e);
  }
}
