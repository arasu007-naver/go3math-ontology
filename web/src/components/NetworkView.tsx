"use client";

import type { Core } from "cytoscape";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";

// level-spec.md 의 Level 1~5 그물. 영역(L1)마다 다른 색, level 별로 펼치기·접기, 선수 관계는 화살표.
type LNode = {
  id: string;
  level: number;
  name: string;
  order: number;
  category: string | null;
  grade: number | null;
  school: string | null;
  kind: string | null;
  areas: string[];
  mapCount: number;
};
type LEdge = { src: string; dst: string; type: "HAS_CHILD" | "PREREQUISITE_OF" };

// 영역 색: 수학 영역 여섯은 검증된 범주 팔레트(어두운 배경용) 순서대로, 수학 학습(메타)은 중립 회색
const AREA_COLOR: Record<string, string> = {
  "L1-STUDY": "#9ca3af",
  "L1-NUM": "#3987e5",
  "L1-EXPR": "#d95926",
  "L1-EQ": "#199e70",
  "L1-FUNC": "#c98500",
  "L1-PROB": "#d55181",
  "L1-GEO": "#008300",
};
const LEVEL_NAME = ["", "영역", "PREREQUISITE(중학)", "중등 대단원·고등 과목", "고등 대단원·중등 소단원", "고등 소단원"];
const CATEGORY_RANK: Record<string, number> = { 소단원: 1, 대단원: 2, 과목: 3 }; // 선수는 같거나 상위 category 로만
const KIND_NAME: Record<string, string> = {
  concept: "개념", theorem: "정리", property: "성질", formula: "공식", definition: "정의", strategy: "전략", method: "방법", info: "정보",
};
const COL_W = 250;
const ROW_H = 30;

const input =
  "w-full bg-[#121824] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-orange-500";
const btn = "px-3 py-1.5 text-[11px] font-bold rounded-lg text-white disabled:opacity-40";

// 노드마다 영역(색)과 대표 상위(배치용)를 정한다. 영역 = 첫 소속 L1, 소속이 없으면 상위의 영역. 대표 상위 = 같은 영역의 상위.
function resolve(nodes: LNode[], edges: LEdge[]) {
  const parents = new Map<string, string[]>();
  for (const e of edges) if (e.type === "HAS_CHILD") parents.set(e.dst, [...(parents.get(e.dst) ?? []), e.src]);
  const l1Order = new Map(nodes.filter((n) => n.level === 1).map((n) => [n.id, n.order]));
  const area = new Map<string, string>();
  const primary = new Map<string, string>();
  for (const n of [...nodes].sort((a, b) => a.level - b.level)) {
    const ps = parents.get(n.id) ?? [];
    const a =
      n.level === 1
        ? n.id
        : (n.areas[0] ??
          ps.map((p) => area.get(p)).filter((x): x is string => !!x).sort((x, y) => (l1Order.get(x) ?? 99) - (l1Order.get(y) ?? 99))[0]);
    if (a) area.set(n.id, a);
    const p = ps.find((x) => area.get(x) === a) ?? ps[0];
    if (p) primary.set(n.id, p);
  }
  return { parents, area, primary };
}

// 왼쪽→오른쪽 나무 배치: 열 = level, 잎은 한 줄씩 아래로, 상위는 자식들의 가운데
function treePositions(nodes: LNode[], primary: Map<string, string>) {
  const kids = new Map<string, LNode[]>();
  const roots: LNode[] = [];
  for (const n of nodes) {
    const p = primary.get(n.id);
    if (p && nodes.some((x) => x.id === p)) kids.set(p, [...(kids.get(p) ?? []), n]);
    else roots.push(n);
  }
  const pos: Record<string, { x: number; y: number }> = {};
  let row = 0;
  const place = (n: LNode): number => {
    const ys = (kids.get(n.id) ?? []).map(place);
    const y = ys.length ? (ys[0] + ys[ys.length - 1]) / 2 : row++;
    pos[n.id] = { x: (n.level - 1) * COL_W, y: y * ROW_H };
    return y;
  };
  for (const r of roots.sort((a, b) => a.level - b.level || a.order - b.order)) {
    place(r);
    row += 1; // 영역 사이 여백
  }
  return pos;
}

