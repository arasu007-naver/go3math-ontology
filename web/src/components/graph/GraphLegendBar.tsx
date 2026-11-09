"use client";

import { Crosshair, Download, GitCommitHorizontal, Maximize2, Plus, Sparkles, ZoomIn, ZoomOut } from "lucide-react";

export default function GraphLegendBar({
  selectedId,
  traceMode,
  onToggleTrace,
  onExpandSubgraph,
  expanding,
  onZoomIn,
  onZoomOut,
  onFit,
  onCenterSelected,
  onExportPng,
  visibleNodeCount,
  visibleEdgeCount,
}: {
  selectedId: string | null;
  traceMode: boolean;
  onToggleTrace: () => void;
  onExpandSubgraph: () => void;
  expanding: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onCenterSelected: () => void;
  onExportPng: () => void;
  visibleNodeCount: number;
  visibleEdgeCount: number;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2 z-20">
      {/* 좌측 하단: 노드/엣지 시각적 인코딩 범례 */}
      <div className="pointer-events-auto glass rounded-xl px-3 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-300 border border-white/10">
        <span className="font-semibold text-gray-200">
          표시: 노드 {visibleNodeCount} · 간선 {visibleEdgeCount}
        </span>
        <span className="text-gray-500">|</span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full border-2 border-white inline-block bg-orange-500" /> 과목
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block bg-sky-400" /> 대·소단원
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rotate-45 border border-amber-400 bg-amber-500/40 inline-block" /> 교재TOC
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm border border-sky-400 bg-sky-500/50 inline-block" /> 수학개념
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-3 rounded-sm bg-orange-500 inline-block" /> 도서
        </span>
        <span className="text-amber-300">◎ 더블클릭: 연결 확장</span>
      </div>

      {/* 우측 하단: 선택 노드 액션 (경로 추적 / 1-hop 확장) + 캔버스 줌/저장 컨트롤 */}
      <div className="pointer-events-auto flex items-center gap-1.5">
        {selectedId && (
          <div className="glass rounded-xl p-1 flex items-center gap-1 border border-white/15">
            <button
              type="button"
              onClick={onToggleTrace}
              title="선택한 노드의 선수(파랑)·후속(주황) 학습 체인을 추적하고 나머지 노드를 흐리게 표시합니다"
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                traceMode
                  ? "bg-amber-500 text-black shadow"
                  : "text-amber-300 hover:bg-white/10"
              }`}
            >
              <GitCommitHorizontal className="w-3.5 h-3.5" />
              <span>{traceMode ? "선수·후속 추적 중" : "선수·후속 경로 추적"}</span>
            </button>
            <button
              type="button"
              onClick={onExpandSubgraph}
              disabled={expanding}
              title="선택한 노드에 연결된 하위 단원·수학 개념·도서·문단을 1-hop 불러와 캔버스에 추가합니다"
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-sky-500/20 border border-sky-500/40 text-sky-200 hover:bg-sky-500/30 disabled:opacity-40"
            >
              {expanding ? <Sparkles className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              <span>연결 펼치기 (1-hop)</span>
            </button>
          </div>
        )}

        <div className="glass rounded-xl p-1 flex items-center gap-0.5 border border-white/10 text-gray-300">
          <button
            type="button"
            onClick={onZoomIn}
            title="확대"
            className="p-1.5 rounded-lg hover:bg-white/10 hover:text-white"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onZoomOut}
            title="축소"
            className="p-1.5 rounded-lg hover:bg-white/10 hover:text-white"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onFit}
            title="전체 맞춤"
            className="p-1.5 rounded-lg hover:bg-white/10 hover:text-white"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          {selectedId && (
            <button
              type="button"
              onClick={onCenterSelected}
              title="선택 노드로 포커스"
              className="p-1.5 rounded-lg hover:bg-white/10 hover:text-orange-400"
            >
              <Crosshair className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onExportPng}
            title="현재 그래프 PNG 이미지로 저장"
            className="p-1.5 rounded-lg hover:bg-white/10 hover:text-white"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

