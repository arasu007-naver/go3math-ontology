// 단원 내 개념 선후관계: 두 모델 답 비교·순환 검사. 순수 함수.

export type Edge = [number, number]; // [먼저 배우는 개념, 나중에 배우는 개념]
export type Verdict = "ab" | "ba" | "none"; // 쌍 (a < b) 에 대해 a→b, b→a, 관계 없음
export type Dispute = { a: number; b: number; gemini: Verdict; claude: Verdict };

// 모델 응답 {"edges":[{"before":n,"after":m}]} → Edge[]. 목록에 없는 번호·자기 자신은 버린다. JSON 이 깨졌으면 null.
export function parseEdges(text: string, ids: number[]): Edge[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
  const list = (data as { edges?: unknown })?.edges;
  if (!Array.isArray(list)) return null;
  const known = new Set(ids);
  return list
    .map((e): Edge => [Number(e?.before), Number(e?.after)])
    .filter(([x, y]) => x !== y && known.has(x) && known.has(y));
}

// 쌍별 판정. 한 모델이 양방향을 모두 냈으면 관계 없음으로 본다.
function verdicts(edges: Edge[]): Map<string, Verdict> {
  const m = new Map<string, Verdict>();
  for (const [x, y] of edges) {
    const key = x < y ? `${x},${y}` : `${y},${x}`;
    const v: Verdict = x < y ? "ab" : "ba";
    m.set(key, m.has(key) && m.get(key) !== v ? "none" : v);
  }
  return m;
}

// 두 모델이 같은 방향이면 확정(agreed), 다르면 분쟁(disputes). 둘 다 관계 없음인 쌍은 어디에도 넣지 않는다.
export function compareEdges(gemini: Edge[], claude: Edge[]): { agreed: Edge[]; disputes: Dispute[] } {
  const g = verdicts(gemini);
  const c = verdicts(claude);
  const agreed: Edge[] = [];
  const disputes: Dispute[] = [];
  for (const key of new Set([...g.keys(), ...c.keys()])) {
    const [a, b] = key.split(",").map(Number);
    const gv = g.get(key) ?? "none";
    const cv = c.get(key) ?? "none";
    if (gv !== cv) disputes.push({ a, b, gemini: gv, claude: cv });
    else if (gv !== "none") agreed.push(toEdge(a, b, gv)!);
  }
  return { agreed, disputes };
}

export function toEdge(a: number, b: number, v: Verdict): Edge | null {
  return v === "ab" ? [a, b] : v === "ba" ? [b, a] : null;
}

// 앞에서부터 넣되 순환을 만드는 관계는 뺀다.
export function dropCycles(edges: Edge[]): { kept: Edge[]; dropped: Edge[] } {
  const next = new Map<number, number[]>();
  const reaches = (from: number, to: number, seen = new Set<number>()): boolean => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (next.get(from) ?? []).some((n) => reaches(n, to, seen));
  };
  const kept: Edge[] = [];
  const dropped: Edge[] = [];
  for (const e of edges) {
    if (reaches(e[1], e[0])) dropped.push(e);
    else {
      kept.push(e);
      next.set(e[0], [...(next.get(e[0]) ?? []), e[1]]);
    }
  }
  return { kept, dropped };
}
