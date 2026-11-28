// 파일럿 문항 선정: 과목·연도·난이도가 고르게 섞이도록 시드 고정으로 결정적으로 뽑는다(100~200문항).
export type PilotItem = { id: number; subject: string | null; year: number | null; difficulty: number | null };

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pilotSample(items: PilotItem[], n = 150, seed = 196): number[] {
  const size = Math.min(Math.max(n, 100), 200);
  const rnd = mulberry32(seed);
  const groups = new Map<string, number[]>();
  for (const it of [...items].sort((a, b) => a.id - b.id)) {
    const k = `${it.subject ?? "-"}|${it.year ?? "-"}|${it.difficulty ?? "-"}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(it.id);
  }
  const lists = [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, ids]) => {
    const a = [...ids];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  });
  const out: number[] = [];
  for (let round = 0; out.length < size; round++) {
    let any = false;
    for (const l of lists) {
      if (round < l.length && out.length < size) {
        out.push(l[round]);
        any = true;
      }
    }
    if (!any) break;
  }
  return out.sort((a, b) => a - b);
}

// 처리 순서: (과목, id) — 같은 후보 집합끼리 묶여 프롬프트 접두부 캐시가 잘 맞는다
export function processingOrder<T extends { id: number; subject: string | null }>(items: T[]): number[] {
  return [...items].sort((a, b) => ((a.subject ?? "") < (b.subject ?? "") ? -1 : (a.subject ?? "") > (b.subject ?? "") ? 1 : a.id - b.id)).map((x) => x.id);
}
