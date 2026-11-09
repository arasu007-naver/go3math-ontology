"use client";

import type { Core } from "cytoscape";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { ChevronRight } from "lucide-react";
import type { GraphEdgeDTO, GraphNodeDTO } from "@/lib/server/kgGraphQueries";
import {
  AREA_COLOR,
  buildLayoutOptions,
  computeHops,
  computePrereqChain,
  GRAPH_STYLESHEET,
  type ViewMode,
} from "./layouts";
import GraphLegendBar from "./GraphLegendBar";

export type GraphCanvasHandle = {
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  centerNode: (id: string) => void;
  exportPng: () => void;
};

function formatNodeDisplayLabel(n: GraphNodeDTO): string {
  if (n.nodeType === "level") {
    const base = n.grade ? `${n.label} · 중${n.grade}` : n.label;
    const badges: string[] = [];
    if ((n.conceptCount ?? 0) > 0) badges.push(`개념${n.conceptCount}`);
    if ((n.tocCount ?? 0) > 0) badges.push(`TOC${n.tocCount}`);
    else if ((n.mapCount ?? 0) > 0) badges.push(`${n.mapCount}`);
    return badges.length ? `${base} (${badges.join("·")})` : base;
  }
  if (n.nodeType === "level_toc") {
    return `[TOC] ${n.label}`;
  }
  if (n.nodeType === "concept") {
    const short = n.label.length > 26 ? `${n.label.slice(0, 26)}…` : n.label;
    return n.sourceId ? `#${n.sourceId} ${short}` : short;
  }
  if (n.nodeType === "book") {
    return `📘 ${n.label}`;
  }
  return n.label;
}

const GraphCanvas = forwardRef<
  GraphCanvasHandle,
  {
    nodes: GraphNodeDTO[];
    edges: GraphEdgeDTO[];
    allNodesMap: Map<string, GraphNodeDTO>;
    primaryMap: Map<string, string>;
    areaMap: Map<string, string>;
    hasHiddenSet: Set<string>;
    viewMode: ViewMode;
    selectedId: string | null;
    traceMode: boolean;
    expanding: boolean;
    onSelectNode: (id: string | null, toggleExpand?: boolean) => void;
    onDoubleTapNode: (id: string) => void;
    onToggleTrace: () => void;
    onExpandSubgraph: () => void;
  }
