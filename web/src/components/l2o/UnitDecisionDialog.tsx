"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pin } from "lucide-react";
import { api } from "@/lib/api";
import { SELECTORS, type SelectorName } from "@/lib/l2o/types";

type Unit = { unitId: string; path: string };
type Cands = { status: string; currentUnitId: string | null; suggestedUnitId: string | null; candidates: Unit[]; all: Unit[] };
type Vote = { selector: SelectorName; unitId: string | null; unitPath: string | null; confidence: number | null; error: string | null; reason: string | null };
const LABEL: Record<SelectorName, string> = { jev: "JEV", claude: "Claude", gemini: "Gemini" };

const SUBJECT_ORDER = [
  "중1",
  "중2",
  "중3",
  "공통 수학1",
  "공통 수학2",
  "대수",
  "미적분Ⅰ",
  "확률과 통계",
  "미적분Ⅱ",
  "기하",
];

type TreeUnit = {
  unitId: string;
  path: string;
  unitName: string;
  areaName?: string;
};

type SubjectNode = {
  key: string;
  name: string;
  units: TreeUnit[];
};

type SchoolNode = {
  key: "MID" | "HIGH" | "STUDY";
  name: string;
  subjects: SubjectNode[];
};

function buildUnitTree(all: Unit[], query: string): SchoolNode[] {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? all.filter((u) => u.path.toLowerCase().includes(q) || u.unitId.toLowerCase().includes(q))
    : all;

  const midMap = new Map<string, TreeUnit[]>();
  const highMap = new Map<string, TreeUnit[]>();
  const study: TreeUnit[] = [];

  for (const u of filtered) {
    const parts = u.path.split(" > ");
    if (u.unitId.startsWith("L3-STUDY-")) {
      study.push({ unitId: u.unitId, path: u.path, unitName: parts[parts.length - 1] ?? u.path });
      continue;
    }
    const isHigh = u.unitId.startsWith("L4-H") || parts[0] === "고등";
    if (isHigh) {
      const subject = parts[1] ?? "기타";
      const unitName = parts[2] ?? parts[parts.length - 1] ?? u.path;
      const list = highMap.get(subject) ?? [];
      list.push({ unitId: u.unitId, path: u.path, unitName });
      highMap.set(subject, list);
    } else {
      const subject = parts[0] ?? "중등";
      const areaName = parts.length >= 3 ? parts[1] : undefined;
      const unitName = parts[parts.length - 1] ?? u.path;
      const list = midMap.get(subject) ?? [];
      list.push({ unitId: u.unitId, path: u.path, unitName, areaName });
      midMap.set(subject, list);
    }
  }

  const sortSubjects = (entries: [string, TreeUnit[]][], prefix: string): SubjectNode[] =>
    entries
      .sort(([a], [b]) => {
        const ia = SUBJECT_ORDER.indexOf(a);
        const ib = SUBJECT_ORDER.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.localeCompare(b, "ko");
      })
      .map(([name, units]) => ({
        key: `${prefix}:${name}`,
        name: name === "중1" ? "중학 수학 1 (중1)" : name === "중2" ? "중학 수학 2 (중2)" : name === "중3" ? "중학 수학 3 (중3)" : name,
        units: [...units].sort((a, b) => a.unitId.localeCompare(b.unitId)),
      }));

  const schools: SchoolNode[] = [];
  if (midMap.size > 0) {
    schools.push({
      key: "MID",
      name: "중학교 과정",
      subjects: sortSubjects([...midMap.entries()], "MID"),
    });
  }
  if (highMap.size > 0) {
    schools.push({
      key: "HIGH",
      name: "고등학교 과정",
      subjects: sortSubjects([...highMap.entries()], "HIGH"),
    });
  }
  // 수학 외 항목(학습법·문제 해결 전략·평가·교육과정 설명 등)용
  if (study.length > 0) {
    schools.push({
      key: "STUDY",
      name: "수학 학습 (수학 외)",
      subjects: [{ key: "STUDY:수학 학습", name: "수학 학습", units: study.sort((a, b) => a.unitId.localeCompare(b.unitId)) }],
    });
  }
  return schools;
}

