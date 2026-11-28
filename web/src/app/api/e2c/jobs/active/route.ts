import { requireSession } from "@/lib/server/auth";
import { activeJobVM } from "@/lib/server/e2cService";
import { errorResponse } from "../../respond";

// GET /api/e2c/jobs/active → 실행 중이거나 일시정지된 최신 작업(없으면 null)
export async function GET() {
  const s = await requireSession();
  if (s instanceof Response) return s;
  try {
    return Response.json(await activeJobVM());
  } catch (e) {
    return errorResponse(e);
  }
}
