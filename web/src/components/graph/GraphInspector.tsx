"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Check, Copy, ExternalLink, GitBranch, GraduationCap, Plus, Sparkles } from "lucide-react";
import MathView from "@/components/MathView";
import { api } from "@/lib/api";
import type { GraphEdgeDTO, GraphNodeDTO } from "@/lib/server/kgGraphQueries";
import { AREA_COLOR, AREA_NAMES, LEVEL_NAME } from "./layouts";

const CATEGORY_RANK: Record<string, number> = { 소단원: 1, 대단원: 2, 과목: 3 };
const KIND_NAME: Record<string, string> = {
  concept: "개념",
  theorem: "정리",
  property: "성질",
  formula: "공식",
  definition: "정의",
  strategy: "전략",
  method: "방법",
  info: "정보",
};

type ConceptSummary = {
  id: string;
  conceptId: number;
  sourceId: number;
  mergedCount: number;
  title: string;
  snippet: string;
  conceptType: string | null;
  mathField: string | null;
  schoolType: string | null;
  unitId: string;
  unitName: string;
  isPrimary: boolean;
  confidence: number | null;
  judgedBy: string;
  rationale: string | null;
};

type TocLinkItem = {
  id: number;
  unit_id: string;
  unit_name?: string;
  root_unit_id: string;
  node_id: string | null;
  book_stem?: string;
  book_title: string;
  toc_key: string;
  toc_label: string;
  toc_page: number | null;
  page: number | null;
  page_kind: string | null;
};

type DictRow = {
  id: number;
  book_stem?: string;
  book_title?: string;
  chapter_title: string | null;
  term: string;
  english_term: string | null;
  definition: string;
  formula: string | null;
  pages: number[];
};

type QuizRow = {
  id: number;
  chapter_title: string | null;
  question: string;
  options: { id: number; text: string }[];
  correct_option_id: number;
  explanation: string;
  pages: number[];
};

type FlashcardRow = {
  id: number;
  chapter_title: string | null;
  front: string;
  back: string;
  hint: string | null;
  formula: string | null;
};

