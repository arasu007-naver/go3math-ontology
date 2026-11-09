import type { LayoutOptions, StylesheetStyle } from "cytoscape";
import type { GraphEdgeDTO, GraphNodeDTO } from "@/lib/server/kgGraphQueries";

export type ViewMode = "tree" | "force" | "prereq" | "ego";

export const AREA_COLOR: Record<string, string> = {
  "L1-STUDY": "#9ca3af",
  "L1-NUM": "#3987e5",
  "L1-EXPR": "#d95926",
  "L1-EQ": "#199e70",
  "L1-FUNC": "#c98500",
  "L1-PROB": "#d55181",
  "L1-GEO": "#008300",
};

export const AREA_NAMES: Record<string, string> = {
  "L1-STUDY": "수학 학습",
  "L1-NUM": "수와 연산",
  "L1-EXPR": "식과 계산",
  "L1-EQ": "방정식과 부등식",
  "L1-FUNC": "함수",
  "L1-PROB": "경우의 수·확률·통계",
  "L1-GEO": "도형",
};

export const LEVEL_NAME = [
  "",
  "영역",
  "PREREQUISITE",
  "중등·수학 학습 대단원, 고등 과목",
  "고등 대단원, 중등 소단원, TOC",
  "고등 소단원, TOC",
  "TOC",
  "TOC",
  "TOC",
  "TOC",
];

const COL_W = 260;
const ROW_H = 30;

export function resolveHierarchy(nodes: GraphNodeDTO[], edges: GraphEdgeDTO[]) {
  const parents = new Map<string, string[]>();
  for (const e of edges) {
    if (e.edgeType === "HAS_CHILD") {
      parents.set(e.dst, [...(parents.get(e.dst) ?? []), e.src]);
    }
  }

  const l1Order = new Map(
    nodes
      .filter((n) => n.nodeType === "level" && n.level === 1)
      .map((n) => [n.id, n.order ?? 99])
  );

  const area = new Map<string, string>();
  const primary = new Map<string, string>();

  const levelNodes = nodes
    .filter((n) => n.nodeType === "level" || n.nodeType === "level_toc")
    .sort((a, b) => (a.level ?? 9) - (b.level ?? 9));

  for (const n of levelNodes) {
    const ps = parents.get(n.id) ?? [];
    const a =
      n.level === 1
        ? n.id
        : (n.areas?.[0] ??
          ps
            .map((p) => area.get(p))
            .filter((x): x is string => !!x)
            .sort((x, y) => (l1Order.get(x) ?? 99) - (l1Order.get(y) ?? 99))[0]);
    if (a) area.set(n.id, a);
    const p = ps.find((x) => area.get(x) === a) ?? ps[0];
    if (p) primary.set(n.id, p);
  }

  // 비-level 노드(concept, book, toc, page, paragraph, achievement)의 소속 상위 및 영역 추론
  for (const e of edges) {
    if (e.edgeType === "CONCEPT_IN_UNIT") {
      // src = concept:{id}, dst = unit_id
      if (e.isPrimary || !primary.has(e.src)) {
        primary.set(e.src, e.dst);
        const a = area.get(e.dst);
        if (a) area.set(e.src, a);
      }
    } else if (e.edgeType === "MAPS_TO") {
      // src = book/toc/para, dst = unit_id
      if (!primary.has(e.src)) {
        primary.set(e.src, e.dst);
        const a = area.get(e.dst);
        if (a) area.set(e.src, a);
      }
    } else if (e.edgeType === "HAS_ACHIEVEMENT") {
      // src = concept, dst = ach
      if (!primary.has(e.dst)) {
        primary.set(e.dst, e.src);
        const a = area.get(e.src);
        if (a) area.set(e.dst, a);
      }
    } else if (e.edgeType === "HAS_TOC" || e.edgeType === "POINTS_TO" || e.edgeType === "HAS_PARAGRAPH") {
      if (!primary.has(e.dst)) {
        primary.set(e.dst, e.src);
        const a = area.get(e.src);
        if (a) area.set(e.dst, a);
      }
    }
  }

  for (const n of nodes) {
    if (n.nodeType === "concept" && n.unitId && !primary.has(n.id)) {
      primary.set(n.id, n.unitId);
      const a = area.get(n.unitId);
      if (a) area.set(n.id, a);
    }
  }

  return { parents, area, primary };
}

