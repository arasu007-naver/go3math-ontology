import { requireSession } from "@/lib/server/auth";
import { pgKg } from "@/lib/server/e2cService";
import { errorResponse } from "../respond";

// GET /api/e2c/concepts?unitId= → 그 단원의 개념(수동 수정의 개념 선택 목록: 채택 단원 개념만)
export async function GET(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const unitId = new URL(request.url).searchParams.get("unitId");
  if (!unitId) return Response.json({ error: "unitId 가 필요합니다." }, { status: 400 });
  try {
    return Response.json(await pgKg.conceptsOfUnit(unitId));
  } catch (e) {
    return errorResponse(e);
  }
}
