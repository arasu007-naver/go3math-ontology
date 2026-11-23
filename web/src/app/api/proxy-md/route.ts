import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/auth";
import { fetchRemoteText, RemoteTextError } from "@/lib/server/remoteText";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json({ error: "url 쿼리 파라미터가 필요합니다." }, { status: 400 });
  }

  try {
    const text = await fetchRemoteText(targetUrl);
    return new NextResponse(text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    if (err instanceof RemoteTextError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // 내부 연결 오류 내용은 브라우저에 돌려주지 않는다
    console.warn(`[proxy-md] 조회 실패: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "원격 파일을 가져오는 중 오류가 발생했습니다." }, { status: 502 });
  }
}