export default function GraphInspector({
  selectedId,
  allNodes,
  allEdges,
  areaMap,
  primaryMap,
  onSelectNode,
  onExpandNode,
  onSetPrereq,
}: {
  selectedId: string | null;
  allNodes: GraphNodeDTO[];
  allEdges: GraphEdgeDTO[];
  areaMap: Map<string, string>;
  primaryMap: Map<string, string>;
  onSelectNode: (id: string) => void;
  onExpandNode: (id: string, types?: string[]) => void;
  onSetPrereq: (src: string, dst: string, on: boolean) => Promise<void>;
}) {
  const [tab, setTab] = useState<"overview" | "concepts" | "books">("overview");
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [prereqPick, setPrereqPick] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const node = selectedId ? byId.get(selectedId) ?? null : null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMsg(null);
    setPrereqPick("");
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let alive = true;
    setLoading(true);
    api(`/api/graph/node-detail?id=${encodeURIComponent(selectedId)}`)
      .then(async (r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        if (d?.nodeType === "book") setTab("books");
        else if (d?.nodeType === "concept") setTab("overview");
      })
      .catch(() => alive && setDetail(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [selectedId]);

  if (!selectedId) {
    return (
      <aside className="w-[390px] shrink-0 glass rounded-2xl p-5 flex flex-col justify-center items-center text-center gap-2 text-gray-500">
        <GitBranch className="w-8 h-8 text-gray-600 stroke-1" />
        <p className="text-xs font-semibold text-gray-400">노드를 선택하세요</p>
        <p className="text-[11px] leading-relaxed">
          캔버스나 좌측 트리에서 단원·수학 개념·도서 노드를 클릭하면 상세 속성, 수식 본문, 선수 관계 편집기, 교재·사전 연계 데이터를 확인합니다.
        </p>
      </aside>
    );
  }

  const areaId = areaMap.get(selectedId) ?? (node?.level === 1 ? selectedId : "");
  const areaColor = AREA_COLOR[areaId] ?? "#f97316";
  const nodeType = (detail?.nodeType as string) ?? node?.nodeType ?? "level";

  const copyId = () => {
    navigator.clipboard?.writeText(selectedId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const concepts: ConceptSummary[] = Array.isArray(detail?.concepts) ? (detail.concepts as ConceptSummary[]) : [];
  const tocLinks: TocLinkItem[] = Array.isArray(detail?.tocLinks) ? (detail.tocLinks as TocLinkItem[]) : [];
  const dictionary: DictRow[] = Array.isArray(detail?.dictionary) ? (detail.dictionary as DictRow[]) : [];
  const quizzes: QuizRow[] = Array.isArray(detail?.quizzes) ? (detail.quizzes as QuizRow[]) : [];
  const flashcards: FlashcardRow[] = Array.isArray(detail?.flashcards) ? (detail.flashcards as FlashcardRow[]) : [];

  return (
    <aside className="w-[390px] shrink-0 glass rounded-2xl flex flex-col overflow-hidden">
      {/* 공통 상단 헤더 */}
      <div className="p-3.5 border-b border-white/10 bg-white/[0.03] space-y-1.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
              style={{ backgroundColor: areaColor }}
            >
              {nodeType === "concept"
                ? "수학 개념"
                : nodeType === "book"
                  ? "도서"
                  : nodeType === "level_toc"
                    ? "단원 TOC"
                    : node?.category ?? (node?.level ? `Level ${node.level}` : nodeType)}
            </span>
            {AREA_NAMES[areaId] && (
              <span className="text-[10px] text-gray-400">{AREA_NAMES[areaId]}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={copyId}
              title="노드 ID 복사"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-white/10 text-[10px] text-gray-400 hover:text-white font-mono"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{selectedId.length > 18 ? `${selectedId.slice(0, 18)}…` : selectedId}</span>
            </button>
            {!selectedId.startsWith("concept:") && !selectedId.startsWith("ach:") && (
              <Link
                href={`/node?id=${encodeURIComponent(selectedId)}`}
                target="_blank"
                title="/node 상세 화면 열기"
                className="p-1 rounded border border-white/10 text-gray-400 hover:text-white"
              >
                <ExternalLink className="w-3 h-3" />
              </Link>
            )}
          </div>
        </div>

        <MathView
          as="h3"
          text={
            (detail?.concept as { title?: string } | undefined)?.title ??
            (detail?.title as string | undefined) ??
            (detail?.props as { name?: string; label?: string; title?: string } | undefined)?.name ??
            node?.label ??
            selectedId
          }
          className="text-sm font-bold text-gray-100 leading-snug"
        />
      </div>

      {/* 탭 바 (level / book 노드는 3개 탭, concept 등은 상세 탭) */}
      {(nodeType === "level" || nodeType === "level_toc" || nodeType === "book") && (
        <div className="grid grid-cols-3 border-b border-white/10 text-[11px] font-semibold shrink-0">
          <button
            type="button"
            onClick={() => setTab("overview")}
            className={`py-2 border-b-2 transition-colors ${
              tab === "overview"
                ? "border-orange-500 text-orange-400 bg-orange-500/10"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            상세·관계
          </button>
          <button
            type="button"
            onClick={() => setTab("concepts")}
            className={`py-2 border-b-2 transition-colors ${
              tab === "concepts"
                ? "border-orange-500 text-orange-400 bg-orange-500/10"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            수학 개념 ({concepts.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("books")}
            className={`py-2 border-b-2 transition-colors ${
              tab === "books"
                ? "border-orange-500 text-orange-400 bg-orange-500/10"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            교재·사전 ({tocLinks.length + dictionary.length})
          </button>
        </div>
      )}

      {/* 본문 영역 */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4 text-xs">
        {msg && (
          <p className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border ${msg.error ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"}`}>
            {msg.text}
          </p>
        )}
        {loading && <p className="text-xs text-gray-400">상세 정보를 불러오는 중…</p>}

        {/* Case A: 수학 개념 노드 상세 */}
        {!loading && nodeType === "concept" && detail?.concept != null && (
          <ConceptInspectorView
            detail={detail as unknown as ConceptDetailData}
            onSelectNode={onSelectNode}
            onExpandNode={() => onExpandNode(selectedId)}
          />
        )}

        {/* Case B: 탭 1 — 단원/일반 노드 상세 및 선수 관계 편집 */}
        {!loading && nodeType !== "concept" && tab === "overview" && (
          <LevelOverviewTab
            selectedId={selectedId}
            node={node}
            detail={detail}
            allNodes={allNodes}
            allEdges={allEdges}
            byId={byId}
            primaryMap={primaryMap}
            prereqPick={prereqPick}
            onPrereqPick={setPrereqPick}
            onSetPrereq={async (src, dst, on) => {
              try {
                await onSetPrereq(src, dst, on);
                setMsg({ text: on ? "선수 관계를 추가했습니다." : "선수 관계를 지웠습니다." });
              } catch (e) {
                setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
              }
            }}
            onSelectNode={onSelectNode}
            onExpandNode={(types) => onExpandNode(selectedId, types)}
          />
        )}

        {/* Case C: 탭 2 — 소속 수학 개념 목록 */}
        {!loading && nodeType !== "concept" && tab === "concepts" && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-gray-400">
                매핑된 개념 <b className="text-sky-300">{concepts.length}</b>개
              </span>
              {concepts.length > 0 && (
                <button
                  type="button"
                  onClick={() => onExpandNode(selectedId, ["concepts"])}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-200 text-[11px] font-semibold hover:bg-sky-500/30"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>캔버스에 개념 모두 표시</span>
                </button>
              )}
            </div>
            {concepts.length === 0 ? (
              <p className="text-[11px] text-gray-500 py-6 text-center">
                이 단원에 매핑된 수학 개념이 없습니다.
              </p>
            ) : (
              <div className="space-y-2">
                {concepts.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-xl border border-white/10 bg-white/[0.02] p-2.5 space-y-1 hover:border-sky-500/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-[10px] font-mono text-gray-500">#{c.sourceId}</span>
                        {c.conceptType && (
                          <span className="px-1.5 py-px rounded border border-white/10 text-[9px] text-gray-300">
                            {c.conceptType}
                          </span>
                        )}
                        {c.isPrimary ? (
                          <span className="px-1.5 py-px rounded bg-sky-500/20 text-[9px] text-sky-300 font-semibold">
                            주단원
                          </span>
                        ) : (
                          <span className="px-1.5 py-px rounded bg-white/10 text-[9px] text-gray-400">
                            부단원
                          </span>
                        )}
                        {c.confidence != null && (
                          <span className="text-[9px] text-gray-500">{Math.round(c.confidence * 100)}%</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onSelectNode(c.id)}
                        className="text-[10px] text-sky-300 hover:underline shrink-0"
                      >
                        열기 →
                      </button>
                    </div>
                    <MathView as="h4" text={c.title} className="text-xs font-semibold text-gray-100" />
                    {c.snippet && (
                      <MathView text={c.snippet} className="text-[11px] text-gray-400 line-clamp-2" />
                    )}
                    {c.rationale && (
                      <p className="text-[10px] text-gray-500 truncate">근거: {c.rationale}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Case D: 탭 3 — 교재 TOC · 용어 사전 · 퀴즈 · 플래시카드 */}
        {!loading && nodeType !== "concept" && tab === "books" && (
          <div className="space-y-4">
            {/* 연결된 도서 TOC */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h4 className="text-[11px] font-bold text-orange-300 flex items-center gap-1">
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>연결된 교재 목차 ({tocLinks.length})</span>
                </h4>
                {tocLinks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onExpandNode(selectedId, ["books", "children"])}
                    className="text-[10px] text-orange-300 hover:underline"
                  >
                    캔버스에 도서 표시
                  </button>
                )}
              </div>
              {tocLinks.length === 0 ? (
                <p className="text-[11px] text-gray-500">등록된 교재 TOC 항목이 없습니다.</p>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {tocLinks.map((t) => (
                    <div
                      key={t.id}
                      onClick={() => t.node_id && onSelectNode(t.node_id)}
                      className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 cursor-pointer hover:bg-white/5"
                    >
                      <div className="flex items-center justify-between gap-2 text-[10px] text-gray-400">
                        <span className="truncate text-orange-300 font-semibold">{t.book_title}</span>
                        {t.page && <span>{t.page}p</span>}
                      </div>
                      <p className="text-xs text-gray-200 truncate">{t.toc_label}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 용어 사전 */}
            <div className="space-y-1.5">
              <h4 className="text-[11px] font-bold text-violet-300 flex items-center gap-1">
                <GraduationCap className="w-3.5 h-3.5" />
                <span>개념 용어 사전 ({dictionary.length})</span>
              </h4>
              {dictionary.length === 0 ? (
                <p className="text-[11px] text-gray-500">연관된 사전 항목이 없습니다.</p>
              ) : (
                <div className="space-y-1.5">
                  {dictionary.map((d) => (
                    <details
                      key={d.id}
                      className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 group"
                    >
                      <summary className="cursor-pointer text-xs font-semibold text-gray-200 flex items-center justify-between">
                        <span>
                          {d.term}
                          {d.english_term && <span className="text-gray-500 font-normal"> ({d.english_term})</span>}
                        </span>
                        {d.pages?.length > 0 && (
                          <span className="text-[10px] text-gray-500">{d.pages[0]}p</span>
                        )}
                      </summary>
                      <div className="mt-1.5 pt-1.5 border-t border-white/5 space-y-1 text-[11px] text-gray-300">
                        <MathView text={d.definition} />
                        {d.formula && (
                          <MathView
                            text={d.formula}
                            isFormula
                            className="p-1.5 rounded bg-black/40 text-amber-200 font-mono text-[11px]"
                          />
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>

            {/* 퀴즈 및 플래시카드 요약 */}
            {(quizzes.length > 0 || flashcards.length > 0) && (
              <div className="space-y-1.5 pt-1 border-t border-white/10">
                <h4 className="text-[11px] font-bold text-emerald-300">
                  퀴즈 ({quizzes.length}) · 플래시카드 ({flashcards.length})
                </h4>
                {quizzes.slice(0, 8).map((qz) => (
                  <details key={qz.id} className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
                    <summary className="cursor-pointer text-[11px] text-gray-200 line-clamp-1">
                      Q. {qz.question}
                    </summary>
                    <div className="mt-1.5 pt-1.5 border-t border-white/5 space-y-1 text-[11px] text-gray-400">
                      <MathView text={qz.explanation} />
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

type ConceptDetailData = {
  id: string;
  concept: {
    id: number;
    sourceId: number;
    mergedSourceIds: number[];
    title: string;
    statement: string;
    images: string[];
    conceptType: string | null;
    mathField: string | null;
    curriculumType: string | null;
    schoolType: string | null;
    curriculumYear: string | null;
    difficultyLevel: number | null;
  };
  unitEdges: {
    id: number;
    unitId: string;
    unitName: string;
    unitLevel: number;
    isPrimary: boolean;
    isActive: boolean;
    confidence: number | null;
    judgedBy: string;
    rationale: string | null;
  }[];
  achievements: { achievement_code: string; judged_by: string }[];
  prereqConcepts: { id: string; sourceId: number; title: string }[];
  nextConcepts: { id: string; sourceId: number; title: string }[];
};

function ConceptInspectorView({
  detail,
  onSelectNode,
  onExpandNode,
}: {
  detail: ConceptDetailData;
  onSelectNode: (id: string) => void;
  onExpandNode: () => void;
}) {
  const c = detail.concept;
  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="px-2 py-0.5 rounded border border-white/15 bg-white/5 text-[10px] font-mono text-gray-300">
          원본 #{c.sourceId}
        </span>
        {c.mergedSourceIds.length > 0 && (
          <span className="px-2 py-0.5 rounded border border-orange-500/40 bg-orange-500/10 text-[10px] text-orange-300">
            병합 +{c.mergedSourceIds.length} ({c.mergedSourceIds.join(", ")})
          </span>
        )}
        {c.conceptType && (
          <span className="px-2 py-0.5 rounded border border-sky-500/40 bg-sky-500/10 text-[10px] text-sky-300">
            {c.conceptType}
          </span>
        )}
        {c.schoolType && (
          <span className="px-2 py-0.5 rounded border border-white/10 text-[10px] text-gray-400">
            {c.schoolType}
          </span>
        )}
        {c.mathField && (
          <span className="px-2 py-0.5 rounded border border-white/10 text-[10px] text-gray-400">
            {c.mathField}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onExpandNode}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-200 text-[11px] font-semibold hover:bg-sky-500/30"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>연결 단원·선수개념 펼치기</span>
        </button>
        <Link
          href={`/legacy2ontology?focus=${c.sourceId}`}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-white/15 text-gray-300 text-[11px] hover:bg-white/10"
        >
          <span>Legacy→KG에서 보기</span>
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {/* 수식 본문 뷰어 */}
      <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-2">
        <span className="text-[10px] font-bold text-gray-400 uppercase">개념 본문 (Statement)</span>
        <MathView
          text={c.statement || "(본문 없음)"}
          className="text-xs text-gray-200 whitespace-pre-line leading-relaxed break-words"
        />
        {c.images.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {c.images.map((src) => (
              <a key={src} href={src} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-16 rounded border border-white/10 bg-white" />
              </a>
            ))}
          </div>
        )}
      </div>

      {/* 매핑된 단원 목록 */}
      <div className="space-y-1.5">
        <span className="text-[11px] font-bold text-gray-300">
          단원 매핑 ({detail.unitEdges.filter((e) => e.isActive).length})
        </span>
        {detail.unitEdges.map((e) => (
          <div
            key={e.id}
            onClick={() => onSelectNode(e.unitId)}
            className={`rounded-lg border p-2 cursor-pointer transition-colors ${
              e.isActive
                ? "border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20"
                : "border-white/5 bg-black/20 opacity-50"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-100">{e.unitName}</span>
              <span className="text-[10px] text-sky-300">
                {e.isPrimary ? "주단원" : "부단원"}
                {!e.isActive && " (비활성)"}
                {e.confidence != null && ` · ${Math.round(e.confidence * 100)}%`}
              </span>
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5">
              판정: {e.judgedBy} · <span className="font-mono">{e.unitId}</span>
            </p>
            {e.rationale && <p className="text-[10px] text-gray-300 mt-0.5">{e.rationale}</p>}
          </div>
        ))}
      </div>

      {/* 성취기준 및 선수/후속 개념 */}
      {detail.achievements.length > 0 && (
        <div className="space-y-1">
          <span className="text-[11px] font-bold text-gray-300">성취기준</span>
          <div className="flex flex-wrap gap-1">
            {detail.achievements.map((a) => (
              <span
                key={a.achievement_code}
                className="px-2 py-0.5 rounded bg-purple-500/20 border border-purple-500/40 text-[10px] text-purple-200"
              >
                {a.achievement_code}
              </span>
            ))}
          </div>
        </div>
      )}

      {(detail.prereqConcepts.length > 0 || detail.nextConcepts.length > 0) && (
        <div className="space-y-1.5">
          {detail.prereqConcepts.length > 0 && (
            <div>
              <span className="text-[10px] font-bold text-sky-300">선수 개념 ({detail.prereqConcepts.length})</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {detail.prereqConcepts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelectNode(p.id)}
                    className="px-2 py-0.5 rounded border border-sky-500/30 bg-sky-500/10 text-[10px] text-sky-200 hover:bg-sky-500/20"
                  >
                    #{p.sourceId} {p.title}
                  </button>
                ))}
              </div>
            </div>
          )}
          {detail.nextConcepts.length > 0 && (
            <div>
              <span className="text-[10px] font-bold text-orange-300">후속 개념 ({detail.nextConcepts.length})</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {detail.nextConcepts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelectNode(p.id)}
                    className="px-2 py-0.5 rounded border border-orange-500/30 bg-orange-500/10 text-[10px] text-orange-200 hover:bg-orange-500/20"
                  >
                    #{p.sourceId} {p.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LevelOverviewTab({
  selectedId,
  node,
  detail,
  allNodes,
  allEdges,
  byId,
  primaryMap,
  prereqPick,
  onPrereqPick,
  onSetPrereq,
  onSelectNode,
  onExpandNode,
}: {
  selectedId: string;
  node: GraphNodeDTO | null;
  detail: Record<string, unknown> | null;
  allNodes: GraphNodeDTO[];
  allEdges: GraphEdgeDTO[];
  byId: Map<string, GraphNodeDTO>;
  primaryMap: Map<string, string>;
  prereqPick: string;
  onPrereqPick: (v: string) => void;
  onSetPrereq: (src: string, dst: string, on: boolean) => Promise<void>;
  onSelectNode: (id: string) => void;
  onExpandNode: (types?: string[]) => void;
}) {
  const labelOf = (id: string) => {
    const n = byId.get(id);
    if (!n) return id;
    if (n.grade) return `중${n.grade} · ${n.label}`;
    if ((n.level ?? 0) < 4) return n.label;
    const pName = byId.get(primaryMap.get(id) ?? "")?.label;
    return pName ? `${pName} · ${n.label}` : n.label;
  };

  const prereqs = allEdges.filter((e) => e.edgeType === "PREREQUISITE_OF" && e.dst === selectedId).map((e) => e.src);
  const nexts = allEdges.filter((e) => e.edgeType === "PREREQUISITE_OF" && e.src === selectedId).map((e) => e.dst);
  const appliesOut = allEdges.filter((e) => (e.edgeType === "APPLIES_TO" || e.edgeType === "DESCRIBES") && e.src === selectedId);
  const appliesIn = allEdges.filter((e) => (e.edgeType === "APPLIES_TO" || e.edgeType === "DESCRIBES") && e.dst === selectedId);

  const rank = (n: GraphNodeDTO) => CATEGORY_RANK[n.category ?? ""] ?? 0;
  const candidates =
    node && (node.level ?? 0) >= 3 && node.nodeType === "level"
      ? allNodes.filter(
          (n) =>
            n.nodeType === "level" &&
            (n.level ?? 0) >= 3 &&
            rank(n) <= rank(node) &&
            n.id !== selectedId &&
            !prereqs.includes(n.id)
        )
      : [];

  const props = (detail?.props as Record<string, unknown> | undefined) ?? {};
  const isLevel = node?.nodeType === "level" || node?.nodeType === "level_toc";

  return (
    <div className="space-y-3.5">
      {isLevel && node && (
        <>
          <p className="text-[11px] text-gray-400">
            Level {node.level} · {node.category ?? LEVEL_NAME[node.level ?? 0]}
            {node.grade ? ` · 중${node.grade}` : ""}
            {node.school === "high" ? " · 고등" : ""}
            {node.revisedCurriculum ? ` · ${node.revisedCurriculum} 개정` : ""}
            {node.kind ? ` · ${KIND_NAME[node.kind] ?? node.kind}` : ""}
          </p>

          <div className="grid grid-cols-3 gap-1.5 text-center">
            <div className="rounded-lg border border-white/10 bg-black/20 p-2">
              <div className="text-[10px] text-gray-500">하위 노드</div>
              <div className="text-xs font-bold text-gray-200">{node.childCount ?? 0}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-2">
              <div className="text-[10px] text-gray-500">수학 개념</div>
              <div className="text-xs font-bold text-sky-300">{node.conceptCount ?? 0}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-2">
              <div className="text-[10px] text-gray-500">교재 TOC</div>
              <div className="text-xs font-bold text-amber-300">{node.tocCount ?? 0}</div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onExpandNode()}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl bg-orange-500/20 border border-orange-500/40 text-orange-200 text-xs font-semibold hover:bg-orange-500/30"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>연결된 개념·하위단원·교재 캔버스에 펼치기</span>
          </button>
        </>
      )}

      {/* 문단/페이지 본문 미리보기 */}
      {typeof props.content === "string" && (
        <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-1">
          <span className="text-[10px] text-gray-400 font-bold">{String(props.kind ?? "문단")}</span>
          <MathView text={props.content} className="text-xs text-gray-200 whitespace-pre-line" />
        </div>
      )}

      {/* 선수 단원 편집기 (Level 3~5 단원) */}
      {node?.nodeType === "level" && (node.level ?? 0) >= 3 && (
        <div className="space-y-2 pt-2 border-t border-white/10">
          <span className="text-[11px] font-bold text-gray-300 block">
            선수 단원 ({prereqs.length}) → {node.label}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {prereqs.length === 0 && <span className="text-[11px] text-gray-500">등록된 선수 단원이 없습니다.</span>}
            {prereqs.map((p) => (
              <span
                key={p}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-sky-500/30 bg-sky-500/10 text-[11px] text-sky-200"
              >
                <button type="button" onClick={() => onSelectNode(p)} className="hover:underline">
                  {labelOf(p)}
                </button>
                <button
                  type="button"
                  onClick={() => onSetPrereq(p, selectedId, false)}
                  className="text-gray-400 hover:text-red-300 ml-0.5"
                  aria-label="선수 관계 삭제"
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          <div className="flex gap-1.5">
            <select
              value={prereqPick}
              onChange={(e) => onPrereqPick(e.target.value)}
              className="flex-1 bg-[#121824] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-orange-500"
            >
              <option value="">선수 단원 추가…</option>
              {["과목", "대단원", "소단원"].map((cat) => {
                const xs = candidates.filter((n) => n.category === cat);
                return xs.length ? (
                  <optgroup key={cat} label={cat}>
                    {xs.map((n) => (
                      <option key={n.id} value={n.id}>
                        {labelOf(n.id)}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </select>
            <button
              type="button"
              disabled={!prereqPick}
              onClick={() => onSetPrereq(prereqPick, selectedId, true).then(() => onPrereqPick(""))}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-40 shrink-0"
            >
              추가
            </button>
          </div>

          <div className="pt-1">
            <span className="text-[11px] font-bold text-gray-300 block">
              후속 단원 ({nexts.length}) ← {node.label}
            </span>
            <div className="flex flex-wrap gap-1 mt-1">
              {nexts.length === 0 && <span className="text-[11px] text-gray-500">-</span>}
              {nexts.map((nx) => (
                <button
                  key={nx}
                  type="button"
                  onClick={() => onSelectNode(nx)}
                  className="px-2 py-0.5 rounded-full border border-orange-500/30 bg-orange-500/10 text-[11px] text-orange-200 hover:bg-orange-500/20"
                >
                  {labelOf(nx)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 전략 적용(APPLIES_TO) / 교육과정 설명(DESCRIBES) 연결 */}
      {(appliesOut.length > 0 || appliesIn.length > 0) && (
        <div className="space-y-1.5 pt-2 border-t border-white/10">
          <span className="text-[11px] font-bold text-sky-300 block">전략 적용 · 교육과정 연결</span>
          <div className="flex flex-wrap gap-1">
            {appliesOut.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onSelectNode(e.dst)}
                className="px-2 py-0.5 rounded border border-sky-500/30 bg-sky-500/10 text-[10px] text-sky-200"
              >
                {e.edgeType} → {labelOf(e.dst)}
              </button>
            ))}
            {appliesIn.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onSelectNode(e.src)}
                className="px-2 py-0.5 rounded border border-violet-500/30 bg-violet-500/10 text-[10px] text-violet-200"
              >
                {labelOf(e.src)} → {e.edgeType}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
