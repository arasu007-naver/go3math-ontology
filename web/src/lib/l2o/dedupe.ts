// 중복제거 순수 로직 (specs/math_concepts2ontology.md 5.1). DB·API 의존 없음 → node --test 로 바로 돈다.

// 2. 정규화: (HTML 은 legacyDb 에서 이미 걷어냄) 전각→반각(NFKC), 소문자, 공백 하나로, backtick 안 공백 제거
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/`([^`]*)`/g, (_, m: string) => "`" + m.replace(/\s+/g, "") + "`")
    .replace(/\s+/g, " ")
    .trim();
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export type RepCandidate = { id: number; hasHtmlStatement: boolean; statementLength: number; curriculumYear: string | null };

// 6. 대표 선택: html_statement 존재 > statement 길이 > curriculum_year 최신 > id 최소
export function pickRepresentative(cs: RepCandidate[]): number {
  const year = (c: RepCandidate) => Number.parseInt(c.curriculumYear ?? "", 10) || 0;
  return [...cs].sort(
    (a, b) =>
      Number(b.hasHtmlStatement) - Number(a.hasHtmlStatement) ||
      b.statementLength - a.statementLength ||
      year(b) - year(a) ||
      a.id - b.id
  )[0].id;
}

// 쌍 목록 → 연결 요소 (union-find). 각 요소는 id 오름차순, 요소 목록은 첫 id 오름차순.
export function components(ids: number[], pairs: [number, number][]): number[][] {
  const parent = new Map(ids.map((i) => [i, i]));
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const [a, b] of pairs) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  }
  const out = new Map<number, number[]>();
  for (const i of [...ids].sort((a, b) => a - b)) {
    const r = find(i);
    (out.get(r) ?? out.set(r, []).get(r)!).push(i);
  }
  return [...out.values()].sort((a, b) => a[0] - b[0]);
}

// 5. JEV same 확률 → 병합 판정
export const JEV_MERGE = 0.8;
export const JEV_REVIEW = 0.5;
export function judgePair(sameProb: number | null): "merge" | "review" | "separate" {
  if (sameProb == null) return "review"; // JEV 미설정·오류 → 사람 검토
  if (sameProb >= JEV_MERGE) return "merge";
  if (sameProb >= JEV_REVIEW) return "review";
  return "separate";
}
