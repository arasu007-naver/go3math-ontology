// 단계 1 후보 선정 (DB·API 없이 테스트할 수 있게 분리)
import { FIELD_AREAS } from "./fields.mjs";
import { cosine } from "./util.mjs";

// 학년 ±1, math_field → 영역 필터. 학년 없는 단원(선택 과목)은 고등 개념(또는 학년 모르는 개념)에만 허용.
export function passesFilter(concept, unit) {
  const g = concept.grade;
  const gradeOk = g == null || (unit.grade == null ? g >= 10 : Math.abs(unit.grade - g) <= 1);
  const areas = concept.meta_reliable === false ? null : FIELD_AREAS[concept.math_field]; // 기본값 math_field 는 쓰지 않는다
  const areaOk = !areas || !unit.areas.length || unit.areas.some((a) => areas.includes(a));
  return gradeOk && areaOk;
}

// 필터 통과 단원이 topK 미만이면 필터를 풀고 전체에서 고른다
export function pickCandidates(concept, vec, units, unitVecs, topK) {
  let idx = units.map((_, i) => i).filter((i) => passesFilter(concept, units[i]));
  const relaxed = idx.length < topK;
  if (relaxed) idx = units.map((_, i) => i);
  const scored = idx.map((i) => ({ unit_id: units[i].id, score: cosine(vec, unitVecs[i]) }));
  scored.sort((a, b) => b.score - a.score);
  return { candidates: scored.slice(0, topK), filter_relaxed: relaxed };
}

// 단계 5 선수 개념 후보: 같은·하위 학년, 같은 수학 분야의 대표 개념 중 유사도 상위 n
export function pickPrereqs(concept, vec, reps, repVecs, n) {
  const scored = [];
  reps.forEach((r, i) => {
    if (r.id === concept.id) return;
    if (concept.grade != null && r.grade != null && r.grade > concept.grade) return;
    const fieldsKnown = concept.meta_reliable !== false && r.meta_reliable !== false;
    if (fieldsKnown && concept.math_field && r.math_field && r.math_field !== concept.math_field) return;
    scored.push({ id: r.id, score: cosine(vec, repVecs[i]) });
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map((s) => s.id);
}
