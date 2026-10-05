// 이 앱의 API 호출. 세션이 없거나 만료(401)되면 로그인 페이지로 보낸다.
export async function api(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401 && typeof window !== "undefined") {
    const next = window.location.pathname + window.location.search;
    window.location.href = `/login?next=${encodeURIComponent(next)}`;
    // 이동하는 동안 호출자가 진행하지 않도록 끝나지 않는 promise
    return new Promise<Response>(() => {});
  }
  return res;
}
