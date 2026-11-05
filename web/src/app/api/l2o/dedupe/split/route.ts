import { z } from "zod";
import { splitConcept } from "@/lib/server/l2oDedupe";
import { editRoute } from "../edit";

const Body = z.object({ legacyId: z.number().int().positive() });

// POST /api/l2o/dedupe/split {legacyId}
export async function POST(request: Request) {
  return editRoute(request, Body, (b, actor) => splitConcept(b.legacyId, actor));
}
