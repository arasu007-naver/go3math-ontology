// 후보 단원 축소 · 판정 · 선택기 응답 파서 (specs/math_concepts2ontology.md 5.2, 5.3, 5.5). DB·API 의존 없음.

export type SelectorName = "jev" | "claude" | "gemini";

export type Unit = {
  unitId: string;
  path: string; // "중1 > 기하 > 작도와 합동"
  description?: string;
  school: "MIDDLESCHOOL" | "HIGHSCHOOL" | "STUDY"; // STUDY: 수학 학습 대단원(L3-STUDY-*), 수학 외 항목용
  areas: string[]; // KG L1 영역 id (BELONGS_TO_AREA)
};

export type Candidate = { unitId: string; path: string; description?: string };

// legacy math_field → KG L1 영역 (scripts/migrate-math-concepts/lib/fields.mjs 와 같은 표)
export const FIELD_AREAS: Record<string, string[]> = {
  NUMBERS: ["L1-NUM"],
  ALGEBRA: ["L1-EXPR", "L1-EQ", "L1-FUNC"],
  GEOMETRY: ["L1-GEO"],
  COMBINATORICS: ["L1-PROB"],
  CALCULUS: ["L1-FUNC"],
  VECTORS: ["L1-GEO"],
  STATISTICS: ["L1-PROB"],
};

export const MIN_CANDIDATES = 3;
export const MAX_CANDIDATES = 15;

// 1. school_type 일치 2. math_field → 영역 3. (기존 단원은 쓰지 않음) 4. 유사도 상위 15개, 3개 미만이면 학교급 전체로 확장.
// school_type 이 없는 개념(일괄 등록 TERM)은 math_field 가 기본값이라 믿을 수 없어 두 필터 모두 쓰지 않는다.
export function pickCandidates(
  concept: { schoolType: string | null; mathField: string | null },
  units: Unit[],
  score: (unitId: string) => number
): { candidates: Candidate[]; fallback: boolean } {
  const bySchool = concept.schoolType ? units.filter((u) => u.school === concept.schoolType) : units;
  const areas = concept.schoolType && concept.mathField ? FIELD_AREAS[concept.mathField] : undefined;
  const byField = areas ? bySchool.filter((u) => u.areas.some((a) => areas.includes(a))) : bySchool;
  const rank = (xs: Unit[]) => [...xs].sort((a, b) => score(b.unitId) - score(a.unitId) || a.unitId.localeCompare(b.unitId));
  // 레거시 math_field 는 틀린 경우가 있어(예: 수열이 NUMBERS) 영역 일치 단원을 먼저 넣고, 15개까지는 같은 학교급의 유사도 순으로 채운다.
  const base = bySchool.length >= MIN_CANDIDATES ? bySchool : units;
  const first = rank(byField).slice(0, MAX_CANDIDATES);
  const fill = rank(base.filter((u) => !first.includes(u))).slice(0, MAX_CANDIDATES - first.length);
  const fallback = fill.length > 0 && byField !== bySchool;
  // 후보는 unitId 순으로 준다(선택기 입력이 순위에 끌리지 않게, 같은 입력이면 같은 해시)
  const top = [...first, ...fill].sort((a, b) => a.unitId.localeCompare(b.unitId));
  return { candidates: top.map(({ unitId, path, description }) => ({ unitId, path, description })), fallback };
}

export type Vote = { selector: SelectorName; unitId: string | null; confidence: number | null; error?: string };

export type Decision =
  | { status: "auto_agreed"; majorityUnitId: string; agreeCount: 3; suggestion: string }
  | { status: "needs_review"; majorityUnitId: string | null; agreeCount: number; suggestion: string | null };

// 5.5: 3개 선택기 모두 유효하고 같은 단원일 때만 자동 확정. 그 외는 사람이 결정(제안: 2표 일치 단원, 없으면 최고 confidence).
export function decide(votes: Vote[]): Decision {
  const valid = votes.filter((v) => !v.error && v.unitId);
  const counts = new Map<string, number>();
  for (const v of valid) counts.set(v.unitId!, (counts.get(v.unitId!) ?? 0) + 1);
  const [top, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [null, 0];
  if (valid.length === 3 && topCount === 3) return { status: "auto_agreed", majorityUnitId: top!, agreeCount: 3, suggestion: top! };
  const suggestion =
    topCount >= 2 ? top : ([...valid].sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1))[0]?.unitId ?? null);
  return { status: "needs_review", majorityUnitId: suggestion, agreeCount: topCount, suggestion };
}

export const NONE = "NONE"; // 판단 불가 (structured output enum 에 null 대신 사용)

// LLM 응답 텍스트 → {unitId, confidence}. 코드블록으로 감싼 JSON 도 허용. 후보 밖 id 는 out_of_candidates.
export function parseUnitAnswer(
  text: string,
  candidateIds: string[]
): { unitId: string | null; confidence: number | null; reason?: string; error?: string } {
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let obj: { unit_id?: unknown; confidence?: unknown; reason?: unknown };
  try {
    obj = JSON.parse(body);
  } catch {
    return { unitId: null, confidence: null, error: "invalid_json" };
  }
  const conf = typeof obj.confidence === "number" ? Math.max(0, Math.min(1, obj.confidence)) : null;
  const reason = typeof obj.reason === "string" ? obj.reason : undefined;
  if (obj.unit_id == null || obj.unit_id === NONE) return { unitId: null, confidence: conf, reason };
  if (typeof obj.unit_id !== "string" || !candidateIds.includes(obj.unit_id))
    return { unitId: null, confidence: conf, reason, error: "out_of_candidates" };
  return { unitId: obj.unit_id, confidence: conf, reason };
}

// 선택기 원응답(raw_response) 안의 JSON 문자열에서 "reason" 을 꺼낸다 (Claude·Gemini 공통, 저장 형식 변경 없음)
export function reasonOf(raw: unknown): string | null {
  if (typeof raw === "string") {
    const m = raw.match(/"reason"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) {
      try {
        return JSON.parse(`"${m[1]}"`);
      } catch {
        return m[1];
      }
    }
    return null;
  }
  if (Array.isArray(raw)) {
    for (const x of raw) {
      const r = reasonOf(x);
      if (r) return r;
    }
  } else if (raw && typeof raw === "object") {
    for (const x of Object.values(raw)) {
      const r = reasonOf(x);
      if (r) return r;
    }
  }
  return null;
}