// 1. tree — 계층형 분류 트리 배치 (단원 + 우측에 개념/도서/문단 클러스터)
export function treePositions(
  nodes: GraphNodeDTO[],
  primary: Map<string, string>
): Record<string, { x: number; y: number }> {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string, GraphNodeDTO[]>();
  const roots: GraphNodeDTO[] = [];

  for (const n of nodes) {
    const p = primary.get(n.id);
    if (p && nodeMap.has(p) && p !== n.id) {
      kids.set(p, [...(kids.get(p) ?? []), n]);
    } else {
      roots.push(n);
    }
  }

  const pos: Record<string, { x: number; y: number }> = {};
  let row = 0;
  const visited = new Set<string>();

  const colOf = (n: GraphNodeDTO, depth: number): number => {
    if (n.level != null) return (n.level - 1) * COL_W;
    const p = primary.get(n.id);
    const pNode = p ? nodeMap.get(p) : undefined;
    if (pNode?.level != null) return pNode.level * COL_W + 40;
    return depth * COL_W;
  };

  const place = (n: GraphNodeDTO, depth: number): number => {
    if (visited.has(n.id)) return row;
    visited.add(n.id);
    const children = (kids.get(n.id) ?? []).sort(
      (a, b) =>
        (a.nodeType === b.nodeType ? 0 : a.nodeType === "level" ? -1 : 1) ||
        (a.order ?? 999) - (b.order ?? 999) ||
        a.id.localeCompare(b.id)
    );
    const ys = children.map((c) => place(c, depth + 1));
    const y = ys.length ? (ys[0] + ys[ys.length - 1]) / 2 : row++;
    pos[n.id] = { x: colOf(n, depth), y: y * ROW_H };
    return y;
  };

  const sortedRoots = [...roots].sort(
    (a, b) => (a.level ?? 99) - (b.level ?? 99) || (a.order ?? 999) - (b.order ?? 999) || a.id.localeCompare(b.id)
  );
  for (const r of sortedRoots) {
    place(r, 0);
    row += 1;
  }

  return pos;
}

// 3. prereq — 선수 학습 경로 위상 정렬 DAG 배치 (Longest-path Layering)
export function prereqDagPositions(
  nodes: GraphNodeDTO[],
  edges: GraphEdgeDTO[],
  areaMap: Map<string, string>
): Record<string, { x: number; y: number }> {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const prereqEdges = edges.filter(
    (e) =>
      (e.edgeType === "PREREQUISITE_OF" || e.edgeType === "CONCEPT_PREREQ_OF" || e.edgeType === "CONCEPT_IN_UNIT") &&
      nodeIds.has(e.src) &&
      nodeIds.has(e.dst)
  );

  const outAdj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const n of nodes) {
    outAdj.set(n.id, []);
    inDeg.set(n.id, 0);
  }
  for (const e of prereqEdges) {
    // CONCEPT_IN_UNIT 은 단원(dst) → 개념(src) 방향으로 오른쪽에 배치
    const u = e.edgeType === "CONCEPT_IN_UNIT" ? e.dst : e.src;
    const v = e.edgeType === "CONCEPT_IN_UNIT" ? e.src : e.dst;
    outAdj.get(u)?.push(v);
    inDeg.set(v, (inDeg.get(v) ?? 0) + 1);
  }

  const rank = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, d] of inDeg.entries()) {
    if (d === 0) {
      rank.set(id, 0);
      queue.push(id);
    }
  }

  while (queue.length > 0) {
    const u = queue.shift()!;
    const ru = rank.get(u) ?? 0;
    for (const v of outAdj.get(u) ?? []) {
      const nextRank = Math.min(12, Math.max(rank.get(v) ?? 0, ru + 1));
      rank.set(v, nextRank);
      const nd = (inDeg.get(v) ?? 1) - 1;
      inDeg.set(v, nd);
      if (nd === 0) queue.push(v);
    }
  }

  for (const n of nodes) {
    if (!rank.has(n.id)) rank.set(n.id, n.level ?? 0);
  }

  const byRank = new Map<number, GraphNodeDTO[]>();
  for (const n of nodes) {
    const r = rank.get(n.id) ?? 0;
    byRank.set(r, [...(byRank.get(r) ?? []), n]);
  }

  const pos: Record<string, { x: number; y: number }> = {};
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  for (const r of ranks) {
    const group = (byRank.get(r) ?? []).sort((a, b) => {
      const aa = areaMap.get(a.id) ?? "";
      const ab = areaMap.get(b.id) ?? "";
      if (aa !== ab) return aa.localeCompare(ab);
      return (a.level ?? 9) - (b.level ?? 9) || (a.order ?? 99) - (b.order ?? 99) || a.id.localeCompare(b.id);
    });
    const offset = -((group.length - 1) * 38) / 2;
    group.forEach((n, idx) => {
      pos[n.id] = { x: r * 230, y: offset + idx * 38 };
    });
  }

  return pos;
}

