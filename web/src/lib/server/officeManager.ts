// Office-Manager(NextAuth) 로그인. unlimited-ocr app.py authenticate_with_office_manager 와 같은 흐름.
// 비밀번호와 토큰은 로그에 남기지 않는다.
const OFFICE_MANAGER_URL = (process.env.OFFICE_MANAGER_URL || "https://coo.qoolla.com").replace(/\/$/, "");

export type OfficeManagerLogin =
  | { ok: true; user: { id: string; name: string; email: string }; token: string }
  | { ok: false; error: string; status: number };

class CookieJar {
  private jar = new Map<string, string>();
  take(res: Response) {
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(";");
      const i = pair.indexOf("=");
      if (i > 0) this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

export async function loginOfficeManager(email: string, password: string): Promise<OfficeManagerLogin> {
  const jar = new CookieJar();
  const base = { "User-Agent": "go3math-ontology/1.0", "X-Forwarded-Proto": "https" };
  try {
    // 1. CSRF
    const csrfRes = await fetch(`${OFFICE_MANAGER_URL}/api/auth/csrf`, { headers: base, redirect: "manual", cache: "no-store" });
    if (!csrfRes.ok) return { ok: false, status: 502, error: `Office-Manager 응답 실패 (${csrfRes.status})` };
    jar.take(csrfRes);
    const { csrfToken } = (await csrfRes.json()) as { csrfToken?: string };
    if (!csrfToken) return { ok: false, status: 502, error: "CSRF 토큰 발급에 실패했습니다." };

    // 2. credentials callback
    const cbRes = await fetch(`${OFFICE_MANAGER_URL}/api/auth/callback/credentials`, {
      method: "POST",
      redirect: "manual",
      cache: "no-store",
      headers: { ...base, "Content-Type": "application/x-www-form-urlencoded", Cookie: jar.header() },
      body: new URLSearchParams({ csrfToken, email, username: email, password, redirect: "false", json: "true" }),
    });
    jar.take(cbRes);
    const location = cbRes.headers.get("location") || "";
    let bodyUrl = "";
    try {
      const j = (await cbRes.json()) as { url?: string; error?: string };
      if (j.error) bodyUrl = "error=" + j.error;
      else bodyUrl = j.url || "";
    } catch {}
    const failed = `${location} ${bodyUrl}`;
    if (failed.includes("MissingCSRF")) return { ok: false, status: 401, error: "Office-Manager CSRF 검증에 실패했습니다 (MissingCSRF)." };
    if (failed.includes("error=") || ![200, 302].includes(cbRes.status)) {
      return { ok: false, status: 401, error: "아이디 또는 비밀번호가 올바르지 않습니다." };
    }

    // 3. session — 사용자 정보 + token. 이 token 을 모든 서비스가 공유하며, apiv3 호출 때 Authorization: Bearer 로 붙인다
    const sRes = await fetch(`${OFFICE_MANAGER_URL}/api/auth/session`, {
      headers: { ...base, Cookie: jar.header() },
      redirect: "manual",
      cache: "no-store",
    });
    if (!sRes.ok) return { ok: false, status: 502, error: `Office-Manager 세션 조회 실패 (${sRes.status})` };
    const s = (await sRes.json()) as { user?: { id?: string; sub?: string; name?: string; email?: string }; token?: string };
    if (!s?.user) return { ok: false, status: 401, error: "아이디 또는 비밀번호가 올바르지 않습니다." };
    if (!s.token) return { ok: false, status: 502, error: "Office-Manager 세션에 토큰(token)이 없습니다." };
    return {
      ok: true,
      token: s.token,
      user: { id: String(s.user.id ?? s.user.sub ?? email), name: s.user.name || email, email: s.user.email || email },
    };
  } catch {
    return { ok: false, status: 502, error: `Office-Manager(${OFFICE_MANAGER_URL}) 서버에 연결할 수 없습니다.` };
  }
}
