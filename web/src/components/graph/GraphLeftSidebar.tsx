"use client";

import { useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Database, FolderTree, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { BookSummaryItem, GraphNodeDTO, GraphOverviewResponse } from "@/lib/server/kgGraphQueries";
import { AREA_COLOR, AREA_NAMES } from "./layouts";

export default function GraphLeftSidebar({
  stats,
  nodes,
  books,
  primaryMap,
  areaMap,
  selectedId,
  onSelectNode,
  onExpandUnitConcepts,
}: {
  stats: GraphOverviewResponse["stats"] | null;
  nodes: GraphNodeDTO[];
  books: BookSummaryItem[];
  primaryMap: Map<string, string>;
  areaMap: Map<string, string>;
  selectedId: string | null;
  onSelectNode: (id: string) => void;
  onExpandUnitConcepts: (unitId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<"tree" | "books">("tree");
  const [openAreas, setOpenAreas] = useState<Set<string>>(new Set(["L1-FUNC", "L1-NUM", "L1-EXPR"]));

  if (collapsed) {
    return (
      <aside className="w-10 shrink-0 glass rounded-2xl flex flex-col items-center py-3 gap-3">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="좌측 탐색 패널 열기"
          className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
      </aside>
    );
  }

  const toggleArea = (id: string) => {
    setOpenAreas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // L1 영역별로 L3(중등 대단원 / 고등 과목 / 수학 학습 대단원)과 L4(고등 대단원)를 묶는다
  const l1Nodes = nodes
    .filter((n) => n.nodeType === "level" && n.level === 1)
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

  const childrenOf = (parentId: string) =>
    nodes
      .filter((n) => n.nodeType === "level" && primaryMap.get(n.id) === parentId)
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.id.localeCompare(b.id));

  return (
    <aside className="w-[270px] shrink-0 glass rounded-2xl flex flex-col overflow-hidden">
      {/* 상단 헤더 */}
      <div className="px-3.5 py-2.5 border-b border-white/5 bg-white/5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-bold text-gray-200">
          <Database className="w-3.5 h-3.5 text-orange-400" />
          <span>KG 탐색기</span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="좌측 패널 접기"
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10"
        >
          <PanelLeftClose className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* DB 요약 통계 그리드 */}
      {stats && (
        <div className="grid grid-cols-3 gap-1.5 p-2.5 border-b border-white/5 bg-black/20 text-[10px]">
          <StatBox label="교육과정 단원" value={stats.levelCount} color="text-emerald-300" />
          <StatBox label="수학 개념" value={stats.conceptCount} color="text-sky-300" />
          <StatBox label="선수 간선" value={stats.prereqEdgeCount} color="text-amber-300" />
          <StatBox label="교재 TOC" value={stats.tocUnitCount} color="text-orange-300" />
          <StatBox label="용어 사전" value={stats.dictionaryCount} color="text-violet-300" />
          <StatBox label="퀴즈/도서" value={`${stats.quizCount}/${stats.bookCount}`} color="text-pink-300" />
        </div>
      )}

      {/* 탭 스위처 (7대 영역 트리 / 도서 목록) */}
      <div className="grid grid-cols-2 border-b border-white/5 text-[11px] font-semibold">
        <button
          type="button"
          onClick={() => setTab("tree")}
          className={`flex items-center justify-center gap-1 py-2 border-b-2 transition-colors ${
            tab === "tree"
              ? "border-orange-500 text-orange-400 bg-orange-500/10"
              : "border-transparent text-gray-400 hover:text-gray-200"
          }`}
        >
          <FolderTree className="w-3.5 h-3.5" />
          <span>영역·단원 트리</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("books")}
          className={`flex items-center justify-center gap-1 py-2 border-b-2 transition-colors ${
            tab === "books"
              ? "border-orange-500 text-orange-400 bg-orange-500/10"
              : "border-transparent text-gray-400 hover:text-gray-200"
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>도서 ({books.length})</span>
        </button>
      </div>

      {/* 본문 리스트 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 text-xs">
        {tab === "tree" ? (
          l1Nodes.map((l1) => {
            const isOpen = openAreas.has(l1.id);
            const color = AREA_COLOR[l1.id] ?? "#9ca3af";
            // L1 아래 L2(PREREQUISITE) → L3 노드들
            const l3List = nodes
              .filter((n) => n.nodeType === "level" && n.level === 3 && areaMap.get(n.id) === l1.id)
              .sort((a, b) => (a.category === "과목" ? 1 : -1) - (b.category === "과목" ? 1 : -1) || (a.order ?? 99) - (b.order ?? 99));

            return (
              <div key={l1.id} className="rounded-lg border border-white/5 bg-white/[0.02]">
                <div className="flex items-center justify-between px-2 py-1.5 hover:bg-white/5 rounded-lg">
                  <button
                    type="button"
                    onClick={() => toggleArea(l1.id)}
                    className="flex items-center gap-1.5 text-left flex-1 min-w-0"
                  >
                    {isOpen ? (
                      <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    )}
                    <i className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                    <span className="font-bold text-gray-200 truncate">{AREA_NAMES[l1.id] ?? l1.label}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectNode(l1.id)}
                    className="text-[10px] text-gray-500 hover:text-orange-300 px-1"
                  >
                    포커스
                  </button>
                </div>

                {isOpen && (
                  <div className="pl-3 pr-1.5 pb-1.5 space-y-0.5 border-t border-white/5 pt-1">
                    {l3List.map((l3) => {
                      const l4Children = childrenOf(l3.id);
                      const isSel = selectedId === l3.id;
                      return (
                        <div key={l3.id} className="space-y-0.5">
                          <div
                            className={`flex items-center justify-between gap-1 px-2 py-1 rounded-md cursor-pointer ${
                              isSel ? "bg-orange-500/20 text-orange-300 font-semibold" : "hover:bg-white/5 text-gray-300"
                            }`}
                            onClick={() => onSelectNode(l3.id)}
                          >
                            <span className="truncate text-[11px]">
                              {l3.grade ? `중${l3.grade} · ` : ""}
                              {l3.label}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              {(l3.conceptCount ?? 0) > 0 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onExpandUnitConcepts(l3.id);
                                  }}
                                  title="이 단원의 수학 개념을 캔버스에 펼치기"
                                  className="px-1 py-px rounded bg-sky-500/20 text-sky-300 text-[9px] hover:bg-sky-500/30"
                                >
                                  개념 {l3.conceptCount}
                                </button>
                              )}
                            </div>
                          </div>

                          {l4Children.length > 0 && (
                            <div className="pl-3 border-l border-white/10 ml-2 space-y-0.5">
                              {l4Children.map((l4) => {
                                const isL4Sel = selectedId === l4.id;
                                return (
                                  <div
                                    key={l4.id}
                                    onClick={() => onSelectNode(l4.id)}
                                    className={`flex items-center justify-between gap-1 px-2 py-0.5 rounded cursor-pointer text-[11px] ${
                                      isL4Sel
                                        ? "bg-orange-500/20 text-orange-300 font-semibold"
                                        : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                                    }`}
                                  >
                                    <span className="truncate">{l4.label}</span>
                                    {(l4.conceptCount ?? 0) > 0 && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onExpandUnitConcepts(l4.id);
                                        }}
                                        title="이 대단원의 수학 개념을 캔버스에 펼치기"
                                        className="px-1 py-px rounded bg-sky-500/15 text-sky-300 text-[9px] hover:bg-sky-500/30 shrink-0"
                                      >
                                        +{l4.conceptCount}
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="space-y-1">
            {books.length === 0 && (
              <p className="text-[11px] text-gray-500 p-3 text-center">등록된 도서가 없습니다.</p>
            )}
            {books.map((b) => {
              const isSel = selectedId === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onSelectNode(b.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors flex flex-col gap-1 ${
                    isSel
                      ? "border-orange-500/60 bg-orange-500/15"
                      : "border-white/5 bg-white/[0.02] hover:bg-white/5"
                  }`}
                >
                  <span className="text-xs font-semibold text-gray-200 truncate">{b.title}</span>
                  <div className="flex flex-wrap gap-1.5 text-[10px] text-gray-400">
                    {b.tocUnitCount > 0 && <span className="text-orange-300">단원연결 {b.tocUnitCount}</span>}
                    {b.dictCount > 0 && <span className="text-violet-300">사전 {b.dictCount}</span>}
                    {b.quizCount > 0 && <span className="text-emerald-300">퀴즈 {b.quizCount}</span>}
                    {b.flashcardCount > 0 && <span className="text-sky-300">카드 {b.flashcardCount}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

function StatBox({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/5 px-2 py-1.5 flex flex-col">
      <span className="text-[9px] text-gray-500 truncate">{label}</span>
      <span className={`text-xs font-bold font-mono ${color}`}>{value}</span>
    </div>
  );
}

