"use client";

import { Link2, Network, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { LevelEdge, LevelNode, TocUnitLink } from "@/lib/graphDb";
import { flattenToc, stripExt } from "@/lib/toc";
import type { SelectedBook } from "@/lib/types";

type Props = {
  book: SelectedBook | null;
  kind: "main" | "commentary"; // 왼쪽 미리보기 본문/해설서
  page: number | null; // 왼쪽 미리보기 페이지
  onToast: (msg: string, type?: "success" | "error") => void;
};

type Group = { title: string; units: LevelNode[] };

const isStudy = (id: string) => id.startsWith("L3-STUDY-");

// 도서 입력 오른쪽 (선택은 언제나 노드 하나)
//   1. 대단원 토글: 중등·수학 학습(L3), 고등(L4)
//   2. 선택한 대단원 바로 아래 TOC 노드 토글. TOC 노드를 고르면 그 바로 아래 TOC 노드 줄이 이어진다.
//   3. 도서 TOC. '등록'은 그 항목을 선택한 노드 바로 아래 'Level n TOC' 노드로 넣고, 도서 정보와 왼쪽 미리보기 페이지를 함께 남긴다.
export default function TocUnitForm(props: Props) {
  const [network, setNetwork] = useState<{ nodes: LevelNode[]; edges: LevelEdge[] } | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null); // 선택한 대단원
  const [tocPath, setTocPath] = useState<string[]>([]); // 대단원 아래로 고른 TOC 노드 경로 (마지막이 선택 노드)
  const [unitLinks, setUnitLinks] = useState<TocUnitLink[]>([]); // 선택한 대단원 안의 TOC 노드

  useEffect(() => {
    api("/api/graph/levels")
      .then((r) => r.json())
      .then(setNetwork)
      .catch(() => props.onToast("과목 그물을 불러오지 못했습니다.", "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadUnitLinks = useCallback(async () => {
    if (!unitId) return setUnitLinks([]);
    const res = await api(`/api/graph/toc-units?units=${encodeURIComponent(unitId)}`);
    const links: TocUnitLink[] = (await res.json()).links || [];
    setUnitLinks(links);
    // 지워진 TOC 노드에서 경로를 자른다
    setTocPath((path) => {
      const cut = path.findIndex((id) => !links.some((l) => l.nodeId === id));
      return cut === -1 ? path : path.slice(0, cut);
    });
  }, [unitId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUnitLinks();
  }, [loadUnitLinks]);

  const { middle, high, unitName, levelOf } = useMemo(() => groupUnits(network), [network]);

  const selectUnit = (id: string) => {
    setUnitId((cur) => (cur === id ? null : id));
    setTocPath([]);
  };
  // depth 번째 줄의 TOC 노드 토글: 이미 선택 노드면 해제(상위로), 아니면 그 줄까지 경로를 바꾼다
  const selectToc = (depth: number, nodeId: string) =>
    setTocPath((path) => (path[depth] === nodeId && path.length === depth + 1 ? path.slice(0, depth) : [...path.slice(0, depth), nodeId]));

  const selectedNode = tocPath.at(-1) ?? unitId;
  const selectedName = !selectedNode
    ? null
    : selectedNode === unitId
      ? unitName(unitId)
      : `${unitName(unitId!)} › ${tocPath.map((id) => unitLinks.find((l) => l.nodeId === id)?.tocLabel ?? id).join(" › ")}`;

  return (
    <section className="w-1/2 flex flex-col glass rounded-2xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/5 bg-white/5 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 shrink-0">
          <Network className="w-4 h-4 text-orange-400" />
          <h2 className="text-xs font-bold text-gray-300">Knowledge Graph 입력</h2>
        </div>
        <span className="text-[10px] text-gray-500 truncate" title={selectedName ?? ""}>
          {selectedName ? (
            <>
              등록 위치: <span className="text-violet-300 font-bold">{selectedName}</span>
            </>
          ) : (
            "대단원을 선택하세요"
          )}
        </span>
      </div>

      {/* 1. 대단원 */}
      <div className="shrink-0 max-h-[35%] overflow-y-auto p-3 space-y-3 border-b border-white/5">
        {!network ? (
          <p className="text-xs text-gray-500">과목 그물을 불러오는 중...</p>
        ) : (
          <>
            <UnitGroups title="Level 3 · 중등 대단원 · 수학 학습 대단원" groups={middle} unitId={unitId} onSelect={selectUnit} hasPath={tocPath.length > 0} color="sky" />
            <UnitGroups title="Level 4 · 고등 대단원" groups={high} unitId={unitId} onSelect={selectUnit} hasPath={tocPath.length > 0} color="orange" />
          </>
        )}
      </div>

      {/* 2. 선택한 대단원 아래 TOC 노드 */}
      <div className="shrink-0 max-h-[25%] min-h-[64px] overflow-y-auto p-3 border-b border-white/5 bg-black/10">
        {!unitId ? (
          <p className="text-[11px] text-gray-500">대단원을 선택하면 그 바로 아래 TOC 노드가 여기에 표시됩니다.</p>
        ) : (
          <TocNodeRows
            unitId={unitId}
            baseLevel={(levelOf(unitId) ?? 3) + 1}
            links={unitLinks}
            path={tocPath}
            onSelect={selectToc}
          />
        )}
      </div>

      {/* 3. 도서 TOC */}
      {props.book ? (
        <BookToc
          key={`${props.book.source}:${props.book.sourceId}`}
          {...props}
          book={props.book}
          parentId={selectedNode}
          parentName={selectedName}
          unitName={unitName}
          unitLinks={unitLinks}
          onChanged={loadUnitLinks}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-gray-500">상단에서 도서를 선택하면 TOC가 표시됩니다.</p>
        </div>
      )}
    </section>
  );
}

// 중등 대단원은 학년별(+ 수학 학습 대단원), 고등 대단원은 과목별
function groupUnits(network: { nodes: LevelNode[]; edges: LevelEdge[] } | null) {
  const nodes = network?.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parentOf = new Map<string, string>();
  for (const e of network?.edges ?? []) if (e.type === "HAS_CHILD") parentOf.set(e.dst, e.src);

  const middleUnits = nodes.filter((n) => n.level === 3 && n.category === "대단원");
  const middle: Group[] = [1, 2, 3]
    .map((g) => ({ title: `중${g}`, units: middleUnits.filter((n) => n.grade === g).sort((a, b) => a.order - b.order) }))
    .filter((g) => g.units.length > 0);
  const study = middleUnits.filter((n) => isStudy(n.id)).sort((a, b) => a.order - b.order);
  if (study.length > 0) middle.push({ title: "수학 학습", units: study });

  const subjects = nodes.filter((n) => n.level === 3 && n.category === "과목" && n.school === "high").sort((a, b) => a.order - b.order);
  const highUnits = nodes.filter((n) => n.level === 4 && n.category === "대단원");
  const high: Group[] = subjects
    .map((s) => ({ title: s.name, units: highUnits.filter((n) => parentOf.get(n.id) === s.id).sort((a, b) => a.order - b.order) }))
    .filter((g) => g.units.length > 0);

  // 대단원 표시 이름
  const unitName = (id: string) => {
    const n = byId.get(id);
    if (!n) return id;
    const parent = n.level === 4 ? byId.get(parentOf.get(id) ?? "") : null;
    return parent ? `${parent.name} · ${n.name}` : n.grade ? `중${n.grade} · ${n.name}` : n.name;
  };
  const levelOf = (id: string) => byId.get(id)?.level;
  return { middle, high, unitName, levelOf };
}

const toggleColor = {
  sky: { on: "border-sky-500 bg-sky-500/25 text-sky-300 font-bold", chip: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  orange: { on: "border-orange-500 bg-orange-500/25 text-orange-300 font-bold", chip: "border-orange-500/40 bg-orange-500/10 text-orange-300" },
  violet: { on: "border-violet-500 bg-violet-500/25 text-violet-300 font-bold", chip: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
};
const toggleIdle = "border-white/10 bg-white/5 text-gray-400 hover:border-white/25";
const togglePath = "border-white/40 bg-white/10 text-gray-200"; // 선택 노드의 상위 (경로)

function UnitGroups({
  title,
  groups,
  unitId,
  hasPath,
  onSelect,
  color,
}: {
  title: string;
  groups: Group[];
  unitId: string | null;
  hasPath: boolean; // 대단원 아래 TOC 노드가 선택돼 있으면 대단원은 경로로 표시
  onSelect: (id: string) => void;
  color: keyof typeof toggleColor;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{title}</div>
      {groups.length === 0 && <p className="text-[10px] text-gray-500">대단원이 없습니다.</p>}
      {groups.map((g) => (
        <div key={g.title} className="flex gap-2">
          <span className="w-20 shrink-0 pt-0.5 text-[10px] font-bold text-gray-500 truncate" title={g.title}>
            {g.title}
          </span>
          <div className="flex flex-wrap gap-1">
            {g.units.map((u) => (
              <button
                key={u.id}
                onClick={() => onSelect(u.id)}
                aria-pressed={unitId === u.id && !hasPath}
                className={`px-2 py-0.5 rounded-md border text-[11px] transition-colors ${
                  unitId !== u.id ? toggleIdle : hasPath ? togglePath : toggleColor[color].on
                }`}
              >
                {u.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// 선택한 대단원 바로 아래 TOC 노드 한 줄, 고른 TOC 노드가 있으면 그 바로 아래 줄을 이어서 보여 준다
function TocNodeRows({
  unitId,
  baseLevel,
  links,
  path,
  onSelect,
}: {
  unitId: string;
  baseLevel: number;
  links: TocUnitLink[];
  path: string[];
  onSelect: (depth: number, nodeId: string) => void;
}) {
  const parents = [unitId, ...path];
  const rows = parents
    .map((p) => links.filter((l) => l.unitId === p))
    .filter((row, i) => row.length > 0 || i === 0);
  return (
    <div className="space-y-1.5">
      {rows.map((row, depth) => (
        <div key={depth} className="flex gap-2">
          <span className="w-20 shrink-0 pt-0.5 text-[10px] font-bold text-gray-500">Level {baseLevel + depth} TOC</span>
          {row.length === 0 ? (
            <span className="text-[11px] text-gray-500 pt-0.5">등록된 TOC 노드가 없습니다. 아래 TOC에서 &apos;등록&apos;하세요.</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {row.map((l) => {
                const last = path.length === depth + 1 && path[depth] === l.nodeId;
                const onPath = path[depth] === l.nodeId && !last;
                return (
                  <button
                    key={l.id}
                    onClick={() => onSelect(depth, l.nodeId)}
                    aria-pressed={last}
                    className={`px-2 py-0.5 rounded-md border text-[11px] transition-colors ${last ? toggleColor.violet.on : onPath ? togglePath : toggleIdle}`}
                    title={`${l.nodeId} · ${l.bookTitle}${l.page != null ? ` · ${l.pageKind === "commentary" ? "해설서" : "본문"} ${l.page}p` : ""}`}
                  >
                    {l.tocLabel}
                    <span className="ml-1.5 opacity-50">{l.bookTitle}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function BookToc({
  book,
  kind,
  page,
  onToast,
  parentId,
  parentName,
  unitName,
  unitLinks,
  onChanged,
}: Props & {
  book: SelectedBook;
  parentId: string | null;
  parentName: string | null;
  unitName: (id: string) => string;
  unitLinks: TocUnitLink[];
  onChanged: () => Promise<void>;
}) {
  const tocNodes = useMemo(() => flattenToc(book.toc), [book]);
  const [links, setLinks] = useState<TocUnitLink[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const loadLinks = async () => {
    const res = await api(`/api/graph/toc-units?stem=${encodeURIComponent(book.stem)}`);
    setLinks((await res.json()).links || []);
  };
  useEffect(() => {
    let cancelled = false;
    api(`/api/graph/toc-units?stem=${encodeURIComponent(book.stem)}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setLinks(d.links || []));
    return () => {
      cancelled = true;
    };
  }, [book.stem]);

  const register = async (t: (typeof tocNodes)[number]) => {
    if (!parentId) return;
    setBusy(t.key);
    try {
      const res = await api("/api/graph/toc-units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stem: book.stem,
          title: stripExt(book.title),
          documentId: book.documentId,
          toc: { key: t.key, level: t.level, label: t.label, page: t.page },
          parentIds: [parentId],
          pageKind: page != null ? kind : null,
          page,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onToast(`'${t.label}'을(를) ${parentName} 아래 TOC 노드로 등록했습니다.`);
      await Promise.all([loadLinks(), onChanged()]);
    } catch (e) {
      onToast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const unregister = async (id: number) => {
    const res = await api(`/api/graph/toc-units?id=${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) return onToast(data.error, "error");
    if (data.deleted > 1) onToast(`하위 등록을 포함해 TOC 노드 ${data.deleted}개를 지웠습니다.`);
    await Promise.all([loadLinks(), onChanged()]);
  };

  const linksByKey = useMemo(() => {
    const m = new Map<string, TocUnitLink[]>();
    for (const l of links) m.set(l.tocKey, [...(m.get(l.tocKey) ?? []), l]);
    return m;
  }, [links]);

  // 등록 위치 표시: 대단원, 또는 '대단원 › 상위 TOC'
  const placeName = (l: TocUnitLink) => {
    if (l.unitId === l.rootUnitId) return unitName(l.rootUnitId);
    const parent = links.find((p) => p.nodeId === l.unitId) ?? unitLinks.find((p) => p.nodeId === l.unitId);
    return `${unitName(l.rootUnitId)} › ${parent?.tocLabel ?? l.unitId}`;
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b border-white/5 flex items-center justify-between gap-2 shrink-0">
        <span className="text-xs font-bold text-gray-300 truncate">
          {stripExt(book.title)} <span className="text-gray-500 font-normal">· TOC {tocNodes.length}개 · 등록 {links.length}건</span>
        </span>
        <span className="text-[10px] text-gray-500 font-mono shrink-0">
          미리보기: {kind === "main" ? "본문" : "해설서"} {page ?? "-"}p
        </span>
      </div>
      <ul className="flex-1 overflow-y-auto px-3 py-2 text-[11px]">
        {tocNodes.length === 0 && <li className="text-gray-500 text-center py-6">이 도서에는 TOC가 없습니다.</li>}
        {tocNodes.map((t) => {
          const tLinks = linksByKey.get(t.key) ?? [];
          return (
            <li
              key={t.key}
              className={`flex items-start gap-2 py-1 border-b border-white/5 ${t.level === "chapter" ? "" : t.level === "section" ? "pl-4" : "pl-8"}`}
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`truncate ${t.level === "chapter" ? "text-orange-400 font-bold" : t.level === "section" ? "text-blue-400" : "text-gray-300"}`}
                    title={t.label}
                  >
                    {t.label}
                  </span>
                  <span className="text-gray-500 font-mono shrink-0">{t.page ?? "-"}p</span>
                </div>
                {tLinks.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tLinks.map((l) => (
                      <span
                        key={l.id}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] ${
                          toggleColor[l.unitId !== l.rootUnitId ? "violet" : l.rootUnitId.startsWith("L4-") ? "orange" : "sky"].chip
                        }`}
                        title={`${l.nodeId} · ${l.createdBy} · ${l.updatedAt}${l.page != null ? ` · ${l.pageKind === "commentary" ? "해설서" : "본문"} ${l.page}p` : ""}`}
                      >
                        {placeName(l)}
                        {l.page != null && <span className="opacity-60">· {l.page}p</span>}
                        <button onClick={() => unregister(l.id)} className="hover:text-white" title="등록 해제 (그 아래 등록도 함께 지움)">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => register(t)}
                disabled={!parentId || busy != null}
                title={!parentId ? "먼저 위에서 대단원(또는 TOC 노드)을 선택하세요" : `${parentName} 아래 TOC 노드로 등록 (미리보기 ${page ?? "-"}p)`}
                className="shrink-0 px-2 py-0.5 text-[10px] font-bold rounded-md bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1 disabled:opacity-30"
              >
                <Link2 className="w-3 h-3" /> {busy === t.key ? "등록 중" : "등록"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
