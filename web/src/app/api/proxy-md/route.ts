import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/auth";

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
    const parsed = new URL(targetUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return NextResponse.json({ error: "유효하지 않은 URL 프로토콜입니다." }, { status: 400 });
    }

    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Go3Math-MDViewer/1.0",
        Accept: "text/markdown, text/plain, application/json, text/html, */*",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `원격 파일 로드 실패 (HTTP ${response.status} ${response.statusText})` },
        { status: response.status }
      );
    }

    const text = await response.text();
    return new NextResponse(text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "원격 파일을 가져오는 중 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
