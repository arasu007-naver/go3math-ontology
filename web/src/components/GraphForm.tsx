"use client";

import { BookPlus, Network, RefreshCw, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { itemBodyRaw } from "@/lib/format";
import { flattenToc, kindForCategory, stripExt, tocKeyForPage } from "@/lib/toc";
import { PARAGRAPH_KINDS, type ParagraphKind, type ProblemRef, type SavedPage, type SelectedBook, type TocNodeInput } from "@/lib/types";
import type { JsonState } from "./PreviewColumn";

// 스펙의 시작 교재 순서
const SOURCE_BOOKS = ["이론 수학 대전", "과학고 수학 불패", "증명 수학", "알파테크닉 수학", "실력 정석"];

type Row = {
  idx: number; // 추출 JSON 안의 위치 = 그래프 문단 id
  include: boolean;
  category: string;
  kind: ParagraphKind;
  content: string;
  answersTo: string; // "" | "local:<row>" | 그래프 문단 id
};

type BookSummary = { title: string; sourceOrder: number | null; pageOffset?: number; updatedAt: string; counts: Record<string, number> } | null;

type Props = {
  book: SelectedBook | null;
  kind: "main" | "commentary";
  page: number | null;
  imageUrl: string | null;
  json: JsonState;
  onToast: (msg: string, type?: "success" | "error") => void;
};

type CurriculumOption = { id: string; name: string; level?: string };

const label = "text-[10px] font-bold text-gray-400 uppercase tracking-wide";
const input =
  "w-full bg-[#121824] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-orange-500 transition-colors";

export default function GraphForm(props: Props) {
  if (!props.book) {
    return (
      <section className="w-1/2 flex flex-col glass rounded-2xl overflow-hidden items-center justify-center">
        <p className="text-xs text-gray-500">상단에서 도서를 선택하면 knowledge graph 입력 폼이 표시됩니다.</p>
      </section>
    );
  }
  return <BookGraphForm key={`${props.book.source}:${props.book.sourceId}`} {...props} book={props.book} />;
}

function guessSourceOrder(title: string) {
  const i = SOURCE_BOOKS.findIndex((s) => title.replace(/\s/g, "").includes(s.replace(/\s/g, "")));
  return i === -1 ? "" : String(i + 1);
}

function BookGraphForm({ book, kind, page, imageUrl, json, onToast }: Props & { book: SelectedBook }) {
  const tocNodes = useMemo(() => flattenToc(book.toc), [book]);

  // --- 도서 ---
  const [title, setTitle] = useState(stripExt(book.title));
  const [sourceOrder, setSourceOrder] = useState<string>(() => guessSourceOrder(book.title));
  const [pageOffset, setPageOffset] = useState("0");
  const [summary, setSummary] = useState<BookSummary>(null);
  const [savingBook, setSavingBook] = useState(false);
  const [problems, setProblems] = useState<ProblemRef[]>([]);
  // 교육과정·과목 노드와 TOC 항목별 대응
  const [curriculum, setCurriculum] = useState<CurriculumOption[]>([]);
  const [mappings, setMappings] = useState<Record<string, string[]>>({});

  const loadSummary = useCallback(async () => {
    const res = await api(`/api/graph/book?stem=${encodeURIComponent(book.stem)}`);
    const data = await res.json();
    setSummary(data.book);
    return data.book as BookSummary;
  }, [book.stem]);

  const loadProblems = useCallback(async () => {
    const res = await api(`/api/graph/problems?stem=${encodeURIComponent(book.stem)}`);
    setProblems((await res.json()).problems || []);
  }, [book.stem]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api(`/api/graph/book?stem=${encodeURIComponent(book.stem)}`).then((r) => r.json()),
      api(`/api/graph/problems?stem=${encodeURIComponent(book.stem)}`).then((r) => r.json()),
      api(`/api/graph/network`).then((r) => r.json()),
      api(`/api/graph/mapping?stem=${encodeURIComponent(book.stem)}`).then((r) => r.json()),
    ]).then(([b, p, net, m]) => {
      if (cancelled) return;
      setSummary(b.book);
      setProblems(p.problems || []);
      setCurriculum(((net.nodes || []) as (CurriculumOption & { type: string })[]).filter((n) => n.type === "curriculum"));
      setMappings(m.mappings || {});
      if (b.book) {
        setTitle(b.book.title);
        setSourceOrder(b.book.sourceOrder ? String(b.book.sourceOrder) : "");
        setPageOffset(String(b.book.pageOffset ?? 0));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [book.stem]);

  const saveBook = async () => {
    setSavingBook(true);
    try {
      const res = await api("/api/graph/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stem: book.stem,
          title: title.trim() || stripExt(book.title),
          documentId: book.documentId,
          sourceOrder: sourceOrder ? Number(sourceOrder) : null,
          pageOffset: Number(pageOffset) || 0,
          commentaryStem: book.commentaryStem,
          toc: tocNodes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onToast(`도서와 TOC 항목 ${data.tocCount}개를 저장했습니다.`);
      await loadSummary();
    } catch (e) {
      onToast((e as Error).message, "error");
    } finally {
      setSavingBook(false);
    }
  };

  const bookSaved = summary != null;

  return (
    <section className="w-1/2 flex flex-col glass rounded-2xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/5 bg-white/5 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-orange-400" />
          <h2 className="text-xs font-bold text-gray-300">Knowledge Graph 입력</h2>
        </div>
        <span
          className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded border ${
            bookSaved ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-white/10 bg-white/5 text-gray-400"
          }`}
        >
          {bookSaved
            ? `그래프: TOC ${summary.counts.toc || 0} · 페이지 ${summary.counts.page || 0} · 문단 ${summary.counts.paragraph || 0}`
            : "그래프에 없는 도서"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 1. 도서 */}
        <fieldset className="p-3.5 rounded-xl bg-white/5 border border-white/5 space-y-3">
          <legend className="px-1 text-xs font-bold text-orange-400">1. 도서 · TOC</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 col-span-2">
              <span className={label}>도서명</span>
              <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className={label}>시작 교재 순서</span>
              <select className={input} value={sourceOrder} onChange={(e) => setSourceOrder(e.target.value)}>
                <option value="">(순서 외)</option>
                {SOURCE_BOOKS.map((s, i) => (
                  <option key={s} value={i + 1}>
                    {i + 1}. {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={label}>documentId</span>
              <input className={`${input} text-gray-500`} value={book.documentId ?? "-"} readOnly />
            </label>
            <label className="space-y-1 col-span-2">
              <span className={label}>페이지 보정값 (PDF 페이지 = TOC 페이지 + n)</span>
              <input type="number" className={input} value={pageOffset} onChange={(e) => setPageOffset(e.target.value)} />
            </label>
            <label className="space-y-1 col-span-2">
              <span className={label}>저장소 stem (origin/main)</span>
              <input className={`${input} text-gray-500 font-mono`} value={book.stem} readOnly />
            </label>
            <label className="space-y-1 col-span-2">
              <span className={label}>해설서</span>
              <input className={`${input} text-gray-500 font-mono`} value={book.commentaryStem || "(없음)"} readOnly />
            </label>
          </div>
          <details className="rounded-lg border border-white/5 bg-black/20">
            <summary className="px-2.5 py-1.5 text-[11px] text-gray-400 cursor-pointer">TOC 항목 {tocNodes.length}개 보기</summary>
            <ul className="max-h-48 overflow-y-auto px-2.5 pb-2 text-[11px] font-mono">
              {tocNodes.map((t) => (
                <li
                  key={t.key}
                  className={`flex justify-between gap-2 py-0.5 ${t.level === "chapter" ? "text-orange-400 font-bold" : t.level === "section" ? "pl-3 text-blue-400" : "pl-6 text-gray-400"}`}
                >
                  <span className="truncate">{t.label}</span>
                  <span className="text-gray-500 shrink-0">{t.page ?? "-"}p</span>
                </li>
              ))}
            </ul>
          </details>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-500">
              {bookSaved ? `저장됨 · ${summary.updatedAt}` : "도서를 먼저 저장해야 페이지를 넣을 수 있습니다."}
            </span>
            <button
              onClick={saveBook}
              disabled={savingBook || tocNodes.length === 0}
              className="px-3.5 py-1.5 text-[11px] font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm flex items-center gap-1 disabled:opacity-40"
            >
              <BookPlus className="w-3.5 h-3.5" /> {bookSaved ? "도서·TOC 갱신" : "도서·TOC 저장"}
            </button>
          </div>
        </fieldset>

        <PageForm
          key={`${kind}:${page}:${json.status === "ok" ? json.key : json.status}`}
          book={book}
          kind={kind}
          page={page}
          json={json}
          tocNodes={tocNodes}
          pageOffset={Number(pageOffset) || 0}
          bookSaved={bookSaved}
          problems={problems}
          onSaved={() => Promise.all([loadProblems(), loadSummary()])}
          onToast={onToast}
          imageUrl={imageUrl}
          curriculum={curriculum}
          mappings={mappings}
          onMap={async (tocKey, ids) => {
            const res = await api("/api/graph/mapping", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ stem: book.stem, tocKey, curriculumIds: ids }),
            });
            const data = await res.json();
            if (!res.ok) return onToast(data.error, "error");
            setMappings((m) => ({ ...m, [tocKey]: ids }));
          }}
        />
      </div>
    </section>
  );
}

type PageFormProps = {
  book: SelectedBook;
  kind: "main" | "commentary";
  page: number | null;
  json: JsonState;
  tocNodes: TocNodeInput[];
  pageOffset: number;
  bookSaved: boolean;
  problems: ProblemRef[];
  onSaved: () => Promise<unknown>;
  onToast: Props["onToast"];
  imageUrl: string | null;
  curriculum: CurriculumOption[];
  mappings: Record<string, string[]>;
  onMap: (tocKey: string, curriculumIds: string[]) => Promise<void>;
};

function rowsFromJson(json: JsonState): Row[] {
  if (json.status !== "ok") return [];
  return (json.data.items || []).map((it, idx) => {
    const k = kindForCategory(it.category);
    return { idx, include: k != null, category: it.category || "기타", kind: k ?? "정의", content: itemBodyRaw(it), answersTo: "" };
  });
}

function PageForm(props: PageFormProps) {
  const { book, kind, page, json, tocNodes, pageOffset, bookSaved, problems, onSaved, onToast } = props;
  const pageIdPrefix = page != null ? `para:${book.stem.normalize("NFC")}:${kind}:${page}:` : "";
  const otherProblems = problems.filter((p) => !p.id.startsWith(pageIdPrefix));
  const autoTocKey = kind === "main" && page != null ? tocKeyForPage(tocNodes, page - pageOffset) : null;

  // 추출 JSON 으로 폼을 채우고, 그래프에 저장된 페이지가 있으면 같은 idx 문단에 덮어쓴다 (페이지가 바뀌면 key 로 리마운트)
  const [tocKey, setTocKey] = useState(autoTocKey || "");
  const [rows, setRows] = useState<Row[]>(() => rowsFromJson(json));
  const [saved, setSaved] = useState<SavedPage | null>(null);
  const [savingPage, setSavingPage] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (page == null) return;
    (async () => {
      const res = await api(`/api/graph/page?stem=${encodeURIComponent(book.stem)}&kind=${kind}&page=${page}`);
      const sp: SavedPage | null = (await res.json()).page;
      if (cancelled || !sp) return;
      setSaved(sp);
      setTocKey(sp.tocKey || "");
      setRows((base) => {
        const merged = base.map((r) => ({ ...r, include: false }));
        for (const p of sp.paragraphs) {
          const row = { idx: p.idx, include: true, category: p.category, kind: p.kind, content: p.content, answersTo: p.answersTo || "" };
          const at = merged.findIndex((r) => r.idx === p.idx);
          if (at === -1) merged.push(row);
          else merged[at] = row;
        }
        merged.sort((a, b) => a.idx - b.idx);
        // 같은 페이지 문제를 가리키는 해답은 local:<row> 로 표시
        return merged.map((r) => {
          const local = merged.findIndex((o) => `${pageIdPrefix}${o.idx}` === r.answersTo);
          return local === -1 ? r : { ...r, answersTo: `local:${local}` };
        });
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [book.stem, kind, page, pageIdPrefix]);

  const updateRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const savePage = async () => {
    if (page == null) return;
    const paragraphs = [];
    for (const [i, r] of rows.entries()) {
      if (!r.include) continue;
      let answersTo: string | null = null;
      if (r.kind === "해답" && r.answersTo) {
        if (r.answersTo.startsWith("local:")) {
          // 같은 페이지 안의 문제 참조(local:<row>)를 저장될 문단 id 로 바꾼다
          const target = rows[Number(r.answersTo.slice(6))];
          if (!target?.include || target.kind !== "문제") {
            return onToast(`문단 #${i + 1}: 가리키는 문제 문단이 저장 대상이 아닙니다.`, "error");
          }
          answersTo = `${pageIdPrefix}${target.idx}`;
        } else {
          answersTo = r.answersTo;
        }
      }
      paragraphs.push({ idx: r.idx, kind: r.kind, category: r.category, content: r.content, answersTo });
    }
    setSavingPage(true);
    try {
      const res = await api("/api/graph/page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stem: book.stem,
          kind,
          page,
          tocKey: tocKey || null,
          jsonKey: json.status === "ok" ? json.key : null,
          imageUrl: props.imageUrl,
          paragraphs,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onToast(`${page}페이지 문단 ${data.paragraphCount}개를 저장했습니다.`);
      const r2 = await api(`/api/graph/page?stem=${encodeURIComponent(book.stem)}&kind=${kind}&page=${page}`);
      setSaved((await r2.json()).page);
      await onSaved();
    } catch (e) {
      onToast((e as Error).message, "error");
    } finally {
      setSavingPage(false);
    }
  };


  return (
    <>
        {/* 2. 페이지 */}
        <fieldset className="p-3.5 rounded-xl bg-white/5 border border-white/5 space-y-3" disabled={!bookSaved}>
          <legend className="px-1 text-xs font-bold text-orange-400">2. 페이지</legend>
          <div className="grid grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className={label}>구분</span>
              <input className={`${input} text-gray-500`} value={kind === "main" ? "본문" : "해설서"} readOnly />
            </label>
            <label className="space-y-1">
              <span className={label}>페이지</span>
              <input className={`${input} text-gray-500 font-mono`} value={page ?? "-"} readOnly />
            </label>
            <label className="space-y-1">
              <span className={label}>상태</span>
              <input className={`${input} ${saved ? "text-emerald-400" : "text-gray-500"}`} value={saved ? "그래프에 저장됨" : "미저장"} readOnly />
            </label>
            <label className="space-y-1 col-span-3">
              <span className={label}>
                TOC 항목 (이 페이지를 가리킴){autoTocKey && tocKey === autoTocKey && <span className="ml-1 text-blue-400 normal-case">· 페이지 범위로 자동 선택</span>}
              </span>
              <select className={input} value={tocKey} onChange={(e) => setTocKey(e.target.value)}>
                <option value="">(연결 안 함)</option>
                {tocNodes.map((t) => (
                  <option key={t.key} value={t.key}>
                    {"  ".repeat(t.level === "chapter" ? 0 : t.level === "section" ? 1 : 2)}
                    {t.label} ({t.page ?? "-"}p)
                  </option>
                ))}
              </select>
            </label>
            {tocKey && (
              <CurriculumMapping
                ids={props.mappings[tocKey] || []}
                options={props.curriculum}
                onChange={(ids) => props.onMap(tocKey, ids)}
              />
            )}
          </div>
        </fieldset>

        {/* 3. 문단 */}
        <fieldset className="p-3.5 rounded-xl bg-white/5 border border-white/5 space-y-3" disabled={!bookSaved}>
          <legend className="px-1 text-xs font-bold text-orange-400">3. 문단 ({rows.filter((r) => r.include).length} / {rows.length})</legend>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-500">종류: 정의 · 공식 · 성질 · 문제 · 해답. 체크 해제한 문단은 그래프에 넣지 않습니다.</span>
            <button
              type="button"
              onClick={() => setRows(rowsFromJson(json))}
              disabled={json.status !== "ok"}
              className="px-2 py-1 text-[10px] font-bold rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 text-emerald-400 flex items-center gap-1 disabled:opacity-40"
            >
              <RefreshCw className="w-3 h-3" /> 추출 JSON으로 다시 채우기
            </button>
          </div>
          {rows.length === 0 && (
            <p className="text-xs text-gray-500 text-center py-4">
              {json.status === "loading" ? "페이지 JSON을 불러오는 중..." : "넣을 문단이 없습니다. 추출 JSON이 있는 페이지를 선택하세요."}
            </p>
          )}
          {rows.map((r, i) => (
            <div key={i} className={`p-3 rounded-xl border space-y-2 ${r.include ? "border-white/10 bg-black/20" : "border-white/5 opacity-50"}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <input type="checkbox" checked={r.include} onChange={(e) => updateRow(i, { include: e.target.checked })} className="accent-orange-500" />
                <span className="text-[10px] text-gray-500 font-bold"># {i + 1}</span>
                <span className="text-[9px] font-bold px-2 py-0.5 rounded border bg-white/5 border-white/10 text-gray-400" title="OCR JSON 카테고리">
                  {r.category}
                </span>
                <span className="text-[10px] text-gray-500">→</span>
                <select
                  value={r.kind}
                  onChange={(e) => updateRow(i, { kind: e.target.value as ParagraphKind, answersTo: "" })}
                  className="bg-[#121824] border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-gray-200 outline-none focus:border-orange-500"
                >
                  {PARAGRAPH_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                {r.kind === "해답" && (
                  <select
                    value={r.answersTo}
                    onChange={(e) => updateRow(i, { answersTo: e.target.value })}
                    className="flex-1 min-w-0 bg-[#121824] border border-emerald-500/30 rounded px-1.5 py-0.5 text-[11px] text-emerald-300 outline-none"
                  >
                    <option value="">(가리키는 문제 선택)</option>
                    <optgroup label="이 페이지">
                      {rows.map((o, j) =>
                        o.kind === "문제" && j !== i ? (
                          <option key={j} value={`local:${j}`}>
                            #{j + 1} {o.content.slice(0, 40)}
                          </option>
                        ) : null
                      )}
                    </optgroup>
                    <optgroup label="그래프에 저장된 문제">
                      {otherProblems.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.kind === "commentary" ? "해설 " : ""}
                          {p.page}p #{p.idx + 1} {p.snippet}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                )}
              </div>
              <textarea
                value={r.content}
                onChange={(e) => updateRow(i, { content: e.target.value })}
                rows={Math.min(8, Math.max(2, Math.ceil(r.content.length / 70)))}
                className="w-full bg-[#121824] border border-white/10 rounded-lg p-2 text-[11px] leading-relaxed font-mono text-gray-200 outline-none focus:border-orange-500 resize-y"
              />
            </div>
          ))}
        </fieldset>

      <div className="sticky -bottom-4 -mx-4 -mb-4 px-4 py-2.5 border-t border-white/5 bg-[#0f1420] flex items-center justify-between">
        <span className="text-[10px] text-gray-500 font-mono truncate">
          {saved ? `${saved.id} · ${saved.updatedAt}` : json.status === "ok" ? json.key : ""}
        </span>
        <button
          onClick={savePage}
          disabled={!bookSaved || page == null || savingPage}
          className="px-4 py-1.5 text-[11px] font-bold rounded-lg bg-orange-600 hover:bg-orange-700 text-white shadow-md flex items-center gap-1 disabled:opacity-40"
        >
          <Save className="w-3.5 h-3.5" /> 페이지 그래프 저장
        </button>
      </div>
    </>
  );
}

// 선택한 TOC 항목에 대응하는 교육과정·과목 노드 (바로 저장)
function CurriculumMapping({ ids, options, onChange }: { ids: string[]; options: CurriculumOption[]; onChange: (ids: string[]) => void }) {
  const name = (id: string) => options.find((o) => o.id === id)?.name ?? id;
  return (
    <div className="col-span-3 space-y-1">
      <span className={label}>이 TOC 항목에 대응하는 교육과정·과목</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {ids.map((id) => (
          <span key={id} className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-indigo-500/40 bg-indigo-500/10 text-[11px] text-indigo-300">
            {name(id)}
            <button type="button" onClick={() => onChange(ids.filter((x) => x !== id))} className="text-indigo-400 hover:text-white" title="대응 해제">
              ×
            </button>
          </span>
        ))}
        <select
          value=""
          onChange={(e) => e.target.value && onChange([...ids, e.target.value])}
          className="bg-[#121824] border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-gray-300 outline-none focus:border-orange-500"
        >
          <option value="">+ 과목 추가</option>
          {options
            .filter((o) => !ids.includes(o.id))
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.level})
              </option>
            ))}
        </select>
        {options.length === 0 && <span className="text-[10px] text-gray-500">과목 노드가 없습니다. 과목 그물 화면에서 먼저 등록하세요.</span>}
      </div>
    </div>
  );
}
