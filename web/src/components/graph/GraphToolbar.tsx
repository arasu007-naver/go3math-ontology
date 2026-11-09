"use client";

import { useEffect, useRef, useState } from "react";
import { GitBranch, Layers, Maximize2, Network, Orbit, RotateCcw, Search, Share2, X } from "lucide-react";
import { api } from "@/lib/api";
import type { GraphSearchItem } from "@/lib/server/kgGraphQueries";
import { AREA_COLOR, AREA_NAMES, LEVEL_NAME, type ViewMode } from "./layouts";

export type LayerToggles = {
  levels: boolean;
  concepts: boolean;
  levelTocs: boolean;
  books: boolean;
};

export type EdgeToggles = {
  prereq: boolean;
  appliesTo: boolean;
  belongsToArea: boolean;
  onlyConnectedInPrereq: boolean;
};

const VIEW_MODES: { key: ViewMode; label: string; desc: string; icon: typeof GitBranch }[] = [
  { key: "tree", label: "계층 트리", desc: "Level 1~5 교육과정·단원 계층 분류 트리", icon: GitBranch },
  { key: "force", label: "역학 네트워크", desc: "단원·개념·전략·도서 교차 연결 네트워크 (Force-Directed)", icon: Share2 },
  { key: "prereq", label: "선수 DAG", desc: "선수 학습 관계 위상 정렬 흐름도 (Prerequisite DAG)", icon: Network },
  { key: "ego", label: "포커스", desc: "선택 노드 중심 동심원 방사형 네트워크 (Ego-Network)", icon: Orbit },
];