>(function GraphCanvas(
  {
    nodes,
    edges,
    allNodesMap,
    primaryMap,
    areaMap,
    hasHiddenSet,
    viewMode,
    selectedId,
    traceMode,
    expanding,
    onSelectNode,
    onDoubleTapNode,
    onToggleTrace,
    onExpandSubgraph,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const selectedRef = useRef<string | null>(selectedId);
  const anchorRef = useRef<{ id: string; x: number; y: number; zoom: number } | null>(null);
  const prevModeRef = useRef<ViewMode>(viewMode);

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  useImperativeHandle(ref, () => ({
    fit: () => {
      cyRef.current?.fit(undefined, 36);
    },
    zoomIn: () => {
      const c = cyRef.current;
      if (!c) return;
      c.zoom({ level: c.zoom() * 1.25, renderedPosition: { x: c.width() / 2, y: c.height() / 2 } });
    },
    zoomOut: () => {
      const c = cyRef.current;
      if (!c) return;
      c.zoom({ level: c.zoom() / 1.25, renderedPosition: { x: c.width() / 2, y: c.height() / 2 } });
    },
    centerNode: (id: string) => {
      const c = cyRef.current;
      if (!c) return;
      const target = c.$id(id);
      if (target.nonempty()) {
        c.animate({ center: { eles: target }, zoom: Math.max(c.zoom(), 1.2) }, { duration: 300 });
      }
    },
    exportPng: () => {
      const c = cyRef.current;
      if (!c) return;
      const dataUrl = c.png({ bg: "#0d1117", full: true, scale: 2 });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `go3math-kg-${viewMode}-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
    },
  }));

  // 선택 노드의 상위 브레드크럼 경로
  const breadcrumbs = useMemo(() => {
    if (!selectedId) return [];
    const chain: GraphNodeDTO[] = [];
    let cur: string | undefined = selectedId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const n = allNodesMap.get(cur);
      if (n) chain.unshift(n);
      cur = primaryMap.get(cur);
    }
    return chain;
  }, [selectedId, allNodesMap, primaryMap]);

  // 그래프 렌더링 및 레이아웃
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;
    const modeChanged = prevModeRef.current !== viewMode;
    prevModeRef.current = viewMode;
    if (modeChanged) {
      anchorRef.current = null;
    }

    import("cytoscape").then(({ default: cytoscape }) => {
      if (destroyed || !containerRef.current) return;
      cyRef.current?.destroy();

      const hops = viewMode === "ego" ? computeHops(selectedRef.current, nodes, edges) : new Map<string, number>();

      const elements = [
        ...nodes.map((n) => {
          const areaId = areaMap.get(n.id) ?? (n.level === 1 ? n.id : "");
          const color =
            n.nodeType === "book"
              ? "#f97316"
              : n.nodeType === "achievement"
                ? "#a855f7"
                : AREA_COLOR[areaId] ?? "#6b7280";
          return {
            data: {
              id: n.id,
              nodeType: n.nodeType,
              label: n.label,
              displayLabel: formatNodeDisplayLabel(n),
              level: n.level ?? 0,
              category: n.category ?? "",
              color,
              hasHidden: hasHiddenSet.has(n.id) ? 1 : 0,
              hop: hops.get(n.id) ?? 3,
            },
          };
        }),
        ...edges.map((e) => {
          const isPrimaryTree = e.edgeType === "HAS_CHILD" && primaryMap.get(e.dst) === e.src;
          const visualKind =
            e.edgeType === "HAS_CHILD"
              ? isPrimaryTree
                ? viewMode === "tree"
                  ? "tree"
                  : "tree_free"
                : "extra"
              : e.edgeType;
          return {
            data: {
              id: e.id,
              source: e.src,
              target: e.dst,
              edgeType: e.edgeType,
              visualKind,
              isPrimary: e.isPrimary === false ? 0 : 1,
            },
          };
        }),
      ];

      const layout = buildLayoutOptions(
        viewMode,
        nodes,
        edges,
        primaryMap,
        areaMap,
        selectedRef.current,
        !anchorRef.current
      );

      const c = cytoscape({
        container: containerRef.current,
        elements,
        style: GRAPH_STYLESHEET,
        layout,
      });
      cyRef.current = c;

      // tree 모드에서 노드 펼치기/접기 시 클릭한 노드의 화면 위치 고정
      const a = anchorRef.current;
      if (viewMode === "tree" && a && c.$id(a.id).nonempty()) {
        c.zoom(a.zoom);
        const p = c.$id(a.id).renderedPosition();
        c.panBy({ x: a.x - p.x, y: a.y - p.y });
      }

      if (selectedRef.current && c.$id(selectedRef.current).nonempty()) {
        c.$id(selectedRef.current).select();
      }

      c.on("tap", "node", (ev) => {
        const id: string = ev.target.id();
        const p = ev.target.renderedPosition();
        anchorRef.current = { id, x: p.x, y: p.y, zoom: c.zoom() };
        const isSame = selectedRef.current === id;
        onSelectNode(id, isSame);
      });

      c.on("dbltap", "node", (ev) => {
        const id: string = ev.target.id();
        onDoubleTapNode(id);
      });

      c.on("tap", (ev) => {
        if (ev.target === c) {
          onSelectNode(null, false);
        }
      });
    });

    return () => {
      destroyed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, viewMode, primaryMap, areaMap, hasHiddenSet]);

  // 선택 노드 간선 강조 및 선수/후속 경로 추적(Path Trace) 클래스 반영
  useEffect(() => {
    const c = cyRef.current;
    if (!c) return;

    c.batch(() => {
      c.nodes().removeClass("trace-upstream trace-downstream dimmed");
      c.edges().removeClass("hl dimmed");

      if (!selectedId || c.$id(selectedId).empty()) return;

      if (traceMode) {
        const { upstreamNodes, downstreamNodes, chainEdges } = computePrereqChain(selectedId, edges);
        c.nodes().forEach((n) => {
          const nid = n.id();
          if (nid === selectedId) return;
          if (upstreamNodes.has(nid)) n.addClass("trace-upstream");
          else if (downstreamNodes.has(nid)) n.addClass("trace-downstream");
          else n.addClass("dimmed");
        });
        c.edges().forEach((e) => {
          if (chainEdges.has(e.id())) e.addClass("hl");
          else e.addClass("dimmed");
        });
      } else {
        c.$id(selectedId)
          .connectedEdges(
            '[edgeType = "PREREQUISITE_OF"], [edgeType = "CONCEPT_PREREQ_OF"], [edgeType = "CONCEPT_IN_UNIT"], [edgeType = "APPLIES_TO"], [edgeType = "MAPS_TO"]'
          )
          .addClass("hl");
      }
    });
  }, [selectedId, traceMode, edges, nodes]);

  useEffect(() => () => cyRef.current?.destroy(), []);

  return (
    <section className="flex-1 glass rounded-2xl overflow-hidden relative flex flex-col min-w-0">
      {/* 상단 브레드크럼 바 */}
      {breadcrumbs.length > 0 && (
        <div className="pointer-events-none absolute top-3 left-3 right-3 z-20 flex items-center justify-between gap-2">
          <div className="pointer-events-auto glass rounded-xl px-3 py-1.5 border border-white/10 flex items-center gap-1 text-xs overflow-x-auto max-w-full">
            {breadcrumbs.map((b, i) => (
              <span key={b.id} className="flex items-center gap-1 shrink-0">
                {i > 0 && <ChevronRight className="w-3 h-3 text-gray-500" />}
                <button
                  type="button"
                  onClick={() => onSelectNode(b.id, false)}
                  className={`px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors ${
                    b.id === selectedId ? "text-orange-300 font-bold" : "text-gray-300"
                  }`}
                >
                  {b.label}
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Cytoscape 캔버스 */}
      <div ref={containerRef} className="flex-1 bg-[#0d1117] w-full h-full" />

      {/* 하단 플로팅 범례 + 액션 컨트롤 */}
      <GraphLegendBar
        selectedId={selectedId}
        traceMode={traceMode}
        onToggleTrace={onToggleTrace}
        onExpandSubgraph={onExpandSubgraph}
        expanding={expanding}
        onZoomIn={() => {
          const c = cyRef.current;
          if (c) c.zoom({ level: c.zoom() * 1.25, renderedPosition: { x: c.width() / 2, y: c.height() / 2 } });
        }}
        onZoomOut={() => {
          const c = cyRef.current;
          if (c) c.zoom({ level: c.zoom() / 1.25, renderedPosition: { x: c.width() / 2, y: c.height() / 2 } });
        }}
        onFit={() => cyRef.current?.fit(undefined, 36)}
        onCenterSelected={() => {
          const c = cyRef.current;
          if (c && selectedId && c.$id(selectedId).nonempty()) {
            c.animate({ center: { eles: c.$id(selectedId) }, zoom: Math.max(c.zoom(), 1.3) }, { duration: 300 });
          }
        }}
        onExportPng={() => {
          const c = cyRef.current;
          if (!c) return;
          const dataUrl = c.png({ bg: "#0d1117", full: true, scale: 2 });
          const a = document.createElement("a");
          a.href = dataUrl;
          a.download = `go3math-kg-${viewMode}.png`;
          a.click();
        }}
        visibleNodeCount={nodes.length}
        visibleEdgeCount={edges.length}
      />
    </section>
  );
});

export default GraphCanvas;

