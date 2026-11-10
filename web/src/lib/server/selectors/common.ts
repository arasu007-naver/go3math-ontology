import type { Candidate, SelectorName } from "@/lib/l2o/units";

// 5.3 선택기 어댑터 공통 타입
export interface SelectorInput {
  groupId: number;
  concept: { legacyId: number; title: string; statement: string; schoolType: string | null; mathField: string | null };
  candidates: Candidate[];
  promptVersion: string;
}
export interface SelectorOutput {
  selectedUnitId: string | null;
  confidence: number | null;
  scores?: Record<string, number>;
  raw: unknown;
  model: string;
  modelVersion?: string;
  latencyMs: number;
  error?: string;
}
export interface UnitSelector {
  name: SelectorName;
  model: string;
  select(i: SelectorInput, signal?: AbortSignal): Promise<SelectorOutput>;
}

export const PROMPT_VERSION = "unit-select-v1";
export const TIMEOUT_MS = 30000;

const SCHOOL: Record<string, string> = { ELEMENTARY: "초등", MIDDLESCHOOL: "중등", HIGHSCHOOL: "고등" };

// 5.4 프롬프트 (Claude/Gemini 공통). structured output 의 enum 에 null 을 쓸 수 없어 판단 불가는 "NONE".
export const SYSTEM_PROMPT = `당신은 한국 2022 개정 수학 교육과정 분류기입니다. 주어진 수학 개념이 속하는 단원을
후보 목록에서 정확히 하나 고르세요. 후보에 없는 id를 만들지 마세요.
반드시 아래 JSON만 출력하세요(설명 문장, 코드블록 금지):
{"unit_id":"<후보 id>","confidence":<0~1>,"reason":"<40자 이내>"}
판단이 불가능하면 {"unit_id":"NONE","confidence":0,"reason":"..."}`;

export function userPrompt(i: SelectorInput): string {
  const c = i.concept;
  const school = c.schoolType ? (SCHOOL[c.schoolType] ?? c.schoolType) : "미상";
  const field = c.schoolType && c.mathField ? c.mathField : "미상"; // school_type 없는 행의 math_field 는 기본값이라 미상으로 준다
  const lines = i.candidates.map((u) => `- ${u.unitId}: ${u.path}${u.description ? ` — ${u.description}` : ""}`);
  return `[개념]
학교급: ${school} / 영역: ${field}
제목: ${c.title}
내용: ${c.statement}   (수식은 backtick AsciiMath)

[후보 단원]
${lines.join("\n")}`;
}

export class HttpError extends Error {
  constructor(public status: number, public retryAfter: number | null, message: string) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 5.6: 429/5xx/timeout → 1s, 2s, 4s (+jitter) 최대 3회, Retry-After 존중
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const retryable =
        (e instanceof HttpError && (e.status === 429 || e.status >= 500)) ||
        (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"));
      if (!retryable || attempt >= 3) throw e;
      const wait = e instanceof HttpError && e.retryAfter != null ? e.retryAfter * 1000 : 1000 * 2 ** attempt + Math.random() * 300;
      await sleep(wait);
    }
  }
}

export async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs = TIMEOUT_MS): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const ra = Number(res.headers.get("retry-after"));
    throw new HttpError(res.status, Number.isFinite(ra) && ra > 0 ? ra : null, `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
