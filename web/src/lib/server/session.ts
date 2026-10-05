import crypto from "node:crypto";

// 로그인 세션: AES-256-GCM 으로 암호화한 HttpOnly 쿠키. 공유 토큰은 여기에만 있고 브라우저 JS 로 나가지 않는다.
export const SESSION_COOKIE = "g3o_session";

export type SessionUser = { id: string; name: string; email: string };
export type Session = {
  user: SessionUser;
  token: string; // 로그인 때 받은 토큰(Office-Manager session.token). 모든 서비스가 공유하며 apiv3·unlimited-ocr 에 Bearer 로 붙인다
  exp: number; // epoch 초. token 의 exp 를 따른다
};

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET(32자 이상)이 설정되지 않았습니다.");
  return crypto.createHash("sha256").update(secret).digest();
}

export function sealSession(s: Session): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(s), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

// 위조·손상·만료면 null
export function openSession(value: string | undefined): Session | null {
  if (!value) return null;
  try {
    const raw = Buffer.from(value, "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const s = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as Session;
    // 예전 형태의 세션(토큰 필드가 없거나 이름이 다름)은 무효로 보고 다시 로그인하게 한다
    if (typeof s.token !== "string" || !s.token || !s.user || typeof s.exp !== "number") return null;
    return s.exp * 1000 > Date.now() ? s : null;
  } catch {
    return null;
  }
}

// JWT 의 exp (서명 검증은 apiv3 가 한다. 여기서는 만료 시각만 읽는다)
export function jwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(exp: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(exp * 1000),
  };
}
