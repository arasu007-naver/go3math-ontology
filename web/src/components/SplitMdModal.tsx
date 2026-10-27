"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Scissors,
  CheckCircle2,
  AlertTriangle,
  Database,
  X,
  Loader2,
  FolderArchive,
  ChevronDown,
  ChevronUp
} from "lucide-react";

export type SplitPreviewChapter = {
  chapterId: string;
  chapterTitle: string;
  startLine: number;
  endLine: number;
  lineCount: number;
  targetFilename: string;
  targetKey: string;
};

export type SplitExcludedChapter = {
  chapterId: string;
  chapterTitle: string;
  reason: string;
};

export type SplitPreviewData = {
  bookStem: string;
  bookTitle: string;
  tocKey: string;
  mdKey: string;
  totalLines: number;
  prefix: string;
  lineChapters: SplitPreviewChapter[];
  excludedChapters: SplitExcludedChapter[];
};

export type SplitSavedItem = {
  chapterId: string;
  chapterTitle: string;
  startLine: number;
  endLine: number;
  lineCount: number;
  byteSize: number;
  targetFilename: string;
  targetKey: string;
};

interface SplitMdModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookStem: string;
  bookTitle: string;
  onSuccess?: (savedCount: number) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function SplitMdModal({
  isOpen,
  onClose,
  bookStem,
  bookTitle,
  onSuccess
}: SplitMdModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SplitPreviewData | null>(null);

  const [executing, setExecuting] = useState(false);
  const [savedResults, setSavedResults] = useState<SplitSavedItem[] | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);

  const fetchPreview = useCallback(async (stem: string) => {
    setLoading(true);
    setError(null);
    setSavedResults(null);

    try {
      const res = await fetch(`/api/dictionary/split-md?bookStem=${encodeURIComponent(stem)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "분할 미리보기 로드 실패");
      setPreview(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // 모달 열릴 때 미리보기 데이터 로드
  useEffect(() => {
    if (!isOpen || !bookStem) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) {
        void fetchPreview(bookStem);
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, bookStem, fetchPreview]);


  // 분할 및 MinIO 저장 실행
  const handleExecute = async () => {
    if (!bookStem || executing) return;

    setExecuting(true);
    setError(null);

    try {
      const res = await fetch("/api/dictionary/split-md", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookStem })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "MD 파일 분할 실행 실패");

      setSavedResults(data.savedResults ?? []);
      if (onSuccess) onSuccess(data.savedCount ?? 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExecuting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-[#0d121d] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-gray-200 font-sans">
        {/* 모달 상단 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#121824]/90">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-orange-500/20 text-orange-400 border border-orange-500/30">
              <Scissors className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>MD File 단원별 분할 및 저장</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 font-mono">
                  MinIO Storage
                </span>
              </h2>
              <p className="text-xs text-gray-400">
                toc.json 라인 정보(startLine ~ endLine)를 기준으로 chapter만 분할하여 저장합니다.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 모달 본문 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 오류 메시지 */}
          {error && (
            <div className="p-4 rounded-xl bg-red-950/40 border border-red-500/40 text-red-200 text-xs flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold">오류: </strong>
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* 성공 완료 배너 */}
          {savedResults && (
            <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-200 text-xs flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <div className="font-bold text-sm text-emerald-300">
                    분할 및 저장 완료! 총 {savedResults.length}개 파일이 MinIO에 생성되었습니다.
                  </div>
                  <div className="text-[11px] text-emerald-200/80 font-mono mt-0.5">
                    저장 경로 Prefix: {preview?.prefix || `mathpix/${bookStem}/`}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 로딩 인디케이터 */}
          {loading && (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-gray-400">
              <Loader2 className="w-8 h-8 text-orange-400 animate-spin" />
              <p className="text-xs">TOC 목차 및 MD 파일 라인 분석 중...</p>
            </div>
          )}

          {/* 미리보기 및 분할 목록 */}
          {!loading && preview && (
            <>
              {/* 기본 메타데이터 카드 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1.5">
                  <div className="text-[11px] text-gray-400 font-medium">대상 도서 및 원본 소스</div>
                  <div className="font-semibold text-white truncate text-sm">{bookTitle}</div>
                  <div className="flex items-center gap-2 font-mono text-[11px] text-gray-400">
                    <span className="px-1.5 py-0.5 rounded bg-black/40 border border-white/5 truncate">
                      {preview.mdKey}
                    </span>
                    <span className="text-orange-300 font-bold">
                      {preview.totalLines.toLocaleString()}줄
                    </span>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1.5">
                  <div className="text-[11px] text-gray-400 font-medium">MinIO 저장 대상 및 규격</div>
                  <div className="font-mono text-sm text-amber-300 font-semibold truncate flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>{preview.prefix}</span>
                  </div>
                  <div className="text-[11px] text-gray-400 flex items-center gap-2">
                    <span>파일명 규칙: </span>
                    <span className="font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-200 border border-amber-500/20 font-bold">
                      {"${chapterId}.md"} (예: 제1장.md)
                    </span>
                  </div>
                </div>
              </div>

              {/* 1. 분할 대상 단원 (Line 지정 단원) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <FolderArchive className="w-4 h-4 text-orange-400" />
                      <span>분할 추출 대상 단원</span>
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-orange-500/20 text-orange-300 font-mono">
                      {preview.lineChapters.length}개
                    </span>
                  </div>
                  <span className="text-[11px] text-gray-400">
                    MD 라인 시작 ~ 종료 범위 기준으로 분할됩니다.
                  </span>
                </div>

                {preview.lineChapters.length === 0 ? (
                  <div className="p-8 rounded-xl bg-white/[0.02] border border-white/5 text-center text-gray-400 text-xs">
                    라인으로 지정된 챕터가 없습니다. (모든 챕터가 페이지로 지정되어 있음)
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                    {preview.lineChapters.map((ch, idx) => {
                      const isSaved = savedResults?.some(
                        (r) => r.targetFilename === ch.targetFilename
                      );
                      const savedInfo = savedResults?.find(
                        (r) => r.targetFilename === ch.targetFilename
                      );

                      return (
                        <div
                          key={idx}
                          className={`p-3 rounded-xl border transition-all flex items-center justify-between text-xs ${
                            isSaved
                              ? "bg-emerald-950/20 border-emerald-500/30"
                              : "bg-white/[0.02] border-white/5 hover:border-white/10"
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <span className="px-2 py-1 rounded bg-black/40 text-amber-300 font-bold font-mono text-[11px] shrink-0 border border-white/5">
                              {ch.chapterId}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-white truncate text-[13px]">
                                {ch.chapterTitle || ch.chapterId}
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-gray-400 font-mono mt-0.5">
                                <span className="text-orange-300 font-medium">
                                  L{ch.startLine} ~ L{ch.endLine}
                                </span>
                                <span>({ch.lineCount.toLocaleString()}줄)</span>
                                <span>·</span>
                                <span className="text-gray-500 truncate">{ch.targetKey}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 ml-4 font-mono">
                            {isSaved ? (
                              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 text-[11px] font-bold border border-emerald-500/30">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                <span>저장됨</span>
                                {savedInfo && (
                                  <span className="text-emerald-200/80">
                                    ({formatBytes(savedInfo.byteSize)})
                                  </span>
                                )}
                              </div>
                            ) : executing ? (
                              <div className="flex items-center gap-1 text-gray-400 text-[11px]">
                                <Loader2 className="w-3 h-3 animate-spin text-orange-400" />
                                <span>저장 대기</span>
                              </div>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-white/5 text-gray-400 text-[11px]">
                                {ch.targetFilename}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 2. 제외된 단원 (페이지 단원 등) */}
              {preview.excludedChapters.length > 0 && (
                <div className="rounded-xl border border-white/5 bg-black/30 overflow-hidden text-xs">
                  <button
                    type="button"
                    onClick={() => setShowExcluded((prev) => !prev)}
                    className="w-full px-4 py-2.5 flex items-center justify-between text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-gray-300">
                        제외된 단원 (페이지 단원 또는 라인 미지정)
                      </span>
                      <span className="px-1.5 py-0.2 rounded-full bg-white/10 text-gray-400 font-mono text-[10px]">
                        {preview.excludedChapters.length}개 제외
                      </span>
                    </div>
                    {showExcluded ? (
                      <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                    )}
                  </button>

                  {showExcluded && (
                    <div className="px-4 pb-3 pt-1 border-t border-white/5 space-y-1.5 max-h-[160px] overflow-y-auto">
                      {preview.excludedChapters.map((ex, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between text-[11px] py-1 text-gray-400 border-b border-white/[0.02] last:border-none"
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span className="font-mono text-gray-500 font-medium shrink-0">
                              [{ex.chapterId}]
                            </span>
                            <span className="truncate">{ex.chapterTitle}</span>
                          </div>
                          <span className="text-[10px] text-gray-500 shrink-0 font-mono ml-2">
                            {ex.reason}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* 모달 하단 푸터 바 */}
        <div className="px-6 py-4 border-t border-white/10 bg-[#121824] flex items-center justify-between">
          <div className="text-xs text-gray-400 font-mono">
            {savedResults ? (
              <span className="text-emerald-400 font-semibold">
                ✓ {savedResults.length}개 파일 저장 완료
              </span>
            ) : preview ? (
              <span>
                분할 대상: <strong className="text-orange-400">{preview.lineChapters.length}</strong>개 단원
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              disabled={executing}
              className="px-4 py-2 text-xs font-semibold rounded-xl border border-white/10 hover:bg-white/10 text-gray-300 transition-colors cursor-pointer disabled:opacity-50"
            >
              {savedResults ? "닫기" : "취소"}
            </button>

            {!savedResults ? (
              <button
                onClick={handleExecute}
                disabled={executing || loading || !preview || preview.lineChapters.length === 0}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black transition-all shadow-md shadow-orange-500/20 flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {executing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-black" />
                    <span>분할 및 저장 중...</span>
                  </>
                ) : (
                  <>
                    <Scissors className="w-4 h-4 text-black" />
                    <span>분할 및 MinIO 저장 실행</span>
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={onClose}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-md shadow-emerald-600/20 flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>확인 완료</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
