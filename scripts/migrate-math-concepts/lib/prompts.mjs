// 판정 프롬프트와 출력 스키마. 단계 2(Claude)와 단계 3(Gemini)은 같은 프롬프트·같은 스키마를 쓴다.
// 수식은 원문 그대로 넣는다(변환 금지).
import { z } from "zod";
import { gradeLabel } from "./util.mjs";

const toSchema = (zs) => {
  const { $schema, ...s } = z.toJSONSchema(zs);
  return s;
};

// ---------- 단원 매핑 ----------
export const Judgment = z.strictObject({
  item_id: z.string(),
  item_type: z.string(),
  primary_unit_id: z.string().nullable(),
  secondary_unit_ids: z.array(z.string()),
  achievement_codes: z.array(z.string()),
  prerequisite_concept_ids: z.array(z.string()),
  rationale: z.string(),
  confidence: z.number(),
});
export const judgmentSchema = toSchema(Judgment);

export const JUDGE_SYSTEM = `당신은 한국 2022 개정 교육과정 수학 전문가입니다. 주어진 수학 항목 1개를 '후보 단원' 목록 안에서 가장 알맞은 2022 개정 교육과정 단원에 연결합니다. 정확도가 최우선입니다.

규칙
1. primary_unit_id 는 반드시 후보 단원의 unit_id 중 하나여야 합니다. 그 개념이 2022 개정 교육과정에서 처음 정식으로 도입·학습되는 단원을 고르세요. 대단원과 그 아래 소단원이 모두 후보이면 더 구체적으로 맞는 쪽을 고르세요.
2. secondary_unit_ids 에는 그 개념이 의미 있게 다시 쓰이거나 확장되는 다른 후보 단원만 넣습니다(primary 제외, 없으면 빈 배열).
3. achievement_codes 에는 후보 단원에 적힌 성취기준 코드 중 이 개념에 해당하는 것만 넣습니다. 성취기준이 주어지지 않았으면 빈 배열입니다.
4. prerequisite_concept_ids 에는 '선수 개념 후보' 목록의 id 중 이 개념을 이해하는 데 직접 필요한 것만 넣습니다. 목록이 없으면 빈 배열입니다.
5. 알맞은 후보가 없으면(예: 2022 개정 교육과정 범위 밖, 후보 모두 무관) primary_unit_id 는 null, secondary_unit_ids 는 빈 배열, confidence 는 0 입니다.
6. '기존 단원(참고)'은 구 교육과정 단원일 수 있는 힌트일 뿐 정답이 아닙니다.
7. 본문의 수식은 원문 표기(백틱 AsciiMath 또는 $ LaTeX)를 그대로 읽으세요.
8. item_id, item_type 은 입력값을 그대로 씁니다.
9. rationale 은 한국어 2문장 이내로, 왜 그 단원인지 씁니다.
10. confidence 는 0~1 사이로, primary_unit_id 가 정답일 확률에 대한 솔직한 추정입니다.

출력은 다음 형태의 JSON 객체 하나만 씁니다(다른 글 없이):
{"item_id": "...", "item_type": "concept", "primary_unit_id": "..." 또는 null, "secondary_unit_ids": [], "achievement_codes": [], "prerequisite_concept_ids": [], "rationale": "...", "confidence": 0.0}`;

// 후보 단원 블록. unit_id 순으로 고정해, 후보가 모든 단원(TOP_K ≥ 단원 수)이면 항목마다 같은 글이 되어 캐시된다.
export function candidatesBlock(candidates) {
  return [
    `## 후보 단원 (${candidates.length}개)`,
    ...[...candidates].sort((a, b) => a.id.localeCompare(b.id)).map((u) => {
      const ach = u.achievements.map((a) => `[${a.code}] ${a.text}`).join(" / ");
      return `- unit_id: ${u.id} | ${u.area_names.join("·")} | ${u.path} | 학년: ${gradeLabel(u.grade)}${ach ? ` | 성취기준: ${ach}` : ""}`;
    }),
  ].join("\n");
}

// 판정 프롬프트: system = 공통 지침 + 후보 단원(캐시 대상), user = 항목(+ 선수 개념 후보)
export function judgePrompt(item, candidates, prereqs) {
  return { system: `${JUDGE_SYSTEM}\n\n${candidatesBlock(candidates)}`, user: judgeUserPrompt(item, prereqs) };
}

