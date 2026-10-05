"use client";

import type { Core } from "cytoscape";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type NNode = { id: string; type: "category" | "curriculum"; name: string; level?: string; order: number; mapCount: number };
type NEdge = { src: string; dst: string; type: "CATEGORY_HAS" | "PREREQ_OF" };

const LEVELS = ["메타", "중등", "대입"];
const LEVEL_COLOR: Record<string, string> = { 메타: "#6b7280", 중등: "#3b82f6", 대입: "#10b981" };

const input =
  "w-full bg-[#121824] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-orange-500";
const btn = "px-3 py-1.5 text-[11px] font-bold rounded-lg text-white disabled:opacity-40";

// 선수 그물 배치: 행 = 가장 긴 선수 사슬의 깊이(선수가 항상 위), 같은 행은 가로로 고르게
function prereqPositions(nodes: NNode[], edges: NEdge[]) {
  const preds = new Map<string, string[]>();
  for (const e of edges) if (e.type === "PREREQ_OF") preds.set(e.dst, [...(preds.get(e.dst) ?? []), e.src]);
  const depth = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0; // 순환은 서버가 막지만 그래도 멈추게
    seen.add(id);
    const d = Math.max(-1, ...(preds.get(id) ?? []).map((p) => visit(p, seen))) + 1;
    depth.set(id, d);
    return d;
  };
  const rows = new Map<number, string[]>();
  for (const n of nodes) {
    const d = visit(n.id, new Set());
    rows.set(d, [...(rows.get(d) ?? []), n.id]);
  }
  const pos: Record<string, { x: number; y: number }> = {};
  for (const [d, ids] of rows) ids.forEach((id, i) => (pos[id] = { x: (i - (ids.length - 1) / 2) * 200, y: d * 110 }));
  return pos;
}

