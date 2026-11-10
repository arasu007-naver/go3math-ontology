import { requireSession } from "@/lib/server/auth";
import { listOrderUnits, orderUnit } from "@/lib/server/conceptOrder";

// 개념 정렬: GET = 대상 단원 목록(개념 2개 이상), POST {unitId} = 단원 1개의 개념 선후관계 추출·저장
export async function GET() {
  const s = await requireSession();
  if (s instanceof Response) return s;
  return Response.json({ units: await listOrderUnits() });
}

export async function POST(req: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const { unitId } = (await req.json()) as { unitId?: string };
  if (!unitId) return Response.json({ error: "unitId 가 없습니다." }, { status: 400 });
  try {
    const result = await orderUnit(unitId);
    console.info(`[concept-order] ${unitId} ${JSON.stringify(result)}`);
    return Response.json(result);
  } catch (e) {
    console.warn(`[concept-order] ${unitId} 실패: ${(e as Error).message}`);
    return Response.json({ error: (e as Error).message.slice(0, 300) }, { status: 502 });
  }
}
