"use client";

import { useState, useRef, useMemo, useEffect, useCallback } from "react";
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
  Maximize2,
  Minimize2,
  HelpCircle,
  ExternalLink,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

const SAMPLE_MD_MATH = `# 고등수학 & LaTeX 수식 뷰어 샘플

이 페이지는 **Markdown** 문서와 **LaTeX 수식**을 실시간으로 렌더링하는 뷰어입니다.

---

## 1. 기본 대수 및 이차방정식
근의 공식(Quadratic Formula)은 다음과 같습니다:
$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$

인라인 수식 예시: 판별식 $D = b^2 - 4ac > 0$ 이면 서로 다른 두 실근을 갖습니다.

---

## 2. 미적분학 (Calculus)
함수 $f(x)$에 대한 정적분과 미적분학의 기본정리:
$$\\int_{a}^{b} f(x) \\, dx = F(b) - F(a) = \\left[ F(x) \\right]_{a}^{b}$$

극한과 도함수의 정의:
$$f'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}$$

다변수 함수의 편미분 및 가우스 적분:
$$\\int_{-\\infty}^{\\infty} e^{-x^2} \\, dx = \\sqrt{\\pi}$$

---

## 3. 행렬과 선형대수학 (Linear Algebra)
$2 \\times 2$ 행렬의 역행렬:
$$A = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}, \\quad A^{-1} = \\frac{1}{ad - bc} \\begin{pmatrix} d & -b \\\\ -c & a \\end{pmatrix}$$

고유값 방정식:
$$\\det(A - \\lambda I) = 0$$

---

## 4. 시그마 수열과 무한급수
$$\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}, \\quad \\sum_{k=1}^{n} k^2 = \\frac{n(n+1)(2n+1)}{6}$$

오일러 공식 (Euler's Identity):
$$e^{i\\pi} + 1 = 0$$

---

## 5. 표(Table) 및 체크리스트 예시

| 수식 종류 | LaTeX 표현 | 설명 |
| :--- | :--- | :--- |
| 분수 | \`\\frac{a}{b}\` | 분자와 분모 표현 |
| 제곱근 | \`\\sqrt[n]{x}\` | n제곱근 표현 |
| 적분 | \`\\int_{a}^{b} f(x) dx\` | 정적분 기호 |
| 시그마 | \`\\sum_{i=1}^{n} x_i\` | 수열의 합 기호 |

- [x] '파일 선택'으로 로컬 .md 파일 불러오기
- [x] 'Load'로 원격 URL .md 파일 다운로드
- [x] 24줄 편집기에서 실시간 수정 및 동기화
- [x] LaTeX inline ($...$) 및 block ($$...$$) 수식 렌더링
`;