// 중심 노드 기준 BFS hop 거리 계산 (ego concentric 레이아웃용)
export function computeHops(
  focusId: string | null,
  nodes: GraphNodeDTO[],
  edges: GraphEdgeDTO[]
): Map<string, number> {
  const hops = new Map<string, number>();
  if (!focusId) return hops;

  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    adj.get(e.src)?.push(e.dst);
    adj.get(e.dst)?.push(e.src);
  }

  hops.set(focusId, 0);
  const q = [focusId];
  while (q.length > 0) {
    const cur = q.shift()!;
    const d = hops.get(cur)!;
    if (d >= 3) continue;
    for (const nb of adj.get(cur) ?? []) {
      if (!hops.has(nb)) {
        hops.set(nb, d + 1);
        q.push(nb);
      }
    }
  }
  return hops;
}

// 선수/후속 경로 추적 (Upstream ancestors / Downstream descendants)
export function computePrereqChain(
  focusId: string,
  edges: GraphEdgeDTO[]
): { upstreamNodes: Set<string>; downstreamNodes: Set<string>; chainEdges: Set<string> } {
  const prereqTypes = new Set(["PREREQUISITE_OF", "CONCEPT_PREREQ_OF", "CONCEPT_IN_UNIT", "APPLIES_TO"]);
  const relevant = edges.filter((e) => prereqTypes.has(e.edgeType));

  const upstreamNodes = new Set<string>();
  const downstreamNodes = new Set<string>();
  const chainEdges = new Set<string>();

  // Upstream (역방향: dst -> src)
  const qUp = [focusId];
  while (qUp.length > 0) {
    const cur = qUp.shift()!;
    for (const e of relevant) {
      if (e.dst === cur && !upstreamNodes.has(e.src) && e.src !== focusId) {
        upstreamNodes.add(e.src);
        chainEdges.add(e.id);
        qUp.push(e.src);
      } else if (e.dst === cur && (upstreamNodes.has(e.src) || e.src === focusId)) {
        chainEdges.add(e.id);
      }
    }
  }

  // Downstream (정방향: src -> dst)
  const qDown = [focusId];
  while (qDown.length > 0) {
    const cur = qDown.shift()!;
    for (const e of relevant) {
      if (e.src === cur && !downstreamNodes.has(e.dst) && e.dst !== focusId) {
        downstreamNodes.add(e.dst);
        chainEdges.add(e.id);
        qDown.push(e.dst);
      } else if (e.src === cur && (downstreamNodes.has(e.dst) || e.dst === focusId)) {
        chainEdges.add(e.id);
      }
    }
  }

  return { upstreamNodes, downstreamNodes, chainEdges };
}

export function buildLayoutOptions(
  mode: ViewMode,
  nodes: GraphNodeDTO[],
  edges: GraphEdgeDTO[],
  primary: Map<string, string>,
  areaMap: Map<string, string>,
  focusId: string | null,
  fit = true
): LayoutOptions {
  if (mode === "tree") {
    return {
      name: "preset",
      positions: treePositions(nodes, primary),
      padding: 36,
      animate: false,
      fit,
    };
  }
  if (mode === "prereq") {
    return {
      name: "preset",
      positions: prereqDagPositions(nodes, edges, areaMap),
      padding: 40,
      animate: true,
      animationDuration: 350,
      fit: true,
    };
  }
  if (mode === "ego") {
    return {
      name: "concentric",
      fit: true,
      padding: 50,
      minNodeSpacing: 36,
      animate: true,
      animationDuration: 350,
      concentric: (node: { id: () => string; data: (k: string) => unknown }) => {
        if (focusId && node.id() === focusId) return 4;
        const hop = Number(node.data("hop") ?? 3);
        if (hop === 1) return 3;
        if (hop === 2) return 2;
        return 1;
      },
      levelWidth: () => 1,
    } as unknown as LayoutOptions;
  }
  // mode === "force"
  return {
    name: "cose",
    animate: true,
    animationDuration: 450,
    nodeRepulsion: () => 8000,
    idealEdgeLength: (edge: { data: (k: string) => unknown }) =>
      edge.data("edgeType") === "HAS_CHILD" ? 80 : 140,
    edgeElasticity: () => 100,
    gravity: 0.25,
    numIter: 1000,
    padding: 40,
    fit: true,
  } as unknown as LayoutOptions;
}