export default function NetworkView() {
  const box = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const [data, setData] = useState<{ nodes: NNode[]; edges: NEdge[] } | null>(null);
  const [showCategoryEdges, setShowCategoryEdges] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    const res = await api("/api/graph/network");
    setData(await res.json());
  }, []);

  useEffect(() => {
    let cancelled = false;
    api("/api/graph/network")
      .then((r) => r.json())
      .then((d) => !cancelled && setData(d));
    return () => {
      cancelled = true;
    };
  }, []);

  // 그물 그리기
  useEffect(() => {
    if (!data || !box.current) return;
    let destroyed = false;
    import("cytoscape").then(({ default: cytoscape }) => {
      if (destroyed || !box.current) return;
      cy.current?.destroy();
      // 선수 그물만 볼 때는 과목(메타 제외)만 위→아래로, 카테고리까지 볼 때는 카테고리를 바깥 원에 둔다
      const edges = data.edges.filter((e) => showCategoryEdges || e.type === "PREREQ_OF");
      const nodes = data.nodes.filter((n) => showCategoryEdges || (n.type === "curriculum" && n.level !== "메타"));
      cy.current = cytoscape({
        container: box.current,
        elements: [
          ...nodes.map((n) => ({
            data: {
              id: n.id,
              label: n.mapCount ? `${n.name} (${n.mapCount})` : n.name,
              kind: n.type,
              color: n.type === "category" ? "#f97316" : LEVEL_COLOR[n.level || ""] || "#6b7280",
            },
          })),
          ...edges.map((e) => ({ data: { id: `${e.type}|${e.src}|${e.dst}`, source: e.src, target: e.dst, kind: e.type } })),
        ],
        style: [
          {
            selector: "node",
            style: {
              label: "data(label)",
              "background-color": "data(color)",
              color: "#e5e7eb",
              "font-size": 11,
              "text-valign": "bottom",
              "text-margin-y": 4,
              width: 22,
              height: 22,
            },
          },
          { selector: 'node[kind = "category"]', style: { shape: "round-rectangle", width: 34, height: 22, "font-weight": "bold", "font-size": 12 } },
          { selector: "node:selected", style: { "border-width": 3, "border-color": "#fde68a" } },
          {
            selector: 'edge[kind = "CATEGORY_HAS"]',
            style: { width: 1, "line-color": "#4b5563", "line-style": "dashed", "curve-style": "bezier", opacity: 0.6 },
          },
          {
            selector: 'edge[kind = "PREREQ_OF"]',
            style: { width: 2.5, "line-color": "#34d399", "target-arrow-color": "#34d399", "target-arrow-shape": "triangle", "curve-style": "bezier" },
          },
        ],
        layout: showCategoryEdges
          ? {
              name: "concentric",
              concentric: (n) => (n.data("kind") === "category" ? 1 : 2),
              levelWidth: () => 1,
              minNodeSpacing: 40,
              padding: 30,
              animate: false,
            }
          : { name: "preset", positions: prereqPositions(nodes, edges), padding: 30, animate: false },
      });
      cy.current.on("tap", "node", (ev) => setSelected(ev.target.id()));
      cy.current.on("tap", (ev) => ev.target === cy.current && setSelected(null));
    });
    return () => {
      destroyed = true;
    };
  }, [data, showCategoryEdges]);

  useEffect(() => () => cy.current?.destroy(), []);

  const post = async (body: object, ok: string) => {
    const res = await api("/api/graph/network", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) return setMsg({ text: d.error, error: true });
    setMsg({ text: ok });
    await load();
    return d;
  };

  const categories = data?.nodes.filter((n) => n.type === "category") ?? [];
  const subjects = data?.nodes.filter((n) => n.type === "curriculum") ?? [];
  const node = data?.nodes.find((n) => n.id === selected) ?? null;

  return (
    <main className="flex-1 flex overflow-hidden p-4 gap-4">
      <section className="flex-1 glass rounded-2xl overflow-hidden flex flex-col">
        <div className="px-4 py-2 border-b border-white/5 bg-white/5 flex items-center gap-4 text-[11px] text-gray-400 shrink-0">
          <span className="font-bold text-gray-300 text-xs">네트워크</span>
          <span className="flex items-center gap-1"><i className="w-3 h-2 rounded-sm inline-block bg-orange-500" /> 최상위 카테고리</span>
          {LEVELS.map((l) => (
            <span key={l} className="flex items-center gap-1">
              <i className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: LEVEL_COLOR[l] }} /> {l}
            </span>
          ))}
          <span className="text-emerald-400">━▶ 선수</span>
          <span>┄ 카테고리 소속</span>
          <span>(n) = 대응된 TOC 항목 수</span>
          <label className="ml-auto flex items-center gap-1">
            <input type="checkbox" checked={showCategoryEdges} onChange={(e) => setShowCategoryEdges(e.target.checked)} className="accent-orange-500" />
            카테고리 소속 보기
          </label>
        </div>
        <div ref={box} className="flex-1 bg-[#0d1117]" />
        {data && data.nodes.length === 0 && (
          <div className="p-4 text-center text-xs text-gray-400 space-y-2">
            <p>그래프에 카테고리·과목 노드가 없습니다.</p>
            <p>서버에서 <code className="text-orange-300">npm run db:setup</code> 으로 7개 카테고리와 과목 초기값을 넣으세요.</p>
          </div>
        )}
      </section>

      <aside className="w-[380px] shrink-0 glass rounded-2xl overflow-y-auto p-4 space-y-4">
        {msg && <p className={`text-xs font-semibold ${msg.error ? "text-red-400" : "text-emerald-400"}`}>{msg.text}</p>}
        {node?.type === "curriculum" ? (
          <SubjectEditor
            key={node.id}
            node={node}
            categories={categories}
            subjects={subjects}
            edges={data?.edges ?? []}
            post={post}
            onDeleted={() => setSelected(null)}
          />
        ) : node?.type === "category" ? (
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-orange-400">{node.name}</h3>
            <p className="text-[11px] text-gray-400">최상위 카테고리. 소속 과목:</p>
            <ul className="text-xs text-gray-300 list-disc pl-5">
              {data?.edges
                .filter((e) => e.type === "CATEGORY_HAS" && e.src === node.id)
                .map((e) => <li key={e.dst}>{subjects.find((s) => s.id === e.dst)?.name ?? e.dst}</li>)}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-gray-500">노드를 누르면 편집할 수 있습니다.</p>
        )}
        <hr className="border-white/10" />
        <SubjectEditor key="new" node={null} categories={categories} subjects={subjects} edges={data?.edges ?? []} post={post} onDeleted={() => {}} />
      </aside>
    </main>
  );
}

