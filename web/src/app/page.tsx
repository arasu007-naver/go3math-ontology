"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BookBars from "@/components/BookBars";
import GraphForm from "@/components/GraphForm";
import PreviewColumn, { type JsonState, type PreviewPage } from "@/components/PreviewColumn";
import { fetchJsonPages, fetchPageJson, fetchPageUrls, fetchToc, jsonStorageKey, OcrAuthError } from "@/lib/ocrApi";
import { commentaryList, stripExt } from "@/lib/toc";
import type { BookTocRow, DocEntry, SelectedBook, TocData } from "@/lib/types";

type Toast = { msg: string; type: "success" | "error" } | null;

export default function Home() {
  const [book, setBook] = useState<SelectedBook | null>(null);
  const [previewMode, setPreviewMode] = useState<"origin" | "commentary">("origin");
  // 비동기 결과는 어떤 요청에 대한 것인지(forKey)와 함께 보관하고, 현재 요청과 다르면 로딩 중으로 본다
  const [pagesResult, setPagesResult] = useState<{ forKey: string; pages: PreviewPage[] } | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [jsonMode, setJsonMode] = useState<"main" | "batch">("main");
  const [jsonPagesResult, setJsonPagesResult] = useState<{ forKey: string; sets: { main: Set<number>; batch: Set<number> } } | null>(null);
  const [jsonResult, setJsonResult] = useState<{ forKey: string; state: JsonState } | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const onError = useCallback(
    (e: unknown) => {
      if (e instanceof OcrAuthError) setAuthRequired(true);
      else pushToast(`조회 실패: ${(e as Error).message}`, "error");
    },
    [pushToast]
  );

  const selectBook = useCallback((b: SelectedBook) => {
    setBook(b);
    setPreviewMode("origin");
    setPageIndex(0);
  }, []);

  const onSelectBookToc = useCallback(
    (row: BookTocRow) => {
      let toc: TocData | null = null;
      try {
        toc = row.toc ? JSON.parse(row.toc) : null;
      } catch {
        pushToast("TOC 파싱 오류", "error");
      }
      selectBook({
        source: "booktoc",
        sourceId: String(row.id),
        title: row.bookTitle,
        stem: stripExt(row.pdfFilename),
        documentId: toc?.documentId ?? null,
        toc,
        commentaryStem: stripExt(commentaryList(toc)[0] || ""),
      });
    },
    [pushToast, selectBook]
  );

  const onSelectDoc = useCallback(
    async (entry: DocEntry) => {
      try {
        const toc = await fetchToc(entry.id);
        selectBook({
          source: "document",
          sourceId: entry.id,
          title: toc.bookTitle || entry.main_stem || stripExt(entry.name),
          stem: stripExt(entry.name),
          documentId: Number(entry.id),
          toc,
          commentaryStem: stripExt(commentaryList(toc)[0] || ""),
        });
      } catch (e) {
        onError(e);
      }
    },
    [onError, selectBook]
  );

  const kind = previewMode === "commentary" ? "commentary" : "main";
  const stem = book ? (kind === "commentary" ? book.commentaryStem : book.stem) : "";

  // 도서/본문·해설서 전환 → 전체 페이지 목록 + JSON 추출 여부
  const pagesKey = stem ? `${kind}|${stem}` : "";
  const pages = !book ? null : !stem ? [] : pagesResult?.forKey === pagesKey ? pagesResult.pages : null;
  const jsonPages = jsonPagesResult?.forKey === pagesKey ? jsonPagesResult.sets : null;
  useEffect(() => {
    if (!pagesKey) return;
    let cancelled = false;
    fetchPageUrls(stem, kind)
      .then((p) => !cancelled && setPagesResult({ forKey: pagesKey, pages: p }))
      .catch((e) => {
        if (cancelled) return;
        setPagesResult({ forKey: pagesKey, pages: [] });
        onError(e);
      });
    fetchJsonPages(stem, kind)
      .then((sets) => !cancelled && setJsonPagesResult({ forKey: pagesKey, sets }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pagesKey, stem, kind, onError]);

  const changePreviewMode = (m: "origin" | "commentary") => {
    setPreviewMode(m);
    setPageIndex(0);
  };

  // 현재 페이지 JSON (150ms 디바운스, 없으면 다른 저장소 경로로 1회 재시도 후 자동 전환 — ocr.html 과 동일)
  const curPage = pages?.[pageIndex]?.page ?? null;
  const jsonKey = stem && curPage != null ? `${pagesKey}|${curPage}|${jsonMode}` : "";
  const json: JsonState = !jsonKey ? { status: "idle" } : jsonResult?.forKey === jsonKey ? jsonResult.state : { status: "loading" };
  useEffect(() => {
    if (!jsonKey || curPage == null) return;
    const ctrl = new AbortController();
    const done = (state: JsonState) => setJsonResult({ forKey: jsonKey, state });
    const timer = setTimeout(async () => {
      const isBatch = jsonMode === "batch";
      const key = jsonStorageKey(stem, kind, isBatch, curPage);
      try {
        const data = await fetchPageJson(key, ctrl.signal);
        if (data) return done({ status: "ok", key, data });
        const altKey = jsonStorageKey(stem, kind, !isBatch, curPage);
        if (await fetchPageJson(altKey, ctrl.signal)) {
          setJsonMode(isBatch ? "main" : "batch"); // 다른 경로에 있으면 그쪽으로 전환 → 다시 조회
          return;
        }
        done({ status: "missing", key });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        if (e instanceof OcrAuthError) setAuthRequired(true);
        done({ status: "error", message: "데이터를 로드하는 도중 오류가 발생했습니다." });
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [jsonKey, stem, kind, curPage, jsonMode]);

  const changeJsonMode = (m: "main" | "batch") => {
    setJsonMode(m);
    pushToast(`JSON 저장소 경로를 [${m === "batch" ? "batch/main/" : "main/"}]으로 전환했습니다.`);
  };

  const storagePath = `${kind === "commentary" ? "commentaries" : "origin"}/${stem ? `${stem}/` : ""}`;
  const jsonStoragePath =
    kind === "commentary"
      ? `${jsonMode === "batch" ? "batch/subs" : "sub"}/${stem ? `${stem}/` : ""}`
      : `${jsonMode === "batch" ? "batch/main" : "main"}/${stem ? `${stem}/` : ""}`;

  return (
    <>
      <header className="border-b border-white/5 py-4 px-6 flex items-center justify-between shrink-0 glass sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-orange-500 to-amber-400 flex items-center justify-center shadow-lg shadow-orange-500/20">
            <span className="text-white font-extrabold text-lg">Q</span>
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              Go3 Math Ontology
            </h1>
            <p className="text-[9px] text-gray-500 font-medium">TOC 중심 Knowledge Graph 도서 입력</p>
          </div>
        </div>
      </header>

      {authRequired && (
        <div className="px-6 py-2 bg-red-500/10 border-b border-red-500/30 text-xs text-red-300 flex items-center gap-2 shrink-0">
          unlimited-ocr 로그인이 필요합니다.
          <a
            href={process.env.NEXT_PUBLIC_OCR_LOGIN_URL || "http://localhost:8088/unauthorized"}
            target="_blank"
            rel="noreferrer"
            className="underline font-bold"
          >
            로그인
          </a>
          후 새로고침하세요.
        </div>
      )}

      <BookBars
        selectedKey={book ? `${book.source}:${book.sourceId}` : null}
        onSelectBookToc={onSelectBookToc}
        onSelectDoc={onSelectDoc}
        onError={onError}
      />

      <main className="flex-1 flex overflow-hidden p-4 gap-4">
        <PreviewColumn
          hasBook={!!book}
          hasCommentary={!!book?.commentaryStem}
          previewMode={previewMode}
          onPreviewMode={changePreviewMode}
          pages={book ? pages : []}
          pageIndex={pageIndex}
          onPageIndex={setPageIndex}
          storagePath={storagePath}
          jsonStoragePath={jsonStoragePath}
          jsonMode={jsonMode}
          onJsonMode={changeJsonMode}
          jsonPages={jsonPages}
          json={json}
          onToast={pushToast}
        />
        <GraphForm book={book} kind={kind} page={curPage} json={json} onToast={pushToast} />
      </main>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 px-4 py-2.5 rounded-xl text-xs font-bold shadow-2xl z-50 ${
            toast.type === "error" ? "bg-red-500/90 text-white border border-red-500" : "bg-emerald-500/90 text-white border border-emerald-500"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </>
  );
}
