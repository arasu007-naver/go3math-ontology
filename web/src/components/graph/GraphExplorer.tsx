"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type {
  BookSummaryItem,
  GraphEdgeDTO,
  GraphNodeDTO,
  GraphOverviewResponse,
  GraphSearchItem,
} from "@/lib/server/kgGraphQueries";
import GraphCanvas, { type GraphCanvasHandle } from "./GraphCanvas";
import GraphInspector from "./GraphInspector";
import GraphLeftSidebar from "./GraphLeftSidebar";
import GraphToolbar, { type EdgeToggles, type LayerToggles } from "./GraphToolbar";
import { resolveHierarchy, type ViewMode } from "./layouts";

export default function GraphExplorer() {
  const canvasRef = useRef<GraphCanvasHandle>(null);

  const [stats, setStats] = useState<GraphOverviewResponse["stats"] | null>(null);
  const [books, setBooks] = useState<BookSummaryItem[]>([]);
  const [nodesMap, setNodesMap] = useState<Map<string, GraphNodeDTO>>(new Map());
  const [edgesMap, setEdgesMap] = useState<Map<string, GraphEdgeDTO>>(new Map());

  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [maxLevel, setMaxLevel] = useState(3);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [forceVisibleIds, setForceVisibleIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [traceMode, setTraceMode] = useState(false);
  const [areaFilter, setAreaFilter] = useState<string | null>(null);

  const [layers, setLayers] = useState<LayerToggles>({
    levels: true,
    concepts: false,
    levelTocs: true,
    books: false,
  });

  const [edgeOpts, setEdgeOpts] = useState<EdgeToggles>({
    prereq: true,
    appliesTo: true,
    belongsToArea: false,
    onlyConnectedInPrereq: true,
  });

  const [expanding, setExpanding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const mergeElements = useCallback((newNodes: GraphNodeDTO[], newEdges: GraphEdgeDTO[]) => {
    setNodesMap((prev) => {
      const next = new Map(prev);
      for (const n of newNodes) {
        const existing = next.get(n.id);
        next.set(n.id, existing ? { ...existing, ...n } : n);
      }
      return next;
    });
    setEdgesMap((prev) => {
      const next = new Map(prev);
      for (const e of newEdges) {
        next.set(e.id, e);
      }
      return next;
    });
  }, []);

  const loadOverview = useCallback(
    async (incConcepts = layers.concepts, incBooks = layers.books) => {
      const r = await api(
        `/api/graph/overview?includeConcepts=${incConcepts ? "1" : "0"}&includeBooks=${incBooks ? "1" : "0"}`
      );
      if (!r.ok) return;
      const d: GraphOverviewResponse = await r.json();
      setStats(d.stats);
      setBooks(d.books ?? []);
      setNodesMap(new Map(d.nodes.map((n) => [n.id, n])));
      setEdgesMap(new Map(d.edges.map((e) => [e.id, e])));
    },
    [layers.concepts, layers.books]
  );

  useEffect(() => {
    loadOverview(false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allNodes = useMemo(() => [...nodesMap.values()], [nodesMap]);
  const allEdges = useMemo(() => [...edgesMap.values()], [edgesMap]);

  const { area: areaMap, primary: primaryMap } = useMemo(
    () => resolveHierarchy(allNodes, allEdges),
    [allNodes, allEdges]
  );

  const maxAvailableLevel = useMemo(
    () => Math.max(5, ...allNodes.map((n) => n.level ?? 0)),
    [allNodes]
  );

  // 1-hop 동적 확장 (/api/graph/subgraph)
  const expandSubgraph = useCallback(
    async (targetId: string, types?: string[]) => {
      setExpanding(true);
      try {
        const qTypes = types?.length ? `&types=${encodeURIComponent(types.join(","))}` : "";
        const r = await api(`/api/graph/subgraph?nodeId=${encodeURIComponent(targetId)}${qTypes}&limit=150`);
        if (!r.ok) return;
        const d: { nodes: GraphNodeDTO[]; edges: GraphEdgeDTO[]; truncated: boolean } = await r.json();
        mergeElements(d.nodes, d.edges);
        setExpanded((prev) => new Set(prev).add(targetId));
        setForceVisibleIds((prev) => {
          const next = new Set(prev);
          next.add(targetId);
          for (const n of d.nodes) next.add(n.id);
          return next;
        });
        if (d.nodes.some((n) => n.nodeType === "concept")) {
          setLayers((l) => ({ ...l, concepts: true }));
        }
        if (d.nodes.some((n) => n.nodeType === "book")) {
          setLayers((l) => ({ ...l, books: true }));
        }
        showToast(
          `연결 노드 ${d.nodes.length}개 · 간선 ${d.edges.length}개를 펼쳤습니다.${d.truncated ? " (최대 150개 제한)" : ""}`
        );
      } finally {
        setExpanding(false);
      }
    },
    [mergeElements, showToast]
  );

  // 레이어 토글 핸들러 (개념/도서 처음 켤 때 서버에서 로드)
  const handleToggleLayer = async (key: keyof LayerToggles) => {
    const nextVal = !layers[key];
    const nextLayers = { ...layers, [key]: nextVal };
    setLayers(nextLayers);

    if (key === "concepts" && nextVal) {
      const hasAnyConcept = allNodes.some((n) => n.nodeType === "concept");
      if (!hasAnyConcept) {
        const r = await api(`/api/graph/overview?includeConcepts=1&includeBooks=${nextLayers.books ? "1" : "0"}`);
        if (r.ok) {
          const d: GraphOverviewResponse = await r.json();
          mergeElements(d.nodes, d.edges);
          showToast("현재 펼쳐진 단원의 수학 개념 노드를 불러왔습니다.");
        }
      }
    } else if (key === "books" && nextVal) {
      const hasAnyBook = allNodes.some((n) => n.nodeType === "book");
      if (!hasAnyBook) {
        const r = await api(`/api/graph/overview?includeConcepts=${nextLayers.concepts ? "1" : "0"}&includeBooks=1`);
        if (r.ok) {
          const d: GraphOverviewResponse = await r.json();
          mergeElements(d.nodes, d.edges);
          showToast("도서 노드를 캔버스에 추가했습니다.");
        }
      }
    }
  };

  const handleToggleEdge = (key: keyof EdgeToggles) => {
    setEdgeOpts((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // 현재 화면에 표시할 노드와 간선 계산
  const { visibleNodes, visibleEdges, hasHiddenSet } = useMemo(() => {
    const kids = new Map<string, string[]>();
    for (const e of allEdges) {
      if (e.edgeType === "HAS_CHILD") {
        kids.set(e.src, [...(kids.get(e.src) ?? []), e.dst]);
      }
    }

    // 1) 기본 level 깊이 + expanded 체인
    const shownLevelIds = new Set<string>();
    if (layers.levels) {
      for (const n of allNodes) {
        if ((n.nodeType === "level" || n.nodeType === "level_toc") && (n.level ?? 99) <= maxLevel) {
          if (n.nodeType === "level_toc" && !layers.levelTocs) continue;
          shownLevelIds.add(n.id);
        }
      }
      const queue = [...shownLevelIds].filter((id) => expanded.has(id));
      while (queue.length > 0) {
        const cur = queue.pop()!;
        for (const k of kids.get(cur) ?? []) {
          const kn = nodesMap.get(k);
          if (!kn) continue;
          if (kn.nodeType === "level_toc" && !layers.levelTocs && !forceVisibleIds.has(k)) continue;
          if (!shownLevelIds.has(k)) {
            shownLevelIds.add(k);
            if (expanded.has(k)) queue.push(k);
          }
        }
      }
    }

    // 강제로 펼친 노드와 그 상위 체인도 포함
    for (const fid of forceVisibleIds) {
      const fn = nodesMap.get(fid);
      if (!fn) continue;
      if (fn.nodeType === "level" || fn.nodeType === "level_toc") {
        shownLevelIds.add(fid);
        let p = primaryMap.get(fid);
        while (p && !shownLevelIds.has(p)) {
          shownLevelIds.add(p);
          p = primaryMap.get(p);
        }
      }
    }

    const shownIds = new Set<string>(shownLevelIds);

    // 2) 개념 노드: layers.concepts 가 켜져 있으면 현재 보이는 단원에 연결된 개념(최대 300개) 또는 forceVisibleIds
    if (layers.concepts) {
      let conceptAdded = 0;
      for (const n of allNodes) {
        if (n.nodeType !== "concept") continue;
        const inForce = forceVisibleIds.has(n.id);
        const parentUnit = primaryMap.get(n.id) ?? n.unitId;
        if (inForce || (parentUnit && shownLevelIds.has(parentUnit))) {
          if (conceptAdded < 300 || inForce) {
            shownIds.add(n.id);
            conceptAdded++;
          }
        }
      }
    }

    // 3) 도서 및 기타 동적 확장 노드
    for (const n of allNodes) {
      if (n.nodeType === "book" && (layers.books || forceVisibleIds.has(n.id))) {
        shownIds.add(n.id);
      } else if (
        (n.nodeType === "achievement" || n.nodeType === "toc" || n.nodeType === "page" || n.nodeType === "paragraph") &&
        forceVisibleIds.has(n.id)
      ) {
        shownIds.add(n.id);
      }
    }

    // 4) 영역(L1) 필터 적용
    if (areaFilter) {
      for (const id of [...shownIds]) {
        const a = areaMap.get(id) ?? (id === areaFilter ? areaFilter : null);
        if (a !== areaFilter && !forceVisibleIds.has(id)) {
          shownIds.delete(id);
        }
      }
    }

    // 5) 간선 필터링
    let vEdges = allEdges.filter((e) => {
      if (!shownIds.has(e.src) || !shownIds.has(e.dst)) return false;
      if (e.edgeType === "PREREQUISITE_OF" || e.edgeType === "CONCEPT_PREREQ_OF") {
        return edgeOpts.prereq;
      }
      if (e.edgeType === "APPLIES_TO" || e.edgeType === "DESCRIBES") {
        return edgeOpts.appliesTo;
      }
      if (e.edgeType === "BELONGS_TO_AREA") {
        return edgeOpts.belongsToArea;
      }
      if (viewMode === "prereq" && e.edgeType === "HAS_CHILD") {
        return false; // 선수 DAG 모드에서는 포함 관계선 대신 선수 관계에 집중
      }
      return true;
    });

    // 6) 선수 DAG 모드에서 고립 노드 숨김 옵션
    if (viewMode === "prereq" && edgeOpts.onlyConnectedInPrereq) {
      const connected = new Set<string>();
      for (const e of vEdges) {
        if (
          e.edgeType === "PREREQUISITE_OF" ||
          e.edgeType === "CONCEPT_PREREQ_OF" ||
          e.edgeType === "CONCEPT_IN_UNIT"
        ) {
          connected.add(e.src);
          connected.add(e.dst);
        }
      }
      if (selectedId && shownIds.has(selectedId)) connected.add(selectedId);
      for (const id of [...shownIds]) {
        if (!connected.has(id)) shownIds.delete(id);
      }
      vEdges = vEdges.filter((e) => shownIds.has(e.src) && shownIds.has(e.dst));
    }

    const vNodes = allNodes.filter((n) => shownIds.has(n.id));

    // 아직 펼쳐지지 않은 하위 노드/개념이 있는 노드 표시
    const hidden = new Set<string>();
    for (const e of allEdges) {
      if (e.edgeType === "HAS_CHILD" && shownIds.has(e.src) && !shownIds.has(e.dst)) {
        hidden.add(e.src);
      }
    }
    for (const n of vNodes) {
      if ((n.conceptCount ?? 0) > 0 && !layers.concepts) {
        hidden.add(n.id);
      }
    }

    return { visibleNodes: vNodes, visibleEdges: vEdges, hasHiddenSet: hidden };
  }, [
    allNodes,
    allEdges,
    layers,
    maxLevel,
    expanded,
    forceVisibleIds,
    nodesMap,
    primaryMap,
    areaFilter,
    areaMap,
    edgeOpts,
    viewMode,
    selectedId,
  ]);

  // 노드 선택 및 펼치기/접기
  const handleSelectNode = useCallback(
    (id: string | null, toggleExpand = false) => {
      setSelectedId(id);
      if (!id) {
        setTraceMode(false);
        return;
      }
      // 만약 아직 캔버스에 보이지 않는 노드라면 상위 경로와 함께 강제 표시
      setForceVisibleIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setExpanded((cur) => {
        const next = new Set(cur);
        if (toggleExpand && next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    []
  );

  // 검색 결과 선택 시 해당 노드 로드 및 캔버스 포커스 이동
  const handleSelectSearchItem = async (item: GraphSearchItem) => {
    if (!nodesMap.has(item.id)) {
      await expandSubgraph(item.unitId ?? item.id);
    }
    if (item.nodeType === "concept") {
      setLayers((l) => ({ ...l, concepts: true }));
    } else if (item.nodeType === "book" || item.nodeType === "dictionary") {
      setLayers((l) => ({ ...l, books: true }));
    }
    setForceVisibleIds((prev) => {
      const next = new Set(prev);
      next.add(item.id);
      if (item.unitId) next.add(item.unitId);
      return next;
    });
    setSelectedId(item.id);
    setTimeout(() => {
      canvasRef.current?.centerNode(item.id);
    }, 180);
  };

  // 선수 관계 추가/삭제 (기존 /api/graph/levels POST 연동)
  const handleSetPrereq = async (src: string, dst: string, on: boolean) => {
    const res = await api("/api/graph/levels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src, dst, on }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error ?? "선수 관계 변경 실패");
    await loadOverview(layers.concepts, layers.books);
  };

  const handleReset = () => {
    setViewMode("tree");
    setMaxLevel(3);
    setExpanded(new Set());
    setForceVisibleIds(new Set());
    setSelectedId(null);
    setTraceMode(false);
    setAreaFilter(null);
  };

  return (
    <main className="flex-1 flex flex-col min-h-0 p-4 gap-3 relative overflow-hidden">
      {/* 오른쪽 상단 주황색 토스트 */}
      {toast && (
        <div
          role="status"
          onClick={() => setToast(null)}
          className="fixed top-16 right-6 z-50 max-w-md rounded-xl bg-orange-500 px-4 py-2.5 text-xs font-semibold text-white shadow-2xl cursor-pointer animate-in fade-in slide-in-from-top-3 duration-200"
        >
          {toast}
        </div>
      )}

      {/* 상단 컨트롤 툴바 */}
      <GraphToolbar
        viewMode={viewMode}
        onViewMode={setViewMode}
        maxLevel={maxLevel}
        maxAvailableLevel={maxAvailableLevel}
        onMaxLevel={(l) => {
          setMaxLevel(l);
          setExpanded(new Set());
        }}
        layers={layers}
        onToggleLayer={handleToggleLayer}
        edges={edgeOpts}
        onToggleEdge={handleToggleEdge}
        areaFilter={areaFilter}
        onAreaFilter={setAreaFilter}
        stats={stats}
        onSelectSearchItem={handleSelectSearchItem}
        onReset={handleReset}
        onFit={() => canvasRef.current?.fit()}
      />

      {/* 본문 3단 레이아웃: 좌측 탐색 트리 · 중앙 Cytoscape 캔버스 · 우측 인스펙터 */}
      <div className="flex-1 flex min-h-0 gap-3 overflow-hidden">
        <GraphLeftSidebar
          stats={stats}
          nodes={allNodes}
          books={books}
          primaryMap={primaryMap}
          areaMap={areaMap}
          selectedId={selectedId}
          onSelectNode={(id) => {
            handleSelectNode(id, false);
            setTimeout(() => canvasRef.current?.centerNode(id), 120);
          }}
          onExpandUnitConcepts={(unitId) => {
            setSelectedId(unitId);
            expandSubgraph(unitId, ["concepts", "children"]);
          }}
        />

        <GraphCanvas
          ref={canvasRef}
          nodes={visibleNodes}
          edges={visibleEdges}
          allNodesMap={nodesMap}
          primaryMap={primaryMap}
          areaMap={areaMap}
          hasHiddenSet={hasHiddenSet}
          viewMode={viewMode}
          selectedId={selectedId}
          traceMode={traceMode}
          expanding={expanding}
          onSelectNode={handleSelectNode}
          onDoubleTapNode={(id) => {
            setSelectedId(id);
            expandSubgraph(id);
          }}
          onToggleTrace={() => setTraceMode((t) => !t)}
          onExpandSubgraph={() => {
            if (selectedId) expandSubgraph(selectedId);
          }}
        />

        <GraphInspector
          selectedId={selectedId}
          allNodes={allNodes}
          allEdges={allEdges}
          areaMap={areaMap}
          primaryMap={primaryMap}
          onSelectNode={(id) => {
            handleSelectNode(id, false);
            setTimeout(() => canvasRef.current?.centerNode(id), 120);
          }}
          onExpandNode={(id, types) => expandSubgraph(id, types)}
          onSetPrereq={handleSetPrereq}
        />
      </div>
    </main>
  );
}

