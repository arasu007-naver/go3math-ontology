// 단계 0 병합 로직 (DB·API 없이 테스트할 수 있게 분리)
import { gradeLabel, splitList } from "./util.mjs";

// 대표 선정: is_on=1 > curriculum_year 2022 > 본문 길이(HTML 제외) > 최신 updated_at
export const repOrder = (x, y) =>
  y.is_on - x.is_on ||
  (y.curriculum_year === "2022") - (x.curriculum_year === "2022") ||
  y.statement.length - x.statement.length ||
  String(y.updated_at ?? "").localeCompare(String(x.updated_at ?? ""));

// same 판정 쌍을 union-find 로 묶어 병합 그룹을 만든다.
// pairs: [{a, b}], verdictOf(pair) → {verdict, rationale} | undefined
export function buildMergeGroups(concepts, pairs, verdictOf) {
  const parent = new Map();
  const find = (x) => {
    while (parent.has(x) && parent.get(x) !== x) x = parent.get(x);
    return x;
  };
  for (const p of pairs) if (verdictOf(p)?.verdict === "same") {
    const [ra, rb] = [find(p.a), find(p.b)];
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map();
  for (const c of concepts) {
    const r = find(c.id);
    (groups.get(r) ?? groups.set(r, []).get(r)).push(c);
  }

  const rows = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    members.sort(repOrder);
    const [rep, ...rest] = members;
    const ids = new Set(members.map((c) => c.id));
    const inner = pairs.filter((p) => ids.has(p.a) && ids.has(p.b));
    const reasons = [];
    const grades = members.map((c) => c.grade).filter((g) => g != null);
    if (grades.length && Math.max(...grades) - Math.min(...grades) >= 2) reasons.push("학년 2단계 이상 차이");
    if (new Set(members.map((c) => c.concept_type)).size > 1) reasons.push("concept_type 다름");
    if (inner.some((p) => verdictOf(p)?.verdict && verdictOf(p).verdict !== "same")) reasons.push("그룹 안에 same 이 아닌 쌍 있음(연쇄 병합)");
    rows.push({
      representative_id: rep.id,
      merged_ids: rest.map((c) => c.id),
      titles: members.map((c) => `${c.id}:${c.title}`).join(" / "),
      grades: members.map((c) => gradeLabel(c.grade)).join(" "),
      concept_types: members.map((c) => c.concept_type).join(" "),
      rationale: inner.filter((p) => verdictOf(p)?.verdict === "same").map((p) => `[${p.a}-${p.b}] ${verdictOf(p).rationale}`).join(" "),
      needs_review: reasons.length ? "Y" : "",
      review_reasons: reasons.join("; "),
      approved: reasons.length ? "" : "Y", // 검수 대상은 사용자가 Y 를 적어야 병합된다
    });
  }
  rows.sort((a, b) => a.representative_id - b.representative_id);
  return rows.map((r, i) => ({ group_id: `G${String(i + 1).padStart(4, "0")}`, ...r }));
}

// merge_groups.csv(사용자 검수 반영본)의 approved=Y 그룹만 적용해 대표 개념 목록을 만든다.
// 대표 본문은 그대로 두고, 병합되는 개념 본문이 대표 본문에 들어 있지 않으면 merge_notes 에 원문 그대로 보존한다.
export function applyMergeGroups(concepts, groupRows) {
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const mergedInto = new Map(); // 병합되어 사라지는 id → 대표 id
  const repInfo = new Map();
  for (const g of groupRows) {
    if (String(g.approved).trim().toUpperCase() !== "Y") continue;
    const rep = Number(g.representative_id);
    const merged = splitList(g.merged_ids).map(Number);
    for (const id of [rep, ...merged]) {
      if (!byId.has(id)) throw new Error(`${g.group_id}: 개념 ${id} 가 원본(is_on=1)에 없습니다`);
      if (mergedInto.has(id) || (repInfo.has(id) && id !== rep)) throw new Error(`${g.group_id}: 개념 ${id} 가 여러 그룹에 있습니다`);
    }
    if (repInfo.has(rep)) throw new Error(`${g.group_id}: 대표 ${rep} 가 여러 그룹에 있습니다`);
    for (const id of merged) mergedInto.set(id, rep);
    repInfo.set(rep, { group_id: g.group_id, merged });
  }
  for (const rep of repInfo.keys()) if (mergedInto.has(rep)) throw new Error(`개념 ${rep} 가 대표이면서 다른 그룹에 병합됩니다`);

  return concepts
    .filter((c) => !mergedInto.has(c.id))
    .map((c) => {
      const info = repInfo.get(c.id);
      const merged = info?.merged ?? [];
      const repText = c.statement.replace(/\s+/g, " ").trim();
      const merge_notes = merged
        .map((id) => byId.get(id))
        .filter((x) => x.statement && !repText.includes(x.statement.replace(/\s+/g, " ").trim()))
        .map((x) => ({ source_id: x.id, raw_title: x.raw_title, raw_statement: x.raw_statement }));
      // 기존 단원 힌트는 병합된 개념 것까지 모은다
      const seen = new Set();
      const chapters = [c, ...merged.map((id) => byId.get(id))].flatMap((x) => x.chapters).filter((ch) => !seen.has(ch.id) && seen.add(ch.id));
      return { ...c, merged_source_ids: merged, merge_group_id: info?.group_id ?? null, merge_notes, chapters };
    });
}