function SubjectEditor({
  node,
  categories,
  subjects,
  edges,
  post,
  onDeleted,
}: {
  node: NNode | null;
  categories: NNode[];
  subjects: NNode[];
  edges: NEdge[];
  post: (body: object, ok: string) => Promise<unknown>;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(node?.name ?? "");
  const [level, setLevel] = useState(node?.level ?? "대입");
  const [cats, setCats] = useState<string[]>(() =>
    node ? edges.filter((e) => e.type === "CATEGORY_HAS" && e.dst === node.id).map((e) => e.src) : []
  );
  const [prereqTarget, setPrereqTarget] = useState("");
  const prereqs = node ? edges.filter((e) => e.type === "PREREQ_OF" && e.dst === node.id).map((e) => e.src) : [];
  const nameOf = (id: string) => subjects.find((s) => s.id === id)?.name ?? id;

  const save = async () => {
    const r = await post({ action: "saveCurriculum", id: node?.id, name, level, categoryIds: cats }, node ? "과목을 저장했습니다." : "과목을 추가했습니다.");
    if (r && !node) {
      setName("");
      setCats([]);
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-bold text-gray-200">{node ? "과목 편집" : "과목 추가"}</h3>
      <input className={input} placeholder="과목·교육과정 노드 이름" value={name} onChange={(e) => setName(e.target.value)} />
      <select className={input} value={level} onChange={(e) => setLevel(e.target.value)}>
        {LEVELS.map((l) => (
          <option key={l}>{l}</option>
        ))}
      </select>
      <div className="flex flex-wrap gap-1.5">
        {categories.map((c) => (
          <label key={c.id} className="flex items-center gap-1 text-[11px] text-gray-300">
            <input
              type="checkbox"
              className="accent-orange-500"
              checked={cats.includes(c.id)}
              onChange={(e) => setCats((xs) => (e.target.checked ? [...xs, c.id] : xs.filter((x) => x !== c.id)))}
            />
            {c.name}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <button className={`${btn} bg-orange-600 hover:bg-orange-700`} disabled={!name.trim()} onClick={save}>
          저장
        </button>
        {node && (
          <button
            className={`${btn} bg-red-600/80 hover:bg-red-700`}
            onClick={async () => {
              if (!confirm(`'${node.name}' 노드와 연결을 삭제할까요?`)) return;
              if (await post({ action: "deleteCurriculum", id: node.id }, "삭제했습니다.")) onDeleted();
            }}
          >
            삭제
          </button>
        )}
      </div>
      {node && (
        <div className="space-y-1.5 pt-2">
          <span className="text-[10px] font-bold text-gray-400">선수과목 (→ {node.name})</span>
          <div className="flex flex-wrap gap-1.5">
            {prereqs.map((p) => (
              <span key={p} className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-[11px] text-emerald-300">
                {nameOf(p)}
                <button onClick={() => post({ action: "prereq", src: p, dst: node.id, on: false }, "선수 관계를 지웠습니다.")}>×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <select className={input} value={prereqTarget} onChange={(e) => setPrereqTarget(e.target.value)}>
              <option value="">선수과목 선택</option>
              {subjects
                .filter((s) => s.id !== node.id && !prereqs.includes(s.id))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.level})
                  </option>
                ))}
            </select>
            <button
              className={`${btn} bg-emerald-600 hover:bg-emerald-700 shrink-0`}
              disabled={!prereqTarget}
              onClick={() => post({ action: "prereq", src: prereqTarget, dst: node.id, on: true }, "선수 관계를 추가했습니다.").then(() => setPrereqTarget(""))}
            >
              추가
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