export default function GraphToolbar({
  viewMode,
  onViewMode,
  maxLevel,
  maxAvailableLevel,
  onMaxLevel,
  layers,
  onToggleLayer,
  edges,
  onToggleEdge,
  areaFilter,
  onAreaFilter,
  stats,
  onSelectSearchItem,
  onReset,
  onFit,
}: {
  viewMode: ViewMode;
  onViewMode: (m: ViewMode) => void;
  maxLevel: number;
  maxAvailableLevel: number;
  onMaxLevel: (l: number) => void;
  layers: LayerToggles;
  onToggleLayer: (k: keyof LayerToggles) => void;
  edges: EdgeToggles;
  onToggleEdge: (k: keyof EdgeToggles) => void;
  areaFilter: string | null;
  onAreaFilter: (areaId: string | null) => void;
  stats: {
    levelCount: number;
    tocUnitCount: number;
    conceptCount: number;
    bookCount: number;
  } | null;
  onSelectSearchItem: (item: GraphSearchItem) => void;
  onReset: () => void;
  onFit: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GraphSearchItem[]>([]);
  const [openSearch, setOpenSearch] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const r = await api(`/api/graph/search?q=${encodeURIComponent(q)}&limit=25`);
        if (r.ok && alive) {
          const d = await r.json();
          setResults(d.items ?? []);
        }
      } catch {
        // ignore
      } finally {
        if (alive) setSearching(false);
      }
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setOpenSearch(false);
      }
    };
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, []);

  const levels = Array.from({ length: Math.max(5, maxAvailableLevel) }, (_, i) => i + 1);

  return (
    <section className="glass rounded-2xl px-4 py-2.5 flex flex-col gap-2 shrink-0">
      {/* 1행: 뷰 모드 스위처 · 깊이(L1~L9) · 레이어 토글 · 검색창 · 유틸 버튼 */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {/* 뷰 모드 스위처 */}
          <div className="flex items-center bg-[#0b0f19]/80 border border-white/10 rounded-xl p-0.5">
            {VIEW_MODES.map((m) => {
              const Icon = m.icon;
              const active = viewMode === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => onViewMode(m.key)}
                  title={m.desc}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                    active
                      ? "bg-orange-500 text-white shadow"
                      : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>

          {/* 깊이 L1 ~ Ln */}
          <div className="flex items-center gap-1 bg-[#0b0f19]/60 border border-white/10 rounded-xl px-2 py-1">
            <span className="text-[11px] text-gray-400 mr-1">깊이</span>
            {levels.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onMaxLevel(l)}
                title={`Level ${l} (${LEVEL_NAME[l] ?? "TOC"})까지 펼치기`}
                className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold transition-colors ${
                  maxLevel === l
                    ? "border-orange-500 bg-orange-500/20 text-orange-300"
                    : "border-white/10 text-gray-400 hover:text-white"
                }`}
              >
                L{l}
              </button>
            ))}
          </div>

          {/* 레이어 토글 */}
          <div className="flex items-center gap-1 bg-[#0b0f19]/60 border border-white/10 rounded-xl px-2 py-1 text-[11px]">
            <Layers className="w-3.5 h-3.5 text-gray-400 mr-0.5" />
            <ToggleChip
              active={layers.levels}
              onClick={() => onToggleLayer("levels")}
              label={`단원${stats ? ` (${stats.levelCount})` : ""}`}
              color="emerald"
            />
            <ToggleChip
              active={layers.concepts}
              onClick={() => onToggleLayer("concepts")}
              label={`개념${stats ? ` (${stats.conceptCount})` : ""}`}
              color="sky"
            />
            <ToggleChip
              active={layers.levelTocs}
              onClick={() => onToggleLayer("levelTocs")}
              label={`교재TOC${stats ? ` (${stats.tocUnitCount})` : ""}`}
              color="amber"
            />
            <ToggleChip
              active={layers.books}
              onClick={() => onToggleLayer("books")}
              label={`도서${stats ? ` (${stats.bookCount})` : ""}`}
              color="orange"
            />
          </div>
        </div>

        {/* 검색창 + 리셋/맞춤 */}
        <div className="flex items-center gap-2">
          <div ref={searchBoxRef} className="relative w-64">
            <div className="flex items-center gap-1.5 bg-[#0b0f19] border border-white/15 rounded-xl px-2.5 py-1 focus-within:border-orange-500">
              <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <input
                value={query}
                onChange={(e) => {
                  const v = e.target.value;
                  setQuery(v);
                  setOpenSearch(true);
                  if (!v.trim()) {
                    setResults([]);
                    setSearching(false);
                  } else {
                    setSearching(true);
                  }
                }}
                onFocus={() => setOpenSearch(true)}
                placeholder="단원·개념·도서·용어 검색…"
                className="bg-transparent text-xs text-gray-100 outline-none w-full placeholder:text-gray-500"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setResults([]);
                  }}
                  className="text-gray-500 hover:text-gray-300"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {openSearch && query.trim().length > 0 && (
              <div className="absolute right-0 mt-1 w-80 max-h-80 overflow-y-auto rounded-xl border border-white/15 bg-[#0f1420] shadow-2xl z-50 p-1.5 space-y-0.5">
                {searching && <p className="text-[11px] text-gray-400 px-2 py-1.5">검색 중…</p>}
                {!searching && results.length === 0 && (
                  <p className="text-[11px] text-gray-500 px-2 py-2">검색 결과가 없습니다.</p>
                )}
                {results.map((item, idx) => (
                  <button
                    key={`${item.id}-${idx}`}
                    type="button"
                    onClick={() => {
                      onSelectSearchItem(item);
                      setOpenSearch(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors flex flex-col gap-0.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-gray-100 truncate">{item.title}</span>
                      <span className="text-[10px] px-1.5 py-px rounded border border-white/10 text-gray-400 shrink-0">
                        {item.nodeType}
                      </span>
                    </div>
                    <span className="text-[10px] text-gray-400 truncate">{item.subtitle}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onFit}
            title="화면 맞춤 (Fit)"
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl border border-white/10 text-xs text-gray-300 hover:bg-white/10"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>맞춤</span>
          </button>
          <button
            type="button"
            onClick={onReset}
            title="초기 상태로 리셋 (L3, 필터 해제)"
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl border border-white/10 text-xs text-gray-300 hover:bg-white/10"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>초기화</span>
          </button>
        </div>
      </div>

      {/* 2행: 영역(L1) 필터 칩 + 간선 표시 옵션 */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/5 text-[11px]">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-gray-500 mr-1">영역 필터:</span>
          <button
            type="button"
            onClick={() => onAreaFilter(null)}
            className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold transition-colors ${
              areaFilter === null
                ? "border-orange-500 bg-orange-500/20 text-orange-300"
                : "border-white/10 text-gray-400 hover:text-gray-200"
            }`}
          >
            전체 영역
          </button>
          {Object.entries(AREA_NAMES).map(([id, name]) => {
            const active = areaFilter === id;
            const color = AREA_COLOR[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => onAreaFilter(active ? null : id)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold transition-colors ${
                  active
                    ? "border-white/60 bg-white/15 text-white"
                    : "border-white/10 text-gray-400 hover:text-gray-200"
                }`}
              >
                <i className="w-2 h-2 rounded-full inline-block" style={{ background: color }} />
                <span>{name}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-gray-500">간선:</span>
          <ToggleChip
            active={edges.prereq}
            onClick={() => onToggleEdge("prereq")}
            label="━▶ 선수 관계"
            color="gray"
          />
          <ToggleChip
            active={edges.appliesTo}
            onClick={() => onToggleEdge("appliesTo")}
            label="⇢ 전략·교육과정 적용"
            color="sky"
          />
          <ToggleChip
            active={edges.belongsToArea}
            onClick={() => onToggleEdge("belongsToArea")}
            label="┄ 복수 영역 소속"
            color="gray"
          />
          {viewMode === "prereq" && (
            <ToggleChip
              active={edges.onlyConnectedInPrereq}
              onClick={() => onToggleEdge("onlyConnectedInPrereq")}
              label="선수 간선 있는 노드만"
              color="amber"
            />
          )}
        </div>
      </div>
    </section>
  );
}

function ToggleChip({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color: "emerald" | "sky" | "amber" | "orange" | "gray";
}) {
  const activeCls = {
    emerald: "border-emerald-500/60 bg-emerald-500/20 text-emerald-200",
    sky: "border-sky-500/60 bg-sky-500/20 text-sky-200",
    amber: "border-amber-500/60 bg-amber-500/20 text-amber-200",
    orange: "border-orange-500/60 bg-orange-500/20 text-orange-200",
    gray: "border-white/30 bg-white/15 text-gray-100",
  }[color];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-0.5 rounded-lg border text-[11px] font-medium transition-colors ${
        active ? activeCls : "border-white/10 text-gray-500 hover:text-gray-300"
      }`}
    >
      {active ? "☑ " : "☐ "}
      {label}
    </button>
  );
}
