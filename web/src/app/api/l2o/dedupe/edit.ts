import type { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { EditError } from "@/lib/server/l2oDedupe";

// merge / split / representative 라우트 공통: 세션 확인 + zod 검증 + EditError → 400
export async function editRoute<T extends z.ZodType>(request: Request, schema: T, fn: (body: z.infer<T>, actor: string) => Promise<unknown>) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "잘못된 요청입니다.", issues: body.error.issues }, { status: 400 });
  try {
    return Response.json(await fn(body.data, s.user.email || s.user.name));
  } catch (e) {
    if (e instanceof EditError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