export const GRAPH_STYLESHEET: StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      label: "data(displayLabel)",
      "background-color": "data(color)",
      color: "#e5e7eb",
      "font-size": 11,
      "text-valign": "center",
      "text-halign": "right",
      "text-margin-x": 6,
      width: 14,
      height: 14,
    },
  },
  {
    selector: 'node[nodeType = "level"][level = 1]',
    style: {
      shape: "round-rectangle",
      width: 140,
      height: 28,
      "text-halign": "center",
      "text-margin-x": 0,
      color: "#ffffff",
      "font-weight": "bold",
      "font-size": 12,
    },
  },
  {
    selector: 'node[nodeType = "level"][level = 2]',
    style: {
      shape: "round-rectangle",
      width: 110,
      height: 20,
      "text-halign": "center",
      "text-margin-x": 0,
      color: "#ffffff",
      "font-weight": "bold",
      "font-size": 10,
      "background-opacity": 0.55,
    },
  },
  {
    selector: 'node[category = "과목"]',
    style: {
      shape: "ellipse",
      width: 20,
      height: 20,
      "border-width": 2,
      "border-color": "#ffffff",
      "font-weight": "bold",
      "font-size": 12,
    },
  },
  {
    selector: 'node[category = "대단원"]',
    style: {
      shape: "ellipse",
      width: 14,
      height: 14,
      "font-size": 11,
      color: "#e5e7eb",
    },
  },
  {
    selector: 'node[category = "소단원"]',
    style: {
      shape: "ellipse",
      width: 10,
      height: 10,
      "font-size": 10,
      color: "#d1d5db",
    },
  },
  {
    selector: 'node[nodeType = "level_toc"]',
    style: {
      shape: "diamond",
      width: 11,
      height: 11,
      "border-width": 1,
      "border-color": "#fbbf24",
      "font-size": 10,
      color: "#fde68a",
    },
  },
  {
    selector: 'node[nodeType = "concept"]',
    style: {
      shape: "hexagon",
      width: 12,
      height: 12,
      "background-opacity": 0.85,
      "border-width": 1.5,
      "border-color": "#38bdf8",
      "font-size": 10,
      color: "#bae6fd",
    },
  },
  {
    selector: 'node[nodeType = "achievement"]',
    style: {
      shape: "tag",
      width: 13,
      height: 11,
      "background-color": "#a855f7",
      "font-size": 9,
      color: "#e9d5ff",
    },
  },
  {
    selector: 'node[nodeType = "book"]',
    style: {
      shape: "round-rectangle",
      width: 22,
      height: 26,
      "background-color": "#f97316",
      "border-width": 1.5,
      "border-color": "#fdba74",
      "font-size": 11,
      "font-weight": "bold",
      color: "#fdba74",
    },
  },
  {
    selector: 'node[nodeType = "toc"]',
    style: {
      shape: "diamond",
      width: 10,
      height: 10,
      "background-color": "#fb923c",
      "font-size": 10,
    },
  },
  {
    selector: 'node[nodeType = "page"]',
    style: {
      shape: "rectangle",
      width: 12,
      height: 14,
      "background-color": "#60a5fa",
      "font-size": 10,
    },
  },
  {
    selector: 'node[nodeType = "paragraph"]',
    style: {
      shape: "round-rectangle",
      width: 10,
      height: 10,
      "background-color": "#a78bfa",
      "font-size": 10,
    },
  },
  {
    selector: "node[hasHidden > 0]",
    style: {
      "border-width": 2.5,
      "border-style": "double",
      "border-color": "#fde68a",
    },
  },
  {
    selector: "node:selected",
    style: {
      "border-width": 3.5,
      "border-color": "#f97316",
      "underlay-color": "#f97316",
      "underlay-opacity": 0.25,
      "underlay-padding": 6,
    },
  },
  {
    selector: "node.trace-upstream",
    style: {
      "border-width": 3,
      "border-color": "#38bdf8",
      "underlay-color": "#38bdf8",
      "underlay-opacity": 0.2,
      "underlay-padding": 4,
    },
  },
  {
    selector: "node.trace-downstream",
    style: {
      "border-width": 3,
      "border-color": "#f97316",
      "underlay-color": "#f97316",
      "underlay-opacity": 0.2,
      "underlay-padding": 4,
    },
  },
  {
    selector: "node.dimmed",
    style: {
      opacity: 0.15,
      "text-opacity": 0.1,
    },
  },
  {
    selector: 'edge[visualKind = "tree"]',
    style: {
      width: 1.2,
      "line-color": "#4b5563",
      "curve-style": "taxi",
      "taxi-direction": "horizontal",
      opacity: 0.75,
    },
  },
  {
    selector: 'edge[visualKind = "tree_free"]',
    style: {
      width: 1.2,
      "line-color": "#4b5563",
      "curve-style": "bezier",
      opacity: 0.65,
    },
  },
  {
    selector: 'edge[visualKind = "extra"]',
    style: {
      width: 1,
      "line-color": "#4b5563",
      "line-style": "dashed",
      "curve-style": "bezier",
      opacity: 0.35,
    },
  },
  {
    selector: 'edge[edgeType = "BELONGS_TO_AREA"]',
    style: {
      width: 1,
      "line-color": "#6b7280",
      "line-style": "dotted",
      "curve-style": "bezier",
      opacity: 0.3,
    },
  },
  {
    selector: 'edge[edgeType = "PREREQUISITE_OF"]',
    style: {
      width: 1.5,
      "line-color": "#f3f4f6",
      "target-arrow-color": "#f3f4f6",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.8,
      "curve-style": "unbundled-bezier",
      "control-point-distances": [55],
      opacity: 0.4,
    },
  },
  {
    selector: 'edge[edgeType = "APPLIES_TO"]',
    style: {
      width: 1.5,
      "line-color": "#38bdf8",
      "target-arrow-color": "#38bdf8",
      "target-arrow-shape": "vee",
      "line-style": "dashed",
      "curve-style": "unbundled-bezier",
      "control-point-distances": [45],
      opacity: 0.65,
    },
  },
  {
    selector: 'edge[edgeType = "DESCRIBES"]',
    style: {
      width: 1.2,
      "line-color": "#a78bfa",
      "target-arrow-color": "#a78bfa",
      "target-arrow-shape": "tee",
      "line-style": "dotted",
      "curve-style": "bezier",
      opacity: 0.6,
    },
  },
  {
    selector: 'edge[edgeType = "CONCEPT_IN_UNIT"]',
    style: {
      width: 1.4,
      "line-color": "#38bdf8",
      "target-arrow-color": "#38bdf8",
      "target-arrow-shape": "triangle-backcurve",
      "arrow-scale": 0.7,
      "curve-style": "bezier",
      opacity: 0.75,
    },
  },
  {
    selector: 'edge[edgeType = "CONCEPT_IN_UNIT"][isPrimary = 0]',
    style: {
      width: 1,
      "line-color": "#0284c7",
      "line-style": "dashed",
      opacity: 0.4,
    },
  },
  {
    selector: 'edge[edgeType = "CONCEPT_PREREQ_OF"]',
    style: {
      width: 1.5,
      "line-color": "#fbbf24",
      "target-arrow-color": "#fbbf24",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.8,
      "curve-style": "unbundled-bezier",
      "control-point-distances": [40],
      opacity: 0.75,
    },
  },
  {
    selector: 'edge[edgeType = "HAS_ACHIEVEMENT"]',
    style: {
      width: 1,
      "line-color": "#a855f7",
      "target-arrow-color": "#a855f7",
      "target-arrow-shape": "triangle",
      "line-style": "dotted",
      "curve-style": "bezier",
      opacity: 0.6,
    },
  },
  {
    selector: 'edge[edgeType = "MAPS_TO"], edge[edgeType = "HAS_TOC"], edge[edgeType = "POINTS_TO"], edge[edgeType = "HAS_PARAGRAPH"]',
    style: {
      width: 1.2,
      "line-color": "#fb923c",
      "target-arrow-color": "#fb923c",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.75,
      "curve-style": "bezier",
      opacity: 0.65,
    },
  },
  {
    selector: 'edge[edgeType = "ANSWERS"]',
    style: {
      width: 1.5,
      "line-color": "#10b981",
      "target-arrow-color": "#10b981",
      "target-arrow-shape": "triangle",
      "line-style": "dashed",
      "curve-style": "bezier",
      opacity: 0.8,
    },
  },
  {
    selector: "edge.hl",
    style: {
      width: 2.5,
      opacity: 1,
      "line-color": "#fde68a",
      "target-arrow-color": "#fde68a",
      "z-index": 10,
    },
  },
  {
    selector: "edge.dimmed",
    style: {
      opacity: 0.08,
    },
  },
];