export default function NetworkView() {
  const box = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const [data, setData] = useState<{ nodes: LNode[]; edges: LEdge[] } | null>(null);
  const [maxLevel, setMaxLevel] = useState(3);
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    const res = await api("/api/graph/levels");
    setData(await res.json());
  }, []);

  useEffect(() => {
    let cancelled = false;
    api("/api/graph/levels")
      .then((r) => r.json())
      .then((d) => !cancelled && setData(d));
    return () => {
      cancelled = true;
    };
  }, []);

  const info = useMemo(() => (data ? resolve(data.nodes, data.edges) : null), [data]);

  // 그물 그리기 (보이는 level 이 바뀌면 다시 배치)
  useEffect(() => {
    if (!data || !info || !box.current) return;
    let destroyed = false;
    import("cytoscape").then(({ default: cytoscape }) => {
      if (destroyed || !box.current) return;
      cy.current?.destroy();
      const nodes = data.nodes.filter((n) => n.level <= maxLevel);
      const shown = new Set(nodes.map((n) => n.id));
      const edges = data.edges.filter((e) => shown.has(e.src) && shown.has(e.dst));
      cy.current = cytoscape({
        container: box.current,
        elements: [
          ...nodes.map((n) => ({
            data: {
              id: n.id,
              label: (n.grade ? `${n.name} · 중${n.grade}` : n.name) + (n.mapCount ? ` (${n.mapCount})` : ""),
              level: n.level,
              category: n.category ?? "",
              color: AREA_COLOR[info.area.get(n.id) ?? ""] ?? "#6b7280",
            },
          })),
          ...edges.map((e) => ({
            data: {
              id: `${e.type}|${e.src}|${e.dst}`,
              source: e.src,
              target: e.dst,
              kind: e.type === "PREREQUISITE_OF" ? "prereq" : info.primary.get(e.dst) === e.src ? "tree" : "extra",
            },
          })),
        ],
        style: [
          {
            selector: "node",
            style: {
              label: "data(label)",
              "background-color": "data(color)",
              color: "#e5e7eb",
              "font-size": 11,
              "text-valign": "center",
              "text-halign": "right",
              "text-margin-x": 6,
              width: 12,
              height: 12,
            },
          },
          {
            selector: "node[level <= 2]",
            style: {
              shape: "round-rectangle",
              width: 130,
              height: 24,
              "text-halign": "center",
              color: "#ffffff",
              "font-weight": "bold",
              "font-size": 12,
              "text-margin-x": 0,
            },
          },
          { selector: "node[level = 2]", style: { width: 110, height: 20, "font-size": 10, "background-opacity": 0.55 } },
          { selector: 'node[category = "과목"]', style: { width: 16, height: 16, "font-weight": "bold", "font-size": 12 } },
          { selector: 'node[category = "소단원"]', style: { width: 8, height: 8, "font-size": 10 } },
          { selector: "node:selected", style: { "border-width": 3, "border-color": "#fde68a" } },
          { selector: 'edge[kind = "tree"]', style: { width: 1, "line-color": "#4b5563", "curve-style": "taxi", "taxi-direction": "horizontal" } },
          {
            selector: 'edge[kind = "extra"]',
            style: { width: 1, "line-color": "#4b5563", "line-style": "dashed", "curve-style": "bezier", opacity: 0.35 },
          },
          {
            selector: 'edge[kind = "prereq"]',
            style: {
              width: 1.5,
              "line-color": "#e5e7eb",
              "target-arrow-color": "#e5e7eb",
              "target-arrow-shape": "triangle",
              "arrow-scale": 0.8,
              "curve-style": "unbundled-bezier",
              "control-point-distances": [60],
              opacity: 0.35,
            },
          },
          { selector: "edge.hl", style: { width: 2.5, opacity: 1, "line-color": "#fde68a", "target-arrow-color": "#fde68a", "z-index": 10 } },
        ],
        layout: { name: "preset", positions: treePositions(nodes, info.primary), padding: 30, animate: false },
      });
      cy.current.on("tap", "node", (ev) => setSelected(ev.target.id()));
      cy.current.on("tap", (ev) => ev.target === cy.current && setSelected(null));
    });
    return () => {
      destroyed = true;
    };
  }, [data, info, maxLevel]);

  // 선택한 노드의 선수 화살표만 밝게
  useEffect(() => {
    const c = cy.current;
    if (!c) return;
    c.edges().removeClass("hl");
    if (selected) c.$id(selected).connectedEdges('[kind = "prereq"]').addClass("hl");
  }, [selected, data, maxLevel]);

  useEffect(() => () => cy.current?.destroy(), []);

  const setPrereq = async (src: string, dst: string, on: boolean) => {
    const res = await api("/api/graph/levels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ src, dst, on }) });
    const d = await res.json();
    if (!res.ok) return setMsg({ text: d.error, error: true });
    setMsg({ text: on ? "선수 관계를 추가했습니다." : "선수 관계를 지웠습니다." });
    await load();
  };

  const byId = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);
  const node = selected ? byId.get(selected) ?? null : null;
  const areas = (data?.nodes ?? []).filter((n) => n.level === 1);

  return (
    <main className="flex-1 flex overflow-hidden p-4 gap-4">
      <section className="flex-1 glass rounded-2xl overflow-hidden flex flex-col">
        <div className="px-4 py-2 border-b border-white/5 bg-white/5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400 shrink-0">
          <span className="font-bold text-gray-300 text-xs">Level 그물</span>
          {areas.map((a) => (
            <span key={a.id} className="flex items-center gap-1">
              <i className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: AREA_COLOR[a.id] }} /> {a.name}
            </span>
          ))}
          <span className="text-gray-200">━▶ 선수</span>
          <span>┄ 다른 영역 소속</span>
          <span>(n) = 대응된 TOC·문단 수</span>
          <span className="ml-auto flex items-center gap-1">
            펼치기
            {[1, 2, 3, 4, 5].map((l) => (
              <button
                key={l}
                onClick={() => setMaxLevel(l)}
                className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold ${
                  maxLevel === l ? "border-orange-500 bg-orange-500/20 text-orange-400" : "border-white/10 text-gray-400 hover:text-white"
                }`}
                title={`Level ${l}(${LEVEL_NAME[l]})까지 보기`}
              >
                L{l}
              </button>
            ))}
          </span>
        </div>
        <div ref={box} className="flex-1 bg-[#0d1117]" />
        {data && data.nodes.length === 0 && (
          <div className="p-4 text-center text-xs text-gray-400 space-y-2">
            <p>그래프에 level 노드가 없습니다.</p>
            <p>
              서버에서 <code className="text-orange-300">npm run db:setup</code> 으로 Level 1·2 시드를 넣으세요.
            </p>
          </div>
        )}
      </section>

      <aside className="w-[380px] shrink-0 glass rounded-2xl overflow-y-auto p-4 space-y-4">
        {msg && <p className={`text-xs font-semibold ${msg.error ? "text-red-400" : "text-emerald-400"}`}>{msg.text}</p>}
        {node && data && info ? (
          <NodePanel key={node.id} node={node} data={data} info={info} byId={byId} setPrereq={setPrereq} />
        ) : (
          <p className="text-xs text-gray-500">노드를 누르면 내용과 선수 관계를 볼 수 있습니다.</p>
        )}
      </aside>
    </main>
  );
}

function NodePanel({
  node,
  data,
  info,
  byId,
  setPrereq,
}: {
  node: LNode;
  data: { nodes: LNode[]; edges: LEdge[] };
  info: ReturnType<typeof resolve>;
  byId: Map<string, LNode>;
  setPrereq: (src: string, dst: string, on: boolean) => Promise<void>;
}) {
  const [pick, setPick] = useState("");
  // 같은 이름이 여러 곳에 있으므로 중등 대단원은 학년, L4·L5 는 상위 이름을 붙인다
  const label = (id: string) => {
    const n = byId.get(id);
    if (!n) return id;
    if (n.grade) return `중${n.grade} · ${n.name}`;
    if (n.level < 4) return n.name;
    return `${byId.get(info.primary.get(id) ?? "")?.name ?? "?"} · ${n.name}`;
  };
  const prereqs = data.edges.filter((e) => e.type === "PREREQUISITE_OF" && e.dst === node.id).map((e) => e.src);
  const nexts = data.edges.filter((e) => e.type === "PREREQUISITE_OF" && e.src === node.id).map((e) => e.dst);
  const children = data.edges.filter((e) => e.type === "HAS_CHILD" && e.src === node.id).length;
  const fixed = node.level <= 2 || node.id.startsWith("L3-STUDY-");
  // 선수가 될 수 있는 노드: L3~L5 중 category 가 이 노드와 같거나 낮은 것
  const rank = (n: LNode) => CATEGORY_RANK[n.category ?? ""] ?? 0;
  const candidates =
    node.level >= 3 ? data.nodes.filter((n) => n.level >= 3 && rank(n) <= rank(node) && n.id !== node.id && !prereqs.includes(n.id)) : [];
  const area = byId.get(info.area.get(node.id) ?? "");

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-bold" style={{ color: AREA_COLOR[area?.id ?? ""] }}>
          {node.name}
        </h3>
        <p className="text-[11px] text-gray-400">
          Level {node.level} {node.category ?? LEVEL_NAME[node.level]}
          {node.grade && ` · 중${node.grade}`}
          {node.school === "high" && " · 고등"}
          {node.kind && ` · ${KIND_NAME[node.kind] ?? node.kind}`}
          {fixed && " · 고정 노드"}
        </p>
        <p className="text-[10px] text-gray-500 font-mono">{node.id}</p>
      </div>
      <dl className="text-[11px] grid grid-cols-[64px_1fr] gap-y-1 text-gray-300">
        <dt className="text-gray-500">영역</dt>
        <dd>{(node.areas.length ? node.areas : area ? [area.id] : []).map((a) => byId.get(a)?.name ?? a).join(", ") || "-"}</dd>
        <dt className="text-gray-500">상위</dt>
        <dd>{(info.parents.get(node.id) ?? []).map(label).join(", ") || "-"}</dd>
        <dt className="text-gray-500">하위</dt>
        <dd>{children}개</dd>
        <dt className="text-gray-500">대응</dt>
        <dd>TOC·문단 {node.mapCount}개</dd>
      </dl>

      {node.level >= 3 && (
        <div className="space-y-1.5">
          <span className="text-[10px] font-bold text-gray-400">선수 ({prereqs.length}) → {node.name}</span>
          <div className="flex flex-wrap gap-1.5">
            {prereqs.map((p) => (
              <span key={p} className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-white/15 bg-white/5 text-[11px] text-gray-200">
                {label(p)}
                <button onClick={() => setPrereq(p, node.id, false)} aria-label="선수 관계 지우기">
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <select className={input} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">선수 추가</option>
              {["과목", "대단원", "소단원"].map((cat) => {
                const xs = candidates.filter((n) => n.category === cat);
                return xs.length ? (
                  <optgroup key={cat} label={cat}>
                    {xs.map((n) => (
                      <option key={n.id} value={n.id}>
                        {label(n.id)}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </select>
            <button
              className={`${btn} bg-emerald-600 hover:bg-emerald-700 shrink-0`}
              disabled={!pick}
              onClick={() => setPrereq(pick, node.id, true).then(() => setPick(""))}
            >
              추가
            </button>
          </div>
          <span className="block text-[10px] font-bold text-gray-400 pt-1">후속 ({nexts.length}) ← {node.name}</span>
          <p className="text-[11px] text-gray-300">{nexts.map(label).join(", ") || "-"}</p>
        </div>
      )}
    </div>
  );
}
