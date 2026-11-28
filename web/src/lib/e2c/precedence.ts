// pickFinalUnit: 관련 단원 집합에서 선후상 가장 뒤 단원 1개. 모델을 부르지 않는 결정적 함수.
export type PrecedenceGraph = {
  unitPrereq: [string, string][]; // PREREQUISITE_OF 단원 src → dst (src 가 앞)
  subjectPrereq: [string, string][]; // PREREQ_OF 과목 src → dst (src 가 앞)
  unitSubject: Record<string, string>;
  subjectOrder: Record<string, number>;
  unitOrder: Record<string, number>;
};
export type PickResult =
  | { unitId: string; rule: "precedence" | "curriculum_order"; error?: undefined }
  | { unitId: null; rule?: undefined; error: "precedence_cycle" | "empty" };

// 과목 A 가 B 보다 앞이면 A 의 모든 단원이 B 의 모든 단원보다 앞이다. 단원·"과목 입구" 노드를 한 그래프로 두고 도달 가능성을 본다.
export function makeReach(g: PrecedenceGraph): (a: string, b: string) => boolean {
  const unitsOf = new Map<string, string[]>();
  for (const [u, s] of Object.entries(g.unitSubject)) (unitsOf.get(s) ?? unitsOf.set(s, []).get(s)!).push(u);
  const succ = new Map<string, string[]>();
  const add = (a: string, b: string) => (succ.get(a) ?? succ.set(a, []).get(a)!).push(b);
  for (const [a, b] of g.unitPrereq) add(a, b);
  const subjSucc = new Map<string, string[]>();
  for (const [a, b] of g.subjectPrereq) (subjSucc.get(a) ?? subjSucc.set(a, []).get(a)!).push(b);
  for (const [u, s] of Object.entries(g.unitSubject)) for (const t of subjSucc.get(s) ?? []) add(u, `S:${t}`);
  for (const [s, us] of unitsOf) for (const u of us) add(`S:${s}`, u);
  const cache = new Map<string, Set<string>>();
  const from = (a: string): Set<string> => {
    const hit = cache.get(a);
    if (hit) return hit;
    const seen = new Set<string>();
    const stack = [...(succ.get(a) ?? [])];
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(...(succ.get(n) ?? []));
    }
    cache.set(a, seen);
    return seen;
  };
  return (a, b) => from(a).has(b);
}

export function pickFinalUnit(unitIds: string[], graph: PrecedenceGraph, reach = makeReach(graph)): PickResult {
  const ids = [...new Set(unitIds)];
  if (!ids.length) return { unitId: null, error: "empty" };
  for (const a of ids) if (reach(a, a)) return { unitId: null, error: "precedence_cycle" };
  const maxima = ids.filter((a) => !ids.some((b) => b !== a && reach(a, b)));
  if (!maxima.length) return { unitId: null, error: "precedence_cycle" };
  if (maxima.length === 1) return { unitId: maxima[0], rule: "precedence" };
  const key = (u: string) => [graph.subjectOrder[graph.unitSubject[u]] ?? 0, graph.unitOrder[u] ?? 0] as const;
  const sorted = [...maxima].sort((a, b) => {
    const [sa, ua] = key(a);
    const [sb, ub] = key(b);
    return sa - sb || ua - ub || (a < b ? -1 : 1);
  });
  return { unitId: sorted[sorted.length - 1], rule: "curriculum_order" };
}

// 단원 id 끝 번호 (L4-HALG-03 → 3)
export const trailingNumber = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0);
