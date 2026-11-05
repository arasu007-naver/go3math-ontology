import { z } from "zod";
import { confirmGroup } from "@/lib/server/l2oDedupe";
import { editRoute } from "../edit";

const Body = z.object({ groupId: z.number().int().positive() });

// POST /api/l2o/dedupe/confirm {groupId} → 묶음이 맞다고 확인(묶음 검토 필요 → 확정)
export async function POST(request: Request) {
  return editRoute(request, Body, (b, actor) => confirmGroup(b.groupId, actor));
}
