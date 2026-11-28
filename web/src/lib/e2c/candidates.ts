import { cosine } from "../l2o/dedupe.ts";
import type { E2cConfig } from "./config.ts";
import { subjectPrefixes, unitInPrefixes } from "./subjectMap.ts";
import type { ConceptOption, ProblemInput, UnitOption } from "./types.ts";

const clip = (s: string) => s.slice(0, 2000);

// 단원 option text: `과목 > 단원명 — 한 줄 설명`
export const unitOptionText = (subjectName: string, name: string, description?: string) => `${subjectName} > ${name}${description ? ` — ${description}` : ""}`;

// 개념 option text: `제목 — 설명 첫 문장`
export function conceptOptionText(title: string, statement: string): string {
  const first = statement.replace(/\s+/g, " ").trim().split(/(?<=[.!?。])\s|\n/)[0]?.slice(0, 120) ?? "";
  return first && first !== title ? `${title} — ${first}` : title;
}

// §5.1 후보 단원: 과목 매핑 → 15개 초과면 임베딩 상위 15개 → 0개면 고등 전체(candidate_fallback)
export async function pickUnitCandidates(
  problem: ProblemInput,
  all: UnitOption[],
  cfg: Pick<E2cConfig, "subject_map" | "max_unit_candidates">,
  embed: (texts: string[]) => Promise<number[][]>
): Promise<{ candidates: UnitOption[]; fallback: boolean }> {
  const prefixes = subjectPrefixes(problem.meta.subject, cfg.subject_map);
  let pool = prefixes ? all.filter((u) => unitInPrefixes(u.unitId, prefixes)) : [];
  const fallback = pool.length === 0;
  if (fallback) pool = all;
  if (pool.length > cfg.max_unit_candidates) {
    const vecs = await embed([clip(`${problem.problemText}\n${problem.solutionText}`), ...pool.map((u) => u.text)]);
    const score = new Map(pool.map((u, i) => [u.unitId, cosine(vecs[0], vecs[i + 1])]));
    pool = [...pool].sort((a, b) => score.get(b.unitId)! - score.get(a.unitId)! || (a.unitId < b.unitId ? -1 : 1)).slice(0, cfg.max_unit_candidates);
  }
  return { candidates: [...pool].sort((a, b) => (a.unitId < b.unitId ? -1 : 1)), fallback };
}

// §7.1 개념 options: 채택 단원의 개념. 상한을 넘으면 임베딩 유사도 상위만
export async function pickConceptOptions(
  problem: ProblemInput,
  all: ConceptOption[],
  max: number,
  embed: (texts: string[]) => Promise<number[][]>
): Promise<ConceptOption[]> {
  let pool = all;
  if (pool.length > max) {
    const vecs = await embed([clip(`${problem.problemText}\n${problem.solutionText}`), ...pool.map((c) => c.text)]);
    const score = new Map(pool.map((c, i) => [c.conceptId, cosine(vecs[0], vecs[i + 1])]));
    pool = [...pool].sort((a, b) => score.get(b.conceptId)! - score.get(a.conceptId)! || (a.conceptId < b.conceptId ? -1 : 1)).slice(0, max);
  }
  return [...pool].sort((a, b) => (a.conceptId < b.conceptId ? -1 : 1));
}