// 단원 결정/수정 창: 3표와 이유 + 전체 과목·단원 트리뷰(기본 펼침) + 단원명 오른쪽 핀 클릭 시 즉시 KG 확정
export default function UnitDecisionDialog({
  groupId,
  title,
  onClose,
  onDone,
}: {
  groupId: number;
  title: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [cands, setCands] = useState<Cands | null>(null);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [reason, setReason] = useState("");
  const [savingUnitId, setSavingUnitId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    Promise.all([api(`/api/l2o/units/candidates?groupId=${groupId}`), api(`/api/l2o/history?groupId=${groupId}`)])
      .then(async ([a, b]) => {
        const c = await a.json();
        const h = await b.json();
        if (!a.ok) throw new Error(c.error ?? `HTTP ${a.status}`);
        if (!alive) return;
        setCands(c);
        // 선택기별 최신 표 1개씩
        const latest = new Map<string, Vote>();
        for (const v of (h.votes ?? []) as Vote[]) if (!latest.has(v.selector)) latest.set(v.selector, v);
        setVotes(SELECTORS.map((s) => latest.get(s)).filter((v): v is Vote => !!v));
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [groupId]);

  const tree = useMemo(() => (cands ? buildUnitTree(cands.all, q) : []), [cands, q]);
  const editing = !!cands?.currentUnitId;

  const toggleNode = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const confirmUnit = async (unitId: string, unitPath: string) => {
    if (savingUnitId) return;
    setSavingUnitId(unitId);
    setError(null);
    try {
      const r = await api("/api/l2o/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, unitId, reason }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      onDone(`그룹 ${groupId}: ${unitPath} 로 결정 · KG ${d.kg.created ? "개념 생성" : "개념 갱신"} / 엣지 ${d.kg.edge}${d.kg.retiredEdges ? ` (비활성 ${d.kg.retiredEdges})` : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingUnitId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="glass bg-[#0f1420] rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col p-5 gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between shrink-0">
          <h3 className="text-sm font-bold">
            {editing ? "단원 수정" : "단원 결정"} · 그룹 {groupId}{" "}
            <span className="text-gray-400 font-normal">{title}</span>
          </h3>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-white">
            닫기
          </button>
        </div>

        {error && <p className="text-[11px] text-red-300 shrink-0">{error}</p>}
        {!cands && !error && <p className="text-[11px] text-gray-400">불러오는 중…</p>}

        {cands && (
          <>
            {/* 3개 선택기 투표 요약 */}
            <div className="flex flex-col gap-1 text-[11px] shrink-0 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              {votes.length === 0 && <p className="text-gray-500">선택기 표가 아직 없습니다.</p>}
              {votes.map((v) => (
                <p key={v.selector} className="text-gray-300">
                  <b className="text-gray-100">{LABEL[v.selector]}</b> ·{" "}
                  {v.error ? (
                    <span className="text-red-300">오류: {v.error.slice(0, 120)}</span>
                  ) : (
                    (v.unitPath ?? "판단 불가")
                  )}
                  {v.confidence != null && !v.error && (
                    <span className="text-gray-500"> {Math.round(v.confidence * 100)}%</span>
                  )}
                  {v.reason && <span className="text-gray-400"> — {v.reason}</span>}
                </p>
              ))}
            </div>

            {/* 검색 및 사유 입력 바 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 shrink-0">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="과목·단원 필터 (예: 수열, 미적분, L4-HALG)"
                className="rounded border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-gray-100 outline-none focus:border-orange-400"
              />
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="결정 사유 (선택 입력 후 단원 핀 클릭)"
                className="rounded border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-gray-100 outline-none focus:border-orange-400"
              />
            </div>

            {/* 전체 과목 · 단원 트리뷰 (기본 전체 펼침) */}
            <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-3">
              {tree.length === 0 ? (
                <p className="text-xs text-gray-500 p-4 text-center">일치하는 과목·단원이 없습니다.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                  {tree.map((school) => {
                    const schoolOpen = !collapsed.has(school.key);
                    return (
                      <div key={school.key} className="flex flex-col gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleNode(school.key)}
                          className="flex items-center gap-1.5 text-xs font-bold text-orange-300 hover:text-orange-200 py-1 px-1.5 rounded hover:bg-white/5 text-left"
                        >
                          {schoolOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <span>{school.name}</span>
                        </button>

                        {schoolOpen && (
                          <div className="flex flex-col gap-2 pl-2 border-l border-white/10 ml-2">
                            {school.subjects.map((subj) => {
                              const subjOpen = !collapsed.has(subj.key);
                              return (
                                <div key={subj.key} className="flex flex-col gap-0.5">
                                  <button
                                    type="button"
                                    onClick={() => toggleNode(subj.key)}
                                    className="flex items-center gap-1 text-xs font-semibold text-gray-200 hover:text-white py-0.5 px-1.5 rounded hover:bg-white/5 text-left"
                                  >
                                    {subjOpen ? (
                                      <ChevronDown size={13} className="text-gray-400 shrink-0" />
                                    ) : (
                                      <ChevronRight size={13} className="text-gray-400 shrink-0" />
                                    )}
                                    <span>{subj.name}</span>
                                    <span className="text-[10px] text-gray-500 font-normal ml-1">
                                      ({subj.units.length})
                                    </span>
                                  </button>

                                  {subjOpen && (
                                    <div className="flex flex-col gap-0.5 pl-3 border-l border-white/10 ml-2">
                                      {subj.units.map((u) => {
                                        const isSuggested = u.unitId === cands.suggestedUnitId;
                                        const isCurrent = u.unitId === cands.currentUnitId;
                                        const unitVotes = votes.filter((v) => v.unitId === u.unitId);
                                        const isSaving = savingUnitId === u.unitId;
                                        return (
                                          <div
                                            key={u.unitId}
                                            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors hover:bg-white/10 ${
                                              isCurrent
                                                ? "bg-emerald-500/15 border border-emerald-500/30"
                                                : isSuggested
                                                  ? "bg-amber-500/15 border border-amber-500/30"
                                                  : unitVotes.length > 0
                                                    ? "bg-sky-500/10 border border-sky-500/20"
                                                    : ""
                                            }`}
                                          >
                                            <span className="text-gray-100">{u.unitName}</span>
                                            <button
                                              type="button"
                                              onClick={() => confirmUnit(u.unitId, u.path)}
                                              disabled={savingUnitId !== null}
                                              title={`${u.path} 단원으로 확정 (즉시 KG 반영)`}
                                              className="p-0.5 rounded text-amber-300 hover:bg-orange-500/25 hover:text-orange-200 disabled:opacity-40 shrink-0"
                                            >
                                              <Pin size={12} />
                                            </button>
                                            {u.areaName && (
                                              <span className="text-[10px] text-gray-500">{u.areaName}</span>
                                            )}
                                            {isSaving && (
                                              <span className="text-[10px] text-orange-300">기록 중…</span>
                                            )}
                                            {isSuggested && (
                                              <span className="px-1 py-px rounded bg-amber-500/20 text-[10px] text-amber-300">
                                                제안
                                              </span>
                                            )}
                                            {isCurrent && (
                                              <span className="px-1 py-px rounded bg-emerald-500/20 text-[10px] text-emerald-300">
                                                현재
                                              </span>
                                            )}
                                            {unitVotes.map((v) => (
                                              <span
                                                key={v.selector}
                                                className="px-1 py-px rounded bg-sky-500/20 text-[10px] text-sky-300"
                                              >
                                                {LABEL[v.selector]}
                                              </span>
                                            ))}
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
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
