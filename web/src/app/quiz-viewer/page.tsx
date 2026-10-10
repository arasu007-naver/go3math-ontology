"use client";

import { useState, useRef, useMemo, useCallback } from "react";
import AppHeader from "@/components/AppHeader";
import {
  FolderOpen,
  Download,
  Copy,
  Trash2,
  FileCode,
  FileText,
  Sparkles,
  Check,
  AlertCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  ListOrdered,
  Eye,
  BookOpen,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import {
  type QuizItem,
  SAMPLE_QUIZZES,
  formatQuizToMarkdown,
  getQuizChapter,
  getQuizSource,
  getQuizQuestion,
  getQuizNumberLabel,
} from "@/lib/sample-quiz";

export default function QuizViewerPage() {
  const [quizzes, setQuizzes] = useState<QuizItem[]>(SAMPLE_QUIZZES);
  const [selectedQuizIndex, setSelectedQuizIndex] = useState<number>(0);
  const [urlInput, setUrlInput] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadedFileName, setLoadedFileName] = useState<string>("notebooklm-math-quiz.json");
  const [copied, setCopied] = useState<boolean>(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<string>("all");

  // 현재 선택된 퀴즈의 원본 마크다운 문자열 (textarea 상태)
  const [rawMarkdown, setRawMarkdown] = useState<string>(() =>
    SAMPLE_QUIZZES.length > 0 ? formatQuizToMarkdown(SAMPLE_QUIZZES[0], 0) : ""
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 3500);
  }, []);

  // 퀴즈 선택 변경 시 textarea 내용 업데이트
  const handleSelectQuiz = (index: number) => {
    if (index >= 0 && index < quizzes.length) {
      setSelectedQuizIndex(index);
      setRawMarkdown(formatQuizToMarkdown(quizzes[index], index));
    }
  };

  // 1. JSON 파일 선택 핸들러
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = file.name;
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);

        let list: QuizItem[] = [];
        if (Array.isArray(parsed)) {
          list = parsed;
        } else if (parsed && typeof parsed === "object") {
          const possibleArray = parsed.quizzes || parsed.items || parsed.data || parsed.questions;
          if (Array.isArray(possibleArray)) {
            list = possibleArray;
          } else {
            list = [parsed];
          }
        }

        if (list.length === 0) {
          throw new Error("유효한 퀴즈 배열 데이터를 찾을 수 없습니다.");
        }

        setQuizzes(list);
        setSelectedQuizIndex(0);
        setSelectedChapter("all");
        setLoadedFileName(fileName);
        setRawMarkdown(formatQuizToMarkdown(list[0], 0));
        showToast(`'${fileName}'에서 ${list.length}개의 퀴즈를 불러왔습니다.`, "success");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "JSON 파싱 오류";
        showToast(`JSON 파일 읽기 실패: ${msg}`, "error");
      }
    };

    reader.onerror = () => {
      showToast("파일을 읽는 중 오류가 발생했습니다.", "error");
    };

    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  // 2. URL Load 핸들러
  const handleLoadUrl = async () => {
    const trimmed = urlInput.trim();
    if (!trimmed) {
      showToast("JSON 파일 주소(URL)를 입력해주세요.", "error");
      return;
    }

    setIsLoading(true);
    try {
      let rawText = "";
      let sourceName = "remote-quiz.json";

      try {
        const parsedUrl = new URL(trimmed);
        sourceName = parsedUrl.pathname.split("/").pop() || "remote-quiz.json";
      } catch {
        // fallback
      }

      // 1단계: 직접 fetch 시도
      let success = false;
      try {
        const directResp = await fetch(trimmed, { method: "GET" });
        if (directResp.ok) {
          rawText = await directResp.text();
          success = true;
        }
      } catch {
        success = false;
      }

      // 2단계: 프록시 API fallback (/api/proxy-md?url=...)
      if (!success) {
        const proxyResp = await fetch(`/api/proxy-md?url=${encodeURIComponent(trimmed)}`);
        if (!proxyResp.ok) {
          const errJson = await proxyResp.json().catch(() => ({}));
          throw new Error(errJson.error || `HTTP ${proxyResp.status} 다운로드 실패`);
        }
        rawText = await proxyResp.text();
      }

      const parsed = JSON.parse(rawText);
      let list: QuizItem[] = [];
      if (Array.isArray(parsed)) {
        list = parsed;
      } else if (parsed && typeof parsed === "object") {
        const possibleArray = parsed.quizzes || parsed.items || parsed.data || parsed.questions;
        if (Array.isArray(possibleArray)) {
          list = possibleArray;
        } else {
          list = [parsed];
        }
      }

      if (list.length === 0) {
        throw new Error("유효한 퀴즈 배열 데이터를 찾을 수 없습니다.");
      }

      setQuizzes(list);
      setSelectedQuizIndex(0);
      setSelectedChapter("all");
      setLoadedFileName(sourceName);
      setRawMarkdown(formatQuizToMarkdown(list[0], 0));
      showToast(`'${sourceName}' URL로부터 ${list.length}개의 퀴즈 로드 완료!`, "success");
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "파일 다운로드/파싱 실패";
      showToast(`로드 오류: ${errMsg}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  // 클립보드 복사
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawMarkdown);
      setCopied(true);
      showToast("현재 퀴즈 Markdown이 클립보드에 복사되었습니다.", "success");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("클립보드 복사 실패", "error");
    }
  };

  // JSON 다운로드
  const handleDownloadJson = () => {
    const blob = new Blob([JSON.stringify(quizzes, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = loadedFileName.endsWith(".json") ? loadedFileName : `${loadedFileName || "quizzes"}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`'${a.download}' 파일로 저장되었습니다.`, "success");
  };

  // 샘플 퀴즈 로드
  const handleLoadSample = () => {
    setQuizzes(SAMPLE_QUIZZES);
    setSelectedQuizIndex(0);
    setSelectedChapter("all");
    setLoadedFileName("notebooklm-math-quiz.json");
    setRawMarkdown(formatQuizToMarkdown(SAMPLE_QUIZZES[0], 0));
    showToast("NotebookLM 48문항 수학 퀴즈 샘플을 불러왔습니다.", "success");
  };

  // 수식 템플릿 삽입
  const insertSnippet = (snippet: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setRawMarkdown((prev) => prev + "\n" + snippet);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const current = rawMarkdown;
    const next = current.substring(0, start) + snippet + current.substring(end);
    setRawMarkdown(next);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + snippet.length, start + snippet.length);
    }, 0);
  };

  // 단원(Chapter) 목록 추출
  const chapters = useMemo(() => {
    const set = new Set<string>();
    quizzes.forEach((q) => {
      const ch = getQuizChapter(q);
      if (ch) set.add(ch);
    });
    return Array.from(set);
  }, [quizzes]);

  // 필터링된 퀴즈 인덱스 목록
  const filteredIndices = useMemo(() => {
    if (selectedChapter === "all") {
      return quizzes.map((_, i) => i);
    }
    return quizzes
      .map((q, i) => (getQuizChapter(q) === selectedChapter ? i : -1))
      .filter((i) => i !== -1);
  }, [quizzes, selectedChapter]);

  const currentFilteredIdx = useMemo(() => {
    return filteredIndices.indexOf(selectedQuizIndex);
  }, [filteredIndices, selectedQuizIndex]);

  // 이전/다음 퀴즈 네비게이션
  const handlePrevQuiz = useCallback(() => {
    if (currentFilteredIdx > 0) {
      handleSelectQuiz(filteredIndices[currentFilteredIdx - 1]);
    } else if (selectedQuizIndex > 0) {
      handleSelectQuiz(selectedQuizIndex - 1);
    }
  }, [currentFilteredIdx, filteredIndices, selectedQuizIndex]);

  const handleNextQuiz = useCallback(() => {
    if (currentFilteredIdx >= 0 && currentFilteredIdx < filteredIndices.length - 1) {
      handleSelectQuiz(filteredIndices[currentFilteredIdx + 1]);
    } else if (selectedQuizIndex < quizzes.length - 1) {
      handleSelectQuiz(selectedQuizIndex + 1);
    }
  }, [currentFilteredIdx, filteredIndices, selectedQuizIndex, quizzes.length]);

  const curQuiz = quizzes[selectedQuizIndex];

  return (
    <div className="flex flex-col h-screen bg-[#0b0f19] text-[#f3f4f6] font-sans antialiased overflow-hidden">
      <AppHeader subtitle="NotebookLM 퀴즈 & LaTeX 수식 뷰어" />

      {/* Toast 알림 */}
      {toast && (
        <div className="fixed top-16 right-6 z-50 animate-in fade-in slide-in-from-top-3 duration-200">
          <div
            className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-2xl border text-xs font-medium backdrop-blur-md ${
              toast.type === "success"
                ? "bg-emerald-950/80 border-emerald-500/40 text-emerald-200"
                : toast.type === "error"
                ? "bg-red-950/80 border-red-500/40 text-red-200"
                : "bg-blue-950/80 border-blue-500/40 text-blue-200"
            }`}
          >
            {toast.type === "success" ? (
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : toast.type === "error" ? (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            ) : (
              <HelpCircle className="w-4 h-4 text-blue-400 shrink-0" />
            )}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      <main className="flex-1 flex flex-col p-4 md:p-6 gap-3.5 overflow-hidden">
        {/* ======================================================== */}
        {/* 1. 상단 Quiz Load 영역 한 줄: [JSON 파일 선택] (url input) [Load] */}
        {/* ======================================================== */}
        <section className="glass p-3 rounded-2xl border border-white/10 flex flex-wrap items-center gap-2.5 shrink-0 shadow-lg">
          {/* JSON 파일 선택 버튼 */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={triggerFileSelect}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md shadow-orange-500/20 transition-all cursor-pointer select-none"
            title="로컬 컴퓨터에서 NotebookLM 추출 퀴즈 .json 파일을 선택합니다."
          >
            <FolderOpen className="w-4 h-4" />
            <span>JSON 파일 선택</span>
          </button>

          {/* 로드된 파일 정보 뱃지 */}
          {loadedFileName && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-mono text-gray-300 max-w-[220px] truncate">
              <FileCode className="w-3.5 h-3.5 text-orange-400 shrink-0" />
              <span className="truncate" title={loadedFileName}>
                {loadedFileName}
              </span>
              <span className="px-1.5 py-0.2 bg-orange-500/20 text-orange-300 text-[10px] rounded-md font-bold">
                {quizzes.length}개
              </span>
            </div>
          )}

          {/* 구분선 */}
          <div className="hidden sm:block h-6 w-px bg-white/10 mx-1" />

          {/* remote quiz json file url text input */}
          <div className="flex-1 min-w-[240px] flex items-center relative">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLoadUrl()}
              placeholder="원격 퀴즈 JSON URL 입력 (예: https://raw.githubusercontent.com/.../quiz.json 또는 S3/API 주소)"
              className="w-full bg-[#121824] border border-white/10 focus:border-orange-500/80 focus:ring-1 focus:ring-orange-500/40 rounded-xl px-3.5 py-2 text-xs font-mono text-gray-200 placeholder:text-gray-500 outline-none transition-all"
            />
            {urlInput && (
              <button
                type="button"
                onClick={() => setUrlInput("")}
                className="absolute right-2.5 text-gray-400 hover:text-white text-xs p-1"
                title="입력 지우기"
              >
                ✕
              </button>
            )}
          </div>

          {/* Load 버튼 */}
          <button
            type="button"
            onClick={handleLoadUrl}
            disabled={isLoading}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900/60 disabled:cursor-not-allowed active:scale-95 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-500/20 transition-all cursor-pointer select-none"
            title="입력된 URL의 JSON 퀴즈 파일을 다운로드하여 로드합니다."
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            <span>{isLoading ? "로드 중..." : "Load"}</span>
          </button>

          {/* 유틸리티 액션 */}
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              type="button"
              onClick={handleLoadSample}
              className="px-2.5 py-1.5 rounded-lg border border-white/10 hover:border-amber-500/40 hover:bg-amber-500/10 text-amber-300 text-xs font-medium flex items-center gap-1.5 transition-all"
              title="제출된 48문항 샘플 퀴즈를 불러옵니다."
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden md:inline">샘플 퀴즈 (48)</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadJson}
              className="px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/10 text-gray-300 text-xs font-medium flex items-center gap-1.5 transition-all"
              title="현재 퀴즈 목록을 JSON 파일로 저장"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden md:inline">JSON 저장</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm("퀴즈 목록을 모두 비우시겠습니까?")) {
                  setQuizzes([]);
                  setSelectedQuizIndex(-1);
                  setRawMarkdown("");
                  setLoadedFileName("");
                  showToast("퀴즈 목록이 초기화되었습니다.", "info");
                }
              }}
              className="px-2.5 py-1.5 rounded-lg border border-white/10 hover:border-red-500/40 hover:bg-red-500/10 text-red-300 text-xs font-medium flex items-center gap-1.5 transition-all"
              title="초기화"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </section>

        {/* ======================================================== */}
        {/* 2. 개별 퀴즈 토글 버튼 영역 */}
        {/* ======================================================== */}
        <section className="glass p-3 rounded-2xl border border-white/10 flex flex-col gap-2.5 shrink-0 shadow-lg max-h-[22vh] overflow-hidden">
          {/* 상단 단원 필터 & 네비게이션 */}
          <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
            <div className="flex items-center gap-1.5 flex-wrap">
              <ListOrdered className="w-4 h-4 text-orange-400" />
              <span className="font-bold text-gray-200 mr-1">퀴즈 선택:</span>
              <button
                type="button"
                onClick={() => setSelectedChapter("all")}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                  selectedChapter === "all"
                    ? "bg-orange-500 text-white shadow-md shadow-orange-500/30"
                    : "bg-white/5 border border-white/10 text-gray-400 hover:text-white"
                }`}
              >
                전체 ({quizzes.length})
              </button>
              {chapters.map((ch) => {
                const count = quizzes.filter((q) => getQuizChapter(q) === ch).length;
                const shortLabel = ch.length > 18 ? ch.substring(0, 18) + "..." : ch;
                return (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setSelectedChapter(ch)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all truncate max-w-[200px] ${
                      selectedChapter === ch
                        ? "bg-orange-500 text-white shadow-md shadow-orange-500/30"
                        : "bg-white/5 border border-white/10 text-gray-400 hover:text-white"
                    }`}
                    title={ch}
                  >
                    {shortLabel} ({count})
                  </button>
                );
              })}
            </div>

            {/* 이전/다음 퀴즈 버튼 */}
            {quizzes.length > 0 && (
              <div className="flex items-center gap-1 bg-black/30 p-0.5 rounded-lg border border-white/10 ml-auto">
                <button
                  type="button"
                  disabled={selectedQuizIndex <= 0}
                  onClick={() => handleSelectQuiz(selectedQuizIndex - 1)}
                  className="p-1 rounded hover:bg-white/10 text-gray-300 disabled:opacity-30 transition-all"
                  title="이전 퀴즈"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-2 text-[11px] font-mono font-bold text-orange-400">
                  {selectedQuizIndex + 1} / {quizzes.length}
                </span>
                <button
                  type="button"
                  disabled={selectedQuizIndex >= quizzes.length - 1}
                  onClick={() => handleSelectQuiz(selectedQuizIndex + 1)}
                  className="p-1 rounded hover:bg-white/10 text-gray-300 disabled:opacity-30 transition-all"
                  title="다음 퀴즈"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* 개별 퀴즈 토글 버튼 목록 (좌/우 화살표 아이콘 버튼 포함) */}
          {quizzes.length > 0 ? (
            <div className="flex items-center gap-2 overflow-hidden">
              {/* 좌화살표 아이콘 버튼 (이전 퀴즈) */}
              <button
                type="button"
                onClick={handlePrevQuiz}
                disabled={currentFilteredIdx <= 0 && selectedQuizIndex <= 0}
                className="px-3 py-2 rounded-xl bg-[#161d2d] hover:bg-orange-500 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-[#161d2d] disabled:hover:text-gray-400 border border-white/10 text-orange-400 font-bold text-xs shadow-md transition-all flex items-center justify-center shrink-0 cursor-pointer select-none active:scale-95 group"
                title="이전 퀴즈로 토글 (◀)"
              >
                <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                <span className="text-[10px] hidden sm:inline ml-1 font-mono">이전</span>
              </button>

              {/* 퀴즈 번호 토글 버튼 스크롤 목록 */}
              <div className="flex-1 flex flex-wrap gap-1.5 overflow-y-auto p-1 max-h-[14vh] custom-scrollbar">
                {filteredIndices.map((idx) => {
                  const q = quizzes[idx];
                  const isSelected = selectedQuizIndex === idx;
                  const label = getQuizNumberLabel(q, idx);

                  return (
                    <button
                      key={q.id || idx}
                      type="button"
                      onClick={() => handleSelectQuiz(idx)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-1.5 border shadow-sm cursor-pointer select-none ${
                        isSelected
                          ? "bg-gradient-to-r from-orange-500 to-amber-500 border-orange-400 text-white shadow-md shadow-orange-500/30 scale-105"
                          : "bg-[#121824] border-white/10 text-gray-300 hover:border-orange-500/50 hover:bg-white/5 hover:text-white"
                      }`}
                      title={`${getQuizChapter(q) ? `[${getQuizChapter(q)}] ` : ""}${getQuizQuestion(q)}`}
                    >
                      <span>{label}</span>
                      {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
                    </button>
                  );
                })}
              </div>

              {/* 우화살표 아이콘 버튼 (다음 퀴즈) */}
              <button
                type="button"
                onClick={handleNextQuiz}
                disabled={
                  currentFilteredIdx >= filteredIndices.length - 1 &&
                  selectedQuizIndex >= quizzes.length - 1
                }
                className="px-3 py-2 rounded-xl bg-[#161d2d] hover:bg-orange-500 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-[#161d2d] disabled:hover:text-gray-400 border border-white/10 text-orange-400 font-bold text-xs shadow-md transition-all flex items-center justify-center shrink-0 cursor-pointer select-none active:scale-95 group"
                title="다음 퀴즈로 토글 (▶)"
              >
                <span className="text-[10px] hidden sm:inline mr-1 font-mono">다음</span>
                <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>
          ) : (
            <div className="text-center py-3 text-xs text-gray-500">
              로드된 퀴즈가 없습니다. 상단에서 JSON 파일을 선택하거나 URL을 통해 로드하세요.
            </div>
          )}
        </section>

        {/* ======================================================== */}
        {/* 3. Textarea (9 rows) 편집 영역 & 4. Markdown Viewer 영역 */}
        {/* ======================================================== */}
        <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-hidden">
          {/* ---------------------------------------------------- */}
          {/* [3] Textarea (9 rows) 원본 편집기 */}
          {/* ---------------------------------------------------- */}
          <section className="glass rounded-2xl border border-white/10 flex flex-col shrink-0 overflow-hidden shadow-xl">
            {/* 편집기 헤더 바 */}
            <div className="px-4 py-2 bg-white/5 border-b border-white/5 flex items-center justify-between shrink-0 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-orange-400" />
                <span className="text-xs font-bold text-gray-200">
                  선택된 퀴즈 Raw Markdown (9 rows 편집 가능)
                </span>
                {curQuiz && (
                  <span className="text-[11px] text-orange-300 font-mono font-semibold bg-orange-500/10 px-2 py-0.5 rounded-md border border-orange-500/20">
                    {getQuizNumberLabel(curQuiz, selectedQuizIndex)}
                  </span>
                )}
              </div>

              {/* 빠른 수식 삽입 도구 */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-500 font-medium mr-1 hidden sm:inline">수식 삽입:</span>
                <button
                  type="button"
                  onClick={() => insertSnippet("$\\frac{a}{b}$")}
                  className="px-2 py-0.5 text-[10px] font-mono rounded bg-white/5 hover:bg-orange-500/20 text-orange-300 border border-white/10 transition-all"
                  title="분수"
                >
                  \frac
                </button>
                <button
                  type="button"
                  onClick={() => insertSnippet("$\\sqrt{x}$")}
                  className="px-2 py-0.5 text-[10px] font-mono rounded bg-white/5 hover:bg-orange-500/20 text-orange-300 border border-white/10 transition-all"
                  title="제곱근"
                >
                  \sqrt
                </button>
                <button
                  type="button"
                  onClick={() => insertSnippet("$$\\int_{a}^{b} f(x) \\, dx$$")}
                  className="px-2 py-0.5 text-[10px] font-mono rounded bg-white/5 hover:bg-orange-500/20 text-orange-300 border border-white/10 transition-all"
                  title="적분"
                >
                  \int
                </button>
                <button
                  type="button"
                  onClick={() => insertSnippet("$$\\sum_{k=1}^{n} a_k$$")}
                  className="px-2 py-0.5 text-[10px] font-mono rounded bg-white/5 hover:bg-orange-500/20 text-orange-300 border border-white/10 transition-all"
                  title="시그마"
                >
                  \sum
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-2 py-0.5 text-[10px] rounded bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 transition-all flex items-center gap-1 ml-2"
                  title="Markdown 복사"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? "복사됨" : "복사"}</span>
                </button>
              </div>
            </div>

            {/* 9줄 고정 Textarea */}
            <div className="p-2.5 bg-[#0d1117]/90">
              <textarea
                ref={textareaRef}
                rows={9}
                value={rawMarkdown}
                onChange={(e) => setRawMarkdown(e.target.value)}
                placeholder="상단 토글 버튼에서 퀴즈를 선택하거나 직접 마크다운과 LaTeX 수식을 입력하세요..."
                className="w-full bg-transparent text-gray-200 font-mono text-xs leading-relaxed p-2 outline-none resize-none border border-white/5 rounded-xl focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20 selection:bg-orange-500/30 custom-scrollbar"
                spellCheck={false}
              />
            </div>
          </section>

          {/* ---------------------------------------------------- */}
          {/* [4] Markdown & LaTeX Equation Viewer 영역 */}
          {/* ---------------------------------------------------- */}
          <section className="glass rounded-2xl border border-white/10 flex-1 flex flex-col min-h-0 overflow-hidden shadow-xl">
            {/* 뷰어 헤더 바 */}
            <div className="px-4 py-2 bg-white/5 border-b border-white/5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-gray-200">
                  퀴즈 Markdown & LaTeX 수식 뷰어
                </span>
                {getQuizChapter(curQuiz) && (
                  <span className="text-[10px] text-gray-400 flex items-center gap-1 font-medium truncate max-w-[280px]">
                    <BookOpen className="w-3 h-3 text-amber-400 inline" />
                    {getQuizChapter(curQuiz)}
                  </span>
                )}
                {getQuizSource(curQuiz) && (
                  <span className="text-[9px] text-amber-300/80 font-mono bg-white/5 px-2 py-0.5 rounded border border-white/10 hidden lg:inline">
                    {getQuizSource(curQuiz)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-gray-400 font-mono">
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold">
                  실시간 렌더링
                </span>
              </div>
            </div>

            {/* Markdown + KaTeX 렌더링 결과 본문 */}
            <div className="flex-1 overflow-y-auto p-6 md:p-8 bg-[#090d16]/85 selection:bg-blue-500/30 custom-scrollbar">
              {rawMarkdown.trim() ? (
                <div className="max-w-4xl mx-auto prose prose-invert prose-orange text-gray-200 text-sm leading-relaxed space-y-4">
                  <ReactMarkdown
                    remarkPlugins={[remarkMath, remarkGfm]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                      h1: ({ children }) => (
                        <h1 className="text-xl md:text-2xl font-extrabold text-white border-b border-white/10 pb-2 mb-3 mt-1 tracking-tight">
                          {children}
                        </h1>
                      ),
                      h2: ({ children }) => (
                        <h2 className="text-lg md:text-xl font-bold text-orange-400 border-b border-white/5 pb-1 mb-2.5 mt-4">
                          {children}
                        </h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className="text-base font-bold text-amber-300 mb-2 mt-3 flex items-center gap-1.5">
                          {children}
                        </h3>
                      ),
                      h4: ({ children }) => (
                        <h4 className="text-sm font-bold text-orange-300/90 mb-1.5 mt-3">{children}</h4>
                      ),
                      p: ({ children }) => <p className="mb-2.5 text-gray-200 leading-relaxed">{children}</p>,
                      blockquote: ({ children }) => (
                        <blockquote className="border-l-4 border-amber-500/80 bg-amber-500/5 px-4 py-2 rounded-r-xl my-2.5 text-gray-300 text-xs">
                          {children}
                        </blockquote>
                      ),
                      hr: () => <hr className="border-white/10 my-4" />,
                      ul: ({ children }) => (
                        <ul className="list-disc list-inside space-y-1 my-2 text-gray-300">{children}</ul>
                      ),
                      ol: ({ children }) => (
                        <ol className="list-decimal list-inside space-y-1 my-2 text-gray-300">{children}</ol>
                      ),
                      code: ({ className, children, ...props }) => {
                        const match = /language-(\w+)/.exec(className || "");
                        const isInline = !match && !String(children).includes("\n");
                        return isInline ? (
                          <code className="bg-white/10 text-amber-300 px-1.5 py-0.5 rounded text-[11px] font-mono border border-white/10" {...props}>
                            {children}
                          </code>
                        ) : (
                          <pre className="p-3 my-2 overflow-x-auto rounded-xl border border-white/10 bg-[#0d1117] font-mono text-xs text-gray-200 leading-relaxed">
                            <code>{children}</code>
                          </pre>
                        );
                      },
                    }}
                  >
                    {rawMarkdown}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 text-gray-500">
                  <Eye className="w-8 h-8 text-gray-500 mb-2 opacity-40" />
                  <p className="text-xs text-gray-400">표시할 퀴즈 내용이 없습니다.</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* KaTeX 수식 전용 스타일 */}
      <style jsx global>{`
        .katex-display {
          margin: 1rem 0 !important;
          padding: 0.75rem 1rem !important;
          background: rgba(255, 255, 255, 0.02) !important;
          border-radius: 0.75rem !important;
          border: 1px solid rgba(255, 255, 255, 0.05) !important;
          overflow-x: auto !important;
          overflow-y: hidden !important;
        }
        .katex {
          font-size: 1.08em !important;
          color: #f8fafc !important;
        }
        .katex .mord.mathnormal {
          color: #fbbf24 !important;
        }
      `}</style>
    </div>
  );
}
