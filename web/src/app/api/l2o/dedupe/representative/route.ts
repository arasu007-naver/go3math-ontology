import { z } from "zod";
import { setRepresentative } from "@/lib/server/l2oDedupe";
import { editRoute } from "../edit";

const Body = z.object({ groupId: z.number().int().positive(), legacyId: z.number().int().positive() });

// POST /api/l2o/dedupe/representative {groupId, legacyId}
export async function POST(request: Request) {
  return editRoute(request, Body, (b, actor) => setRepresentative(b.groupId, b.legacyId, actor));
}
