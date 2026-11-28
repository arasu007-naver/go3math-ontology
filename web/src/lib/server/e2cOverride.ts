import type { ResultRow } from "./e2cPipeline.ts";

// 수동 수정·확인·파일럿 라벨. 저장소는 주입한다(DB 없이 테스트).
export interface OverrideStore {
  getResult(problemId: number): Promise<ResultRow | null>;
  conceptIdsOfUnit(unitId: string): Promise<string[] | null>; // 단원이 없으면 null
  saveOverride(a: { before: ResultRow; after: ResultRow; reason: string; actor: string }): Promise<void>;
  saveConfirmed(row: ResultRow, actor: string): Promise<void>;
  savePilotLabel(l: { problemId: number; unitId: string; primaryConceptId: string; secondaryConceptIds: string[] }, actor: string): Promise<void>;
}
export class OverrideError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type OverrideInput = { problemId: number; unitId?: string; primaryConceptId?: string; secondaryConceptIds?: string[]; reason: string };

function checkConcepts(primary: string | null | undefined, secondary: string[], allowed: Set<string>) {
  if (secondary.length > 3) throw new OverrideError("보조 개념은 3개까지입니다.");
  const all = [...(primary ? [primary] : []), ...secondary];
  if (new Set(all).size !== all.length) throw new OverrideError("개념이 중복되었습니다.");
  if (!all.every((c) => allowed.has(c))) throw new OverrideError("채택 단원에 속하지 않은 개념이 있습니다.");
}

async function unitConcepts(store: OverrideStore, unitId: string): Promise<Set<string>> {
  const ids = await store.conceptIdsOfUnit(unitId);
  if (!ids) throw new OverrideError("없는 단원입니다.");
  return new Set(ids);
}

export async function applyOverride(store: OverrideStore, input: OverrideInput, actor: string): Promise<ResultRow> {
  if (!input.reason?.trim()) throw new OverrideError("사유를 입력하세요.");
  const before = await store.getResult(input.problemId);
  if (!before) throw new OverrideError("처리 결과가 없는 문항입니다.", 404);
  if (before.status === "applied") throw new OverrideError("이미 KG 에 반영된 문항입니다.", 409);
  const unitId = input.unitId ?? before.finalUnitId;
  if (!unitId) throw new OverrideError("단원을 선택하세요.");
  const secondary = input.secondaryConceptIds ?? [];
  const conceptsGiven = input.primaryConceptId !== undefined || input.secondaryConceptIds !== undefined;
  const allowed = await unitConcepts(store, unitId);
  const unitChanged = unitId !== before.finalUnitId;
  let primary = input.primaryConceptId ?? null;
  let sec = secondary;
  if (!conceptsGiven && !unitChanged) {
    primary = before.primaryConceptId;
    sec = before.secondaryConceptIds;
  }
  checkConcepts(primary, sec, allowed);
  const keepConcepts = conceptsGiven || !unitChanged;
  const prevDetail = (before.conceptDetail ?? {}) as Record<string, unknown>;
  const history = Array.isArray(prevDetail.history) ? prevDetail.history : [];
  const after: ResultRow = {
    ...before,
    status: "overridden",
    finalUnitId: unitId,
    unitSource: input.unitId !== undefined ? "manual" : before.unitSource,
    unitRule: input.unitId !== undefined ? null : before.unitRule,
    primaryConceptId: keepConcepts ? primary : null,
    secondaryConceptIds: keepConcepts ? sec : [],
    conceptSource: conceptsGiven ? "manual" : unitChanged ? null : before.conceptSource,
    // 단원이 바뀌었는데 개념을 안 골랐으면 개념 단계 재실행 대상으로 표시하고 이전 결과는 이력에 남긴다
    rerunConcept: unitChanged && !conceptsGiven,
    conceptDetail: unitChanged
      ? { history: [...history, { primaryConceptId: before.primaryConceptId, secondaryConceptIds: before.secondaryConceptIds, source: before.conceptSource, unitId: before.finalUnitId }] }
      : before.conceptDetail,
    error: null,
  };
  await store.saveOverride({ before, after, reason: input.reason.trim(), actor });
  return after;
}

export async function confirmResult(store: OverrideStore, problemId: number, actor: string): Promise<ResultRow> {
  const row = await store.getResult(problemId);
  if (!row) throw new OverrideError("처리 결과가 없는 문항입니다.", 404);
  if (row.status === "applied") throw new OverrideError("이미 KG 에 반영된 문항입니다.", 409);
  if (!row.finalUnitId || !row.primaryConceptId) throw new OverrideError("단원과 주 개념이 정해져야 확인할 수 있습니다.");
  const after = { ...row, status: "confirmed" as const };
  await store.saveConfirmed(after, actor);
  return after;
}

export async function savePilotLabel(store: OverrideStore, l: { problemId: number; unitId: string; primaryConceptId: string; secondaryConceptIds: string[] }, actor: string) {
  const allowed = await unitConcepts(store, l.unitId);
  checkConcepts(l.primaryConceptId, l.secondaryConceptIds, allowed);
  await store.savePilotLabel(l, actor);
}
