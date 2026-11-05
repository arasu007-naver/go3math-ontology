import { z } from "zod";
import { mergeConcepts } from "@/lib/server/l2oDedupe";
import { editRoute } from "../edit";

const Body = z.object({ legacyIds: z.array(z.number().int().positive()).min(2), representativeId: z.number().int().positive() });

// POST /api/l2o/dedupe/merge {legacyIds, representativeId}
export async function POST(request: Request) {
  return editRoute(request, Body, (b, actor) => mergeConcepts(b.legacyIds, b.representativeId, actor));
}
