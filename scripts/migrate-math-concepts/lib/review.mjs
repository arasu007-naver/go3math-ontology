// 단계 4 확정 규칙 + 검수 대기열 행 (DB·API 없이 테스트할 수 있게 분리)

// 두 모델 primary 일치 & 둘 다 confidence ≥ 기준 → confirmed(자동 확정, 사용자 최종 검수는 여전히 필요)
// 그 밖(불일치, 미달, null, 한쪽 오류) → review / error
export function decide(st, threshold) {
  const c = st.claude?.result, g = st.gemini?.result;
  if (st.claude?.error || st.gemini?.error) return "error";
  if (!c || !g) return "pending";
  const agree = c.primary_unit_id != null && c.primary_unit_id === g.primary_unit_id;
  return agree && c.confidence >= threshold && g.confidence >= threshold ? "confirmed" : "review";
}

export const USER_COLUMNS = [
  "final_primary_unit_id", "final_secondary_unit_ids", "final_achievement_codes", "final_prerequisite_ids",
  "replace_existing", "approved", "reviewer_note",
];

export const REVIEW_HEADER = [
  "item_id", "item_type", "status", "title", "statement_excerpt", "existing_chapters",
  "claude_primary", "claude_primary_path", "claude_confidence", "claude_secondary", "claude_rationale",
  "gemini_primary", "gemini_primary_path", "gemini_confidence", "gemini_secondary", "gemini_rationale",
  "errors", ...USER_COLUMNS,
];

// prev: 이전 review_queue.csv 의 같은 item 행 (검수자가 적은 열은 유지)
export function reviewRow(item, rep, st, unitsById, prev) {
  const c = st.claude?.result, g = st.gemini?.result;
  const path = (id) => (id ? unitsById.get(id)?.path ?? "(알 수 없는 단원)" : "");
  const row = {
    item_id: item.item_id,
    item_type: item.item_type,
    status: st.status,
    title: rep.title,
    // 본문 요약 = 원문 앞부분 (요약·재작성 없이)
    statement_excerpt: rep.statement.replace(/\s+/g, " ").slice(0, 200),
    existing_chapters: rep.chapters.map((ch) => ch.title).join(", "),
    claude_primary: c?.primary_unit_id ?? "", claude_primary_path: path(c?.primary_unit_id),
    claude_confidence: c?.confidence ?? "", claude_secondary: c?.secondary_unit_ids ?? [], claude_rationale: c?.rationale ?? "",
    gemini_primary: g?.primary_unit_id ?? "", gemini_primary_path: path(g?.primary_unit_id),
    gemini_confidence: g?.confidence ?? "", gemini_secondary: g?.secondary_unit_ids ?? [], gemini_rationale: g?.rationale ?? "",
    errors: [st.claude?.error && `claude: ${st.claude.error}`, st.gemini?.error && `gemini: ${st.gemini.error}`].filter(Boolean).join(" / "),
  };
  // 자동 확정 건은 Claude 결과로 미리 채운다(일괄 승인용). 검수 건은 비워 둔다.
  const prefill = st.status === "confirmed"
    ? {
        final_primary_unit_id: c.primary_unit_id,
        final_secondary_unit_ids: c.secondary_unit_ids,
        final_achievement_codes: c.achievement_codes,
        final_prerequisite_ids: c.prerequisite_concept_ids,
      }
    : {};
  const kept = prev && USER_COLUMNS.some((k) => String(prev[k] ?? "").trim());
  for (const k of USER_COLUMNS) row[k] = kept ? prev[k] ?? "" : prefill[k] ?? "";
  return row;
}

// 균등 간격 표본 (파일럿용, 실행마다 같은 표본)
export function evenSample(items, n) {
  if (n >= items.length) return items;
  return Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)]);
}
