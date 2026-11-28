import type { ConceptProposal, ModelName } from "./types.ts";

export type UnitVote = { model: ModelName; ok: boolean; unitId?: string | null; confidence?: number | null };
export type UnitTally =
  | { status: "decided"; unitId: string; agreement: "3/3" | "2/3" | "2/2"; flags: ("two_models_only" | "majority_2of3")[]; supporters: ModelName[]; counts: Record<string, number>; successModels: ModelName[] }
  | { status: "needs_grok"; agreement: "none" | "1"; flags: "insufficient_models"[]; supporters: ModelName[]; counts: Record<string, number>; successModels: ModelName[] }
  | { status: "error"; agreement: "0"; flags: []; supporters: []; counts: Record<string, number>; successModels: [] };

// §6.1: 성공 모델 3개 — 2표 이상 일치하면 majority, 아니면 Grok / 2개 — 일치하면 majority + two_models_only, 아니면 Grok / 1개 — Grok / 0개 — error
export function tallyUnits(votes: UnitVote[]): UnitTally {
  const ok = votes.filter((v) => v.ok && v.unitId);
  const counts: Record<string, number> = {};
  for (const v of ok) counts[v.unitId!] = (counts[v.unitId!] ?? 0) + 1;
  const successModels = ok.map((v) => v.model);
  if (ok.length === 0) return { status: "error", agreement: "0", flags: [], supporters: [], counts, successModels: [] };
  if (ok.length === 1) return { status: "needs_grok", agreement: "1", flags: ["insufficient_models"], supporters: [], counts, successModels };
  const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  if (n >= 2) {
    const supporters = ok.filter((v) => v.unitId === top).map((v) => v.model);
    if (ok.length === 2) return { status: "decided", unitId: top, agreement: "2/2", flags: ["two_models_only"], supporters, counts, successModels };
    return { status: "decided", unitId: top, agreement: n === 3 ? "3/3" : "2/3", flags: n === 3 ? [] : ["majority_2of3"], supporters, counts, successModels };
  }
  return { status: "needs_grok", agreement: "none", flags: [], supporters: [], counts, successModels };
}

export type ConceptTally =
  | {
      status: "decided";
      primary: string;
      secondary: string[];
      agreement: "3/3" | "2/3" | "2/2";
      flags: ("two_models_only" | "majority_2of3")[];
      supporters: ModelName[];
      counts: Record<string, number>;
      successModels: ModelName[];
    }
  | { status: "needs_grok"; agreement: "none" | "1"; flags: "insufficient_models"[]; union: string[]; counts: Record<string, number>; successModels: ModelName[] }
  | { status: "error"; agreement: "0"; flags: []; union: []; counts: Record<string, number>; successModels: [] };

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// 보조 개념: 채택 주 개념 제외, 역할 무관 2개 이상 모델이 제안한 개념. (제안 모델 수 desc, 평균 확신도 desc, id asc) 상위 max개.
export function pickSecondary(ok: ConceptProposal[], primary: string, max = 3): string[] {
  const by = new Map<string, { n: number; conf: number[] }>();
  for (const p of ok) {
    for (const c of new Set([p.primary, ...p.secondary].filter((x): x is string => !!x))) {
      if (c === primary) continue;
      const e = by.get(c) ?? by.set(c, { n: 0, conf: [] }).get(c)!;
      e.n++;
      e.conf.push(p.confidence ?? 0);
    }
  }
  return [...by.entries()]
    .filter(([, e]) => e.n >= 2)
    .sort((a, b) => b[1].n - a[1].n || avg(b[1].conf) - avg(a[1].conf) || (a[0] < b[0] ? -1 : 1))
    .slice(0, max)
    .map(([id]) => id);
}

// §7.3: 주 개념은 모델당 1표
export function tallyConcepts(proposals: ConceptProposal[], maxSecondary = 3): ConceptTally {
  const ok = proposals.filter((p) => p.ok && p.primary);
  const counts: Record<string, number> = {};
  for (const p of ok) counts[p.primary!] = (counts[p.primary!] ?? 0) + 1;
  const successModels = ok.map((p) => p.model);
  const union = [...new Set(ok.flatMap((p) => [p.primary!, ...p.secondary]))].sort();
  if (ok.length === 0) return { status: "error", agreement: "0", flags: [], union: [], counts, successModels: [] };
  if (ok.length === 1) return { status: "needs_grok", agreement: "1", flags: ["insufficient_models"], union, counts, successModels };
  const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  if (n >= 2) {
    const supporters = ok.filter((p) => p.primary === top).map((p) => p.model);
    const secondary = pickSecondary(ok, top, maxSecondary);
    if (ok.length === 2) return { status: "decided", primary: top, secondary, agreement: "2/2", flags: ["two_models_only"], supporters, counts, successModels };
    return { status: "decided", primary: top, secondary, agreement: n === 3 ? "3/3" : "2/3", flags: n === 3 ? [] : ["majority_2of3"], supporters, counts, successModels };
  }
  return { status: "needs_grok", agreement: "none", flags: [], union, counts, successModels };
}
