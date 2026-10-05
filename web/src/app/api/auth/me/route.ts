import { requireSession } from "@/lib/server/auth";

export async function GET() {
  const s = await requireSession();
  if (s instanceof Response) return s;
  return Response.json({ user: s.user, exp: s.exp });
}