function judgeUserPrompt(item, prereqs) {
  const c = item.concept;
  const lines = [
    "## 항목",
    `item_id: ${item.item_id}`,
    `item_type: ${item.item_type}`,
    `제목: ${c.title}`,
    c.meta_reliable === false
      ? `개념 유형: ${c.concept_type ?? "?"} / 수학 분야·학년: 미상(원본 값이 일괄 기본값이라 믿을 수 없음) / 난이도: ${c.difficulty_level ?? "?"}`
      : `개념 유형: ${c.concept_type ?? "?"} / 수학 분야: ${c.math_field ?? "?"} / 학년: ${c.curriculum_type ?? c.school_type ?? "?"} / 교육과정: ${c.curriculum_year ?? "?"} / 난이도: ${c.difficulty_level ?? "?"}`,
    `기존 단원(참고): ${c.chapters.map((ch) => `${ch.title}${ch.curriculum_type ? ` (${ch.curriculum_type})` : ""}`).join(", ") || "없음"}`,
    "본문:",
    c.statement || (c.img_path ? "(본문 없음 — 이미지 전용 개념)" : "(본문 없음)"),
  ];
  if (prereqs?.length) {
    lines.push("", `## 선수 개념 후보 (${prereqs.length}개)`);
    for (const p of prereqs) lines.push(`- id: ${p.id} | ${p.title} | ${gradeLabel(p.grade)} | ${p.math_field ?? ""}`);
  }
  return lines.join("\n");
}

// 스키마 검증 + 후보 밖 선택 검사. 위반이면 Error (→ 오류로 기록, 검수 대기열)
export function validateJudgment(raw, item, candidateIds, prereqIds) {
  const j = Judgment.parse(raw);
  const errs = [];
  if (j.item_id !== item.item_id) errs.push(`item_id 불일치(${j.item_id})`);
  if (j.primary_unit_id != null && !candidateIds.has(j.primary_unit_id)) errs.push(`후보 밖 primary(${j.primary_unit_id})`);
  if (!(j.confidence >= 0 && j.confidence <= 1)) errs.push(`confidence 범위 밖(${j.confidence})`);
  if (errs.length) throw new Error(errs.join(", "));
  const allowedCodes = new Set(item.candidateAchievementCodes);
  return {
    ...j,
    item_type: item.item_type,
    confidence: j.primary_unit_id == null ? 0 : j.confidence,
    // 후보 밖 보조 단원·성취기준·선수 개념은 버리고 기록만 남긴다
    secondary_unit_ids: j.secondary_unit_ids.filter((id) => candidateIds.has(id) && id !== j.primary_unit_id),
    achievement_codes: j.achievement_codes.filter((code) => allowedCodes.has(code)),
    prerequisite_concept_ids: j.prerequisite_concept_ids.filter((id) => prereqIds.has(id)),
    dropped: [
      ...j.secondary_unit_ids.filter((id) => !candidateIds.has(id)),
      ...j.achievement_codes.filter((code) => !allowedCodes.has(code)),
      ...j.prerequisite_concept_ids.filter((id) => !prereqIds.has(id)),
    ],
  };
}

// ---------- 단계 0: 중복 개념 판정 ----------
export const MergeVerdict = z.strictObject({
  verdict: z.enum(["same", "different", "parent_child"]),
  parent_id: z.string().nullable(),
  rationale: z.string(),
});
export const mergeSchema = toSchema(MergeVerdict);

export const MERGE_SYSTEM = `당신은 한국 수학 교육과정 전문가입니다. 수학 개념 데이터베이스에서 중복 후보로 뽑힌 개념 두 개를 비교합니다.

판정
- same: 같은 개념을 다른 글로 쓴 것(학년·교육과정 연도만 다르고 내용이 같은 경우 포함). 하나로 합쳐도 정보가 사라지지 않거나, 사라지는 정보가 부수적인 경우.
- parent_child: 한 개념이 다른 개념을 포함하거나 일반화한 관계(예: 정의 ↔ 그 정의의 특수한 경우, 정리 ↔ 그 정리의 따름 성질). parent_id 에 더 일반적인 개념의 id 를 씁니다.
- different: 제목이 비슷해도 다른 개념.
제목만 보지 말고 본문을 비교하세요. 확실하지 않으면 different 로 판정합니다. 수식은 원문 표기 그대로 읽으세요.
rationale 은 한국어 2문장 이내. parent_child 가 아니면 parent_id 는 null.
출력은 {"verdict": "same|different|parent_child", "parent_id": null, "rationale": "..."} 형태의 JSON 하나만 씁니다.`;

export function mergeUserPrompt(a, b) {
  const one = (c) =>
    [
      `id: ${c.id}`,
      `제목: ${c.title}`,
      `개념 유형: ${c.concept_type ?? "?"} / 수학 분야: ${c.math_field ?? "?"} / 학년: ${c.curriculum_type ?? "?"} / 교육과정: ${c.curriculum_year ?? "?"}`,
      "본문:",
      c.statement || "(본문 없음)",
    ].join("\n");
  return `## 개념 A\n${one(a)}\n\n## 개념 B\n${one(b)}`;
}