export default function MdViewerPage() {
  const [mdContent, setMdContent] = useState<string>(SAMPLE_MD_MATH);
  const [urlInput, setUrlInput] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadedFileName, setLoadedFileName] = useState<string>("sample-math.md");
  const [copied, setCopied] = useState<boolean>(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [layoutMode, setLayoutMode] = useState<"stacked" | "split">("stacked");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 3500);
  }, []);

  // 1. 파일 선택 핸들러
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = file.name;
    const reader = new FileReader();

    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (typeof content === "string") {
        setMdContent(content);
        setLoadedFileName(fileName);
        showToast(`'${fileName}' 파일을 불러왔습니다. (${content.length.toLocaleString()} 자)`, "success");
      }
    };

    reader.onerror = () => {
      showToast("파일을 읽는 중 오류가 발생했습니다.", "error");
    };

    reader.readAsText(file);
    // 동일 파일 재선택 가능하도록 초기화
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
      showToast("MD 파일 주소(URL)를 입력해주세요.", "error");
      return;
    }

    setIsLoading(true);
    try {
      let content = "";
      let sourceName = "";

      try {
        const parsedUrl = new URL(trimmed);
        sourceName = parsedUrl.pathname.split("/").pop() || "downloaded.md";
      } catch {
        sourceName = "downloaded.md";
      }

      // 1단계: 직접 fetch 시도
      let success = false;
      try {
        const directResp = await fetch(trimmed, { method: "GET" });
        if (directResp.ok) {
          content = await directResp.text();
          success = true;
        }
      } catch {
        // CORS 또는 직접 호출 차단 시 프록시 fallback
        success = false;
      }

      // 2단계: 프록시 API fallback (/api/proxy-md?url=...)
      if (!success) {
        const proxyResp = await fetch(`/api/proxy-md?url=${encodeURIComponent(trimmed)}`);
        if (!proxyResp.ok) {
          const errJson = await proxyResp.json().catch(() => ({}));
          throw new Error(errJson.error || `HTTP ${proxyResp.status} 다운로드 실패`);
        }
        content = await proxyResp.text();
      }

      setMdContent(content);
      setLoadedFileName(sourceName);
      showToast(`'${sourceName}' URL로부터 로드 완료! (${content.length.toLocaleString()} 자)`, "success");
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "파일 다운로드 실패";
      showToast(`다운로드 오류: ${errMsg}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  // 클립보드 복사
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(mdContent);
      setCopied(true);
      showToast("Markdown 내용이 클립보드에 복사되었습니다.", "success");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("클립보드 복사 실패", "error");
    }
  };

  // 로컬 파일 다운로드
  const handleDownload = () => {
    const blob = new Blob([mdContent], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = loadedFileName || "document.md";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`'${a.download}' 파일로 다운로드되었습니다.`, "success");
  };

  // 내용 초기화
  const handleClear = () => {
    if (window.confirm("편집기 내용을 모두 비우시겠습니까?")) {
      setMdContent("");
      setLoadedFileName("");
      showToast("내용이 초기화되었습니다.", "info");
    }
  };

  // 샘플 수식 로드
  const handleLoadSample = () => {
    setMdContent(SAMPLE_MD_MATH);
    setLoadedFileName("sample-math.md");
    showToast("샘플 수식 Markdown을 불러왔습니다.", "success");
  };

  // 수식 템플릿 삽입 도우미
  const insertSnippet = (snippet: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setMdContent((prev) => prev + "\n" + snippet);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const current = mdContent;
    const next = current.substring(0, start) + snippet + current.substring(end);
    setMdContent(next);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + snippet.length, start + snippet.length);
    }, 0);
  };

  // 통계 계산 (줄 수, 단어 수, 글자 수)
  const stats = useMemo(() => {
    const lines = mdContent ? mdContent.split("\n").length : 0;
    const chars = mdContent.length;
    const mathBlocks = (mdContent.match(/\$\$[\s\S]*?\$\$/g) || []).length;
    const inlineMath = (mdContent.match(/(?<!\$)\$(?!\$)[\s\S]*?(?<!\$)\$(?!\$)/g) || []).length;
    return { lines, chars, mathBlocks, inlineMath };
  }, [mdContent]);

  return (
    <div className="flex flex-col h-screen bg-[#0b0f19] text-[#f3f4f6] font-sans antialiased overflow-hidden">
      <AppHeader subtitle="Markdown & LaTeX 수식 뷰어" />

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

      <main className="flex-1 flex flex-col p-4 md:p-6 gap-4 overflow-hidden">
        {/* ======================================================== */}
        {/* 1. 상위 한 줄: [파일 선택] (md file url text input) [Load] */}
        {/* ======================================================== */}
        <section className="glass p-3 rounded-2xl border border-white/10 flex flex-wrap items-center gap-2.5 shrink-0 shadow-lg">
          {/* 파일 선택 버튼 (숨김 input 트리거) */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={triggerFileSelect}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md shadow-orange-500/20 transition-all cursor-pointer select-none"
            title="로컬 컴퓨터에서 .md 또는 .txt 파일을 선택하여 로드합니다."
          >
            <FolderOpen className="w-4 h-4" />
            <span>파일 선택</span>
          </button>

          {/* 로드된 파일명 표시 뱃지 */}
          {loadedFileName && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-mono text-gray-300 max-w-[220px] truncate">
              <FileCode className="w-3.5 h-3.5 text-orange-400 shrink-0" />
              <span className="truncate" title={loadedFileName}>
                {loadedFileName}
              </span>
            </div>
          )}

          {/* 구분자 */}
          <div className="hidden sm:block h-6 w-px bg-white/10 mx-1" />

          {/* md file url text input */}
          <div className="flex-1 min-w-[240px] flex items-center relative">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLoadUrl()}
              placeholder="MD 파일 URL 입력 (예: https://raw.githubusercontent.com/... 또는 S3/API 주소)"
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
            title="입력된 URL의 마크다운 파일을 다운로드하여 편집기에 불러옵니다."
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            <span>{isLoading ? "로드 중..." : "Load"}</span>
          </button>

          {/* 부가 유틸리티 버튼 모음 */}
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              type="button"
              onClick={handleLoadSample}
              className="px-2.5 py-1.5 rounded-lg border border-white/10 hover:border-amber-500/40 hover:bg-amber-500/10 text-amber-300 text-xs font-medium flex items-center gap-1.5 transition-all"
              title="수식 예제가 포함된 샘플 마크다운을 불러옵니다."
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden md:inline">샘플 수식</span>
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/10 text-gray-300 text-xs font-medium flex items-center gap-1.5 transition-all"
              title="마크다운 텍스트 복사"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="hidden md:inline">{copied ? "복사됨" : "복사"}</span>
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/10 text-gray-300 text-xs font-medium flex items-center gap-1.5 transition-all"
              title=".md 파일로 저장"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden md:inline">저장</span>
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="px-2.5 py-1.5 rounded-lg border border-white/10 hover:border-red-500/40 hover:bg-red-500/10 text-red-300 text-xs font-medium flex items-center gap-1.5 transition-all"
              title="편집기 내용 초기화"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode((m) => (m === "stacked" ? "split" : "stacked"))}
              className="px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/10 text-gray-300 text-xs font-medium flex items-center gap-1.5 transition-all"
              title={layoutMode === "stacked" ? "좌우 분할 뷰로 전환" : "상하 기본 뷰로 전환"}
            >
              {layoutMode === "stacked" ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
              <span className="hidden lg:inline">{layoutMode === "stacked" ? "좌우 분할" : "상하 배치"}</span>
            </button>
          </div>
        </section>

        {/* ======================================================== */}
        {/* 2 & 3. 24줄 Textarea 편집기 & MD + LaTeX 수식 뷰어 영역 */}
        {/* ======================================================== */}
        <div
          className={`flex-1 flex ${
            layoutMode === "stacked" ? "flex-col" : "flex-col lg:flex-row"
          } gap-4 min-h-0 overflow-hidden`}
        >
          {/* ---------------------------------------------------- */}
          {/* [2] 24줄 textarea 편집 가능 영역 */}
          {/* ---------------------------------------------------- */}
          <section
            className={`glass rounded-2xl border border-white/10 flex flex-col overflow-hidden shadow-xl ${
              layoutMode === "stacked" ? "shrink-0 max-h-[44vh] md:max-h-[48vh]" : "lg:w-1/2 flex-1"
            }`}
          >
            {/* 편집기 헤더 바 */}
            <div className="px-4 py-2 bg-white/5 border-b border-white/5 flex items-center justify-between shrink-0 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-orange-400" />
                <span className="text-xs font-bold text-gray-200">Markdown 원문 편집기 (24줄)</span>
                <span className="text-[10px] text-gray-500 font-mono">
                  {stats.lines}줄 · {stats.chars.toLocaleString()}자 · 수식 {stats.mathBlocks + stats.inlineMath}개
                </span>
              </div>

              {/* 빠른 수식 기호 삽입 툴바 */}
              <div className="flex items-center gap-1 overflow-x-auto py-0.5">
                <span className="text-[10px] text-gray-500 font-medium mr-1 hidden sm:inline">빠른 삽입:</span>
                <button
                  type="button"
                  onClick={() => insertSnippet("$\\frac{a}{b}$")}
                  className="px-2 py-0.5 text-[10px] font-mono rounded bg-white/5 hover:bg-orange-500/20 text-orange-300 border border-white/10 transition-all"
                  title="분수 삽입"
                >
                  \frac
                </button>
                <button
                  type="button"
                  onClick={() => insertSnippet("$\\sqrt{x}$")}
                  className="px-2 py-0.5 text-[10px] font-mono rounded bg-white/5 hover:bg-orange-500/20 text-orange-300 border border-white/10 transition-all"
                  title="제곱근 삽입"
                >
                  \sqrt
                </button>
                <button
                  type="button"
                  onClick={() => insertSnippet("$$\\int_{a}^{b} f(x) \\, dx$$")}
                  className="px-2 py-0.5 text-[10px] font-mono rounded bg-white/5 hover:bg-orange-500/20 text-orange-300 border border-white/10 transition-all"
                  title="정적분 블록 삽입"
                >
                  \int
                </button>
                <button
                  type="button"
                  onClick={() => insertSnippet("$$\\sum_{k=1}^{n} a_k$$")}
                  className="px-2 py-0.5 text-[10px] font-mono rounded bg-white/5 hover:bg-orange-500/20 text-orange-300 border border-white/10 transition-all"
                  title="시그마 합 블록 삽입"
                >
                  \sum
                </button>
                <button
                  type="button"
                  onClick={() => insertSnippet("$$A = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$$")}
                  className="px-2 py-0.5 text-[10px] font-mono rounded bg-white/5 hover:bg-orange-500/20 text-orange-300 border border-white/10 transition-all"
                  title="행렬 블록 삽입"
                >
                  \matrix
                </button>
              </div>
            </div>

            {/* Textarea: 24줄 지정 (rows=24) 및 실시간 동기화 */}
            <div className="flex-1 p-3 bg-[#0d1117]/90 overflow-hidden flex flex-col">
              <textarea
                ref={textareaRef}
                rows={24}
                value={mdContent}
                onChange={(e) => setMdContent(e.target.value)}
                placeholder="여기에 Markdown 내용을 입력하거나, 상단 '파일 선택' 또는 'Load' 버튼으로 문서를 불러오세요..."
                className="w-full flex-1 bg-transparent text-gray-200 font-mono text-xs leading-relaxed p-2.5 outline-none resize-none border border-white/5 rounded-xl focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20 selection:bg-orange-500/30 overflow-y-auto"
                spellCheck={false}
              />
            </div>
          </section>

          {/* ---------------------------------------------------- */}
          {/* [3] Body 나머지 영역: MD Viewer (LaTeX Equation 지원) */}
          {/* ---------------------------------------------------- */}
          <section
            className={`glass rounded-2xl border border-white/10 flex flex-col overflow-hidden shadow-xl ${
              layoutMode === "stacked" ? "flex-1 min-h-0" : "lg:w-1/2 flex-1"
            }`}
          >
            {/* 뷰어 헤더 바 */}
            <div className="px-4 py-2 bg-white/5 border-b border-white/5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-gray-200">Markdown & LaTeX 수식 렌더링 뷰어</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-semibold text-emerald-400">
                  KaTeX Active
                </span>
              </div>
              <div className="text-[10px] text-gray-400 font-mono">실시간 자동 렌더링 중</div>
            </div>

            {/* Markdown + LaTeX 수식 렌더링 컨테이너 */}
            <div className="flex-1 overflow-y-auto p-6 md:p-8 bg-[#090d16]/80 selection:bg-blue-500/30">
              {mdContent.trim() ? (
                <div className="max-w-4xl mx-auto prose prose-invert prose-orange text-gray-200 text-sm leading-relaxed space-y-4">
                  <ReactMarkdown
                    remarkPlugins={[remarkMath, remarkGfm]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                      // 헤딩 스타일 커스텀
                      h1: ({ children }) => (
                        <h1 className="text-xl md:text-2xl font-extrabold text-white border-b border-white/10 pb-2 mb-4 mt-2 tracking-tight">
                          {children}
                        </h1>
                      ),
                      h2: ({ children }) => (
                        <h2 className="text-lg md:text-xl font-bold text-orange-400 border-b border-white/5 pb-1.5 mb-3 mt-6">
                          {children}
                        </h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className="text-base font-bold text-amber-300 mb-2 mt-4">{children}</h3>
                      ),
                      h4: ({ children }) => (
                        <h4 className="text-sm font-bold text-gray-200 mb-1.5 mt-3">{children}</h4>
                      ),
                      // 단락
                      p: ({ children }) => <p className="mb-3 text-gray-300 leading-relaxed">{children}</p>,
                      // 블록 인용구
                      blockquote: ({ children }) => (
                        <blockquote className="border-l-4 border-orange-500/80 bg-orange-500/5 px-4 py-2 rounded-r-xl my-3 text-gray-300 italic">
                          {children}
                        </blockquote>
                      ),
                      // 링크
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 underline underline-offset-4 inline-flex items-center gap-0.5"
                        >
                          {children}
                          <ExternalLink className="w-3 h-3 inline" />
                        </a>
                      ),
                      // 표 스타일링
                      table: ({ children }) => (
                        <div className="overflow-x-auto my-4 rounded-xl border border-white/10 shadow-lg">
                          <table className="w-full text-left text-xs border-collapse">{children}</table>
                        </div>
                      ),
                      thead: ({ children }) => <thead className="bg-white/5 text-gray-200">{children}</thead>,
                      th: ({ children }) => (
                        <th className="p-3 border-b border-white/10 font-bold text-orange-400 uppercase tracking-wider">
                          {children}
                        </th>
                      ),
                      td: ({ children }) => (
                        <td className="p-3 border-b border-white/5 text-gray-300">{children}</td>
                      ),
                      // 코드 블록 & 인라인 코드
                      code: ({ className, children, ...props }) => {
                        const match = /language-(\w+)/.exec(className || "");
                        const isInline = !match && !String(children).includes("\n");
                        return isInline ? (
                          <code className="bg-white/10 text-amber-300 px-1.5 py-0.5 rounded text-[11px] font-mono border border-white/10" {...props}>
                            {children}
                          </code>
                        ) : (
                          <div className="relative my-3 rounded-xl overflow-hidden border border-white/10 bg-[#0d1117] shadow-lg">
                            {match && (
                              <div className="px-3 py-1 bg-white/5 border-b border-white/5 text-[10px] font-mono text-gray-400 uppercase">
                                {match[1]}
                              </div>
                            )}
                            <pre className="p-3.5 overflow-x-auto font-mono text-xs text-gray-200 leading-relaxed">
                              <code>{children}</code>
                            </pre>
                          </div>
                        );
                      },
                      // 구분선
                      hr: () => <hr className="border-white/10 my-6" />,
                      // 목록
                      ul: ({ children }) => <ul className="list-disc list-inside space-y-1 my-2 text-gray-300">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 my-2 text-gray-300">{children}</ol>,
                    }}
                  >
                    {mdContent}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 text-gray-500">
                  <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-3">
                    <FileText className="w-7 h-7 text-gray-500" />
                  </div>
                  <p className="text-sm font-semibold text-gray-400 mb-1">표시할 Markdown 내용이 없습니다</p>
                  <p className="text-xs text-gray-500 max-w-sm mb-4">
                    상단의 <strong>'파일 선택'</strong>으로 로컬 문서를 열거나, <strong>URL</strong>을 입력하여 로드하거나, 아래 버튼을 눌러 샘플 수식을 확인해보세요.
                  </p>
                  <button
                    type="button"
                    onClick={handleLoadSample}
                    className="px-4 py-2 rounded-xl bg-orange-500/20 border border-orange-500/40 text-orange-300 text-xs font-bold hover:bg-orange-500/30 transition-all flex items-center gap-1.5"
                  >
                    <Sparkles className="w-4 h-4" />
                    샘플 수식 Markdown 불러오기
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* KaTeX 수식 블록 전용 스타일 */}
      <style jsx global>{`
        .katex-display {
          margin: 1.2rem 0 !important;
          padding: 0.8rem 1rem !important;
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
