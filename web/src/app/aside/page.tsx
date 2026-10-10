"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Check,
  Download,
  FileText,
  BookOpen,
  HelpCircle,
  Layers,
  Sparkles,
  BookMarked,
  Library,
  AlertCircle,
  X,
} from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { fetchBookTocs, fetchDocs, fetchToc } from "@/lib/ocrApi";
import { commentaryList, stripExt } from "@/lib/toc";
import type { BookTocRow, DocEntry, SelectedBook, TocData } from "@/lib/types";

const navBtn =
  "p-1.5 rounded-lg border border-white/10 hover:bg-white/10 text-gray-300 disabled:opacity-30 disabled:hover:bg-transparent transition-all";
const tabIdle = "border-white/10 bg-white/5 text-gray-300 hover:border-white/20";
const tabActive = "border-orange-500 bg-orange-500/20 text-orange-400 font-bold";

type Toast = { msg: string; type: "success" | "error" | "info" } | null;

interface PromptItem {
  id: string;
  title: string;
  buttonLabel: string;
  icon: typeof Sparkles;
  description: string;
  defaultValue: string;
  origin_page: number | null | undefined;
}

const DEFAULT_PROMPTS: PromptItem[] = [
  {
    id: "toc",
    title: "1. TOC 생성 Prompt",
    buttonLabel: "TOC 생성 Prompt 복사",
    icon: Layers,
    description: "교재의 계층적 목차(대단원, 중단원, 소단원, 개념 항목) 및 시작 페이지 JSON 추출",
    defaultValue:
      "다음 수학 교재 PDF 본문 및 목차 정보를 정밀하게 분석하여 계층적 목차(TOC) 구조를 JSON 형식으로 생성해 주세요.\n- 대단원(Chapter), 중단원(Section), 소단원 및 개념 항목(Item)과 각 항목의 정확한 시작 페이지 번호를 누락 없이 추출할 것.\n- 출력 JSON 스키마:\n{\n  \"bookTitle\": \"교재명\",\n  \"chapters\": [\n    {\n      \"chapterId\": \"1\",\n      \"chapterTitle\": \"대단원명\",\n      \"sections\": [\n        {\n          \"sectionId\": \"1-1\",\n          \"sectionTitle\": \"중단원명\",\n          \"page\": 10,\n          \"items\": [{ \"name\": \"소단원/개념항목명\", \"page\": 10 }]\n        }\n      ]\n    }\n  ]\n}",
    origin_page: 0
  },
  {
    id: "flashcard",
    title: "2. 플래시카드 생성 Prompt",
    buttonLabel: "플래쉬 카드 생성 프람프트 복사",
    icon: Sparkles,
    description: "핵심 수학 공식, 정리, 성질 및 개념 암기를 위한 앞면/뒷면 플래시카드 데이터셋 생성",
    defaultValue:
      "다음 수학 교재 단원 내용을 바탕으로 학생들의 단원별 핵심 개념 암기 및 공식 숙달을 위한 앞면/뒷면 플래시카드 데이터 세트를 출처 페이지와 함께 생성해 주세요.\n- 앞면(front): 핵심 질문, 수학적 개념 명칭, 또는 빈칸 완성형 질문\n- 뒷면(back): 정확한 수학적 정의, 관련 공식(LaTeX $...$ 또는 $$...$$ 표기), 성질 및 적용 조건\n- 카테고리(category): 정의, 공식, 정리, 성질 중 하나로 분류\n- 출처 페이지(origin_page): 해당 내용이 시작된 페이지 번호\n- 출력 JSON 형식:\n[\n  {\n    \"front\": \"이차방정식의 근의 공식은?\",\n    \"back\": \"계수가 실수인 이차방정식 $ax^2 + bx + c = 0$ ($a \\neq 0$)에서 $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$\",\n    \"category\": \"공식\",\n    \"origin_page\": 12\n  }\n]",
    origin_page: 12
  },
  {
    id: "quiz",
    title: "3. 퀴즈 생성 Prompt",
    buttonLabel: "쿼즈 생성 프람프트 복사",
    icon: HelpCircle,
    description: "수식(LaTeX) 및 상세 풀이 해설을 포함한 4지선다/단답형 개념 확인 퀴즈 생성",
    defaultValue:
      "다음 교재 단원 내용에서 학생들의 수학적 이해도와 문제 해결력을 평가할 수 있는 단원별 서술형 퀴즈 출처 페이지와 함께 생성해 주세요.\n- 모든 수식, 기호, 변수는 반드시 표준 LaTeX 포맷($...$, $$...$$)으로 작성할 것.\n- 각 문항마다 question(문제), correct_answer(정답), explanation(상세 풀이 해설),출처 페이지(origin_page:해당 내용이 시작된 페이지 번호)를 포함할 것.\n- 출력 JSON 형식:\n[\n  {\n    \"id\": 1,\n    \"type\": \"multiple_choice\",\n    \"question\": \"함수 $f(x) = x^3 - 3x + 1$의 극댓값은?\",\n    \"correct_answer\": \"$3$\",\n    \"explanation\": \"$f'(x) = 3x^2 - 3 = 3(x-1)(x+1) = 0$에서 $x = -1$일 때 극댓값 $f(-1) = -1 + 3 + 1 = 3$을 갖는다.\",\n    \"origin_page\": 12\n  }\n]",
    origin_page: 0
  },
  {
    id: "index",
    title: "4. 색인 생성 Prompt",
    buttonLabel: "색인 생성 프롬프트 복사",
    icon: BookMarked,
    description: "단원별 주요 수학 용어, 정리, 개념어 및 출현 페이지 색인(Index) 목록 추출",
    defaultValue:
      "단원별 주요 수학 전문 용어, 정리, 법칙, 공식 및 핵심 개념어를 가나다순으로 추출하여 색인(Index) 목록을 작성해 주세요.\n- 각 항목마다 용어명(term), 교재 내 출현 단원 및 주요 페이지 번호(pages), 그리고 해당 개념의 간결한 1줄 요약 정의(definition)를 매핑할 것.\n- 출력 JSON 형식:\n[\n  {\n    \"term\": \"미분계수 (Derivative Coefficient)\",\n    \"pages\": [42, 45, 51],\n    \"section\": \"II. 미분법 > 1. 미분계수와 도함수\",\n    \"definition\": \"함수 $y=f(x)$에서 $x$의 증분 $\\Delta x$에 대한 $y$의 증분 $\\Delta y$의 극한값 $\\lim_{\\Delta x \\to 0} \\frac{f(x+\\Delta x)-f(x)}{\\Delta x}$\"\n  }\n]",
    origin_page: 0
  },
  {
    id: "dictionary",
    title: "5. 딕셔너리 생성 Prompt",
    buttonLabel: "딕셔너리 생성 프롬프트 복사",
    icon: Library,
    description: "색인 기반 수학 용어 사전(정의, 공식, 선수 개념, 연계 개념) 구축",
    defaultValue:
      "색인 기반 수학 용어 사전(Math Dictionary) 데이터를 구축해 주세요.\n- 용어 표제어(term), 한자/영문 표기(subTerm), 수학적 정의(definition, LaTeX 수식 포함), 관련 공식 및 성질(formulas), 선수 개념(prerequisites), 연계 발전 개념(relatedConcepts)을 구조화할 것.\n- 출력 JSON 형식:\n[\n  {\n    \"term\": \"정적분 (Definite Integral)\",\n    \"definition\": \"닫힌구간 $[a, b]$에서 연속인 함수 $f(x)$의 부정적분 중 하나를 $F(x)$라 할 때, $[F(x)]_a^b = F(b) - F(a)$를 $f(x)$의 $a$에서 $b$까지의 정적분이라 한다.\",\n    \"formula\": \"$\\int_a^b f(x)\\,dx = [F(x)]_a^b = F(b) - F(a)$\",\n    \"prerequisites\": [\"부정적분\", \"함수의 극한과 연속\"],\n    \"relatedConcepts\": [\"정적분과 넓이\", \"정적분으로 정의된 함수\"]\n  }\n]",
    origin_page: 0
  },
];

export default function AsidePage() {
  // BookToc (상단 1번째 줄)
  const [writer, setWriter] = useState("");
  const [bookTocs, setBookTocs] = useState<BookTocRow[] | null>(null);
  const [btPage, setBtPage] = useState({ page: 0, totalPages: 1, total: 0 });
  const [btError, setBtError] = useState(false);

  // TOC 문서 (상단 2번째 줄)
  const [docs, setDocs] = useState<DocEntry[] | null>(null);
  const [docPage, setDocPage] = useState({ page: 1, totalPages: 1, total: 0 });
  const [docError, setDocError] = useState(false);

  // 현재 선택된 Document 및 BookToc
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [currentDocument, setCurrentDocument] = useState<DocEntry | null>(null);
  const [currentBook, setCurrentBook] = useState<SelectedBook | null>(null);

  // 모달 상태: 다큐먼트 클릭 시 확인 모달 표시
  const [pendingDoc, setPendingDoc] = useState<DocEntry | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // 프롬프트 입력 상태 (5개)
  const [prompts, setPrompts] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    DEFAULT_PROMPTS.forEach((p) => {
      initial[p.id] = p.defaultValue;
    });
    return initial;
  });

  // 복사 피드백 상태
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 토스트 알림 상태
  const [toast, setToast] = useState<Toast>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushToast = useCallback((msg: string, type: "success" | "error" | "info" = "success") => {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const onError = useCallback(
    (e: unknown) => pushToast(`조회 실패: ${(e as Error).message}`, "error"),
    [pushToast]
  );

  // BookToc 목록 불러오기
  // const loadBookTocs = useCallback(
  //   async (page: number) => {
  //     setBookTocs(null);
  //     setBtError(false);
  //     try {
  //       const data = await fetchBookTocs(page);
  //       setWriter(data.writer);
  //       setBookTocs(data.content || []);
  //       setBtPage({ page: data.number ?? page, totalPages: data.totalPages || 1, total: data.totalElements || 0 });
  //     } catch (e) {
  //       setBtError(true);
  //       onError(e);
  //     }
  //   },
  //   [onError]
  // );

  // TOC 문서 목록 불러오기
  const loadDocs = useCallback(
    async (page: number) => {
      setDocs(null);
      setDocError(false);
      try {
        const data = await fetchDocs(page);
        setDocs(data.entries || []);
        setDocPage({ page: data.page || page, totalPages: data.total_pages || 1, total: data.total || 0 });
      } catch (e) {
        setDocError(true);
        onError(e);
      }
    },
    [onError]
  );

  useEffect(() => {
    // loadBookTocs(0);
    loadDocs(1);
  }, [loadDocs]);

  // BookToc 항목 클릭 시
  const handleSelectBookToc = (b: BookTocRow) => {
    setSelectedKey(`booktoc:${b.id}`);
    let toc: TocData | null = null;
    try {
      toc = b.toc ? JSON.parse(b.toc) : null;
    } catch {
      pushToast("TOC 파싱 오류", "error");
    }
    const selected: SelectedBook = {
      source: "booktoc",
      sourceId: String(b.id),
      title: b.bookTitle,
      stem: stripExt(b.pdfFilename),
      documentId: toc?.documentId ?? null,
      toc,
      commentaryStem: stripExt(commentaryList(toc)[0] || ""),
    };
    setCurrentBook(selected);
    pushToast(`'${b.bookTitle}' BookToc이 선택되었습니다.`, "info");
  };

  // 다큐먼트 항목 클릭 시 -> "다운로드 하시겠습니까?" 모달 띄우기
  const handleDocClick = (d: DocEntry) => {
    setPendingDoc(d);
    setIsModalOpen(true);
  };

  // PDF 파일 다운로드 헬퍼
  const downloadFile = (url: string, filename: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // 모달에서 '예' 클릭 시 -> 다큐먼트의 모든 PDF (본문, 부록, 해설서, 답안) 다운로드 및 currentDocument 설정
  const handleConfirmDownload = async () => {
    if (!pendingDoc) return;
    const doc = pendingDoc;
    setIsDownloading(true);

    try {
      // 1. 해당 문서의 TOC 정보 조회 (해설서/부록/답안 정보 확인용)
      let toc: TocData | null = null;
      try {
        toc = await fetchToc(doc.id);
      } catch {
        // TOC 조회 실패 시에도 기본 파일명으로 진행
      }

      const stem = doc.main_stem || stripExt(doc.name);
      const commList = commentaryList(toc);
      const commStem = commList[0] ? stripExt(commList[0]) : `${stem}_해설서`;

      // 2. 모든 PDF 파일 다운로드 트리거 (본문, 부록, 해설서, 답안)
      const pdfFiles = [
        {
          label: "본문",
          filename: `${stem}.pdf`,
          url: `https://s3.qoolla.com/qoollastorage/origin/${encodeURIComponent(stem)}.pdf`,
        },
        {
          label: "부록",
          filename: `${stem}_부록.pdf`,
          url: `https://s3.qoolla.com/qoollastorage/origin/${encodeURIComponent(stem)}_부록.pdf`,
        },
        {
          label: "해설서",
          filename: `${commStem}.pdf`,
          url: `https://s3.qoolla.com/qoollastorage/commentaries/${encodeURIComponent(commStem)}.pdf`,
        },
        {
          label: "답안",
          filename: `${stem}_답안.pdf`,
          url: `https://s3.qoolla.com/qoollastorage/origin/${encodeURIComponent(stem)}_답안.pdf`,
        },
      ];

      // 각 PDF 다운로드 실행
      pdfFiles.forEach((file, index) => {
        setTimeout(() => {
          downloadFile(file.url, file.filename);
        }, index * 200);
      });

      // 3. currentDocument 및 선택 상태 설정
      setSelectedKey(`document:${doc.id}`);
      setCurrentDocument(doc);
      setCurrentBook({
        source: "document",
        sourceId: doc.id,
        title: toc?.bookTitle || doc.main_stem || stripExt(doc.name),
        stem: stripExt(doc.name),
        documentId: Number(doc.id),
        toc,
        commentaryStem: commStem,
      });

      pushToast(`'${stem}' 다큐먼트의 모든 PDF(본문, 부록, 해설서, 답안) 다운로드를 시작했습니다.`, "success");
    } catch (e) {
      onError(e);
    } finally {
      setIsDownloading(false);
      setIsModalOpen(false);
      setPendingDoc(null);
    }
  };

  // 모달 닫기
  const handleCloseModal = () => {
    if (isDownloading) return;
    setIsModalOpen(false);
    setPendingDoc(null);
  };

  // 프롬프트 텍스트 변경
  const handlePromptChange = (id: string, text: string) => {
    setPrompts((prev) => ({ ...prev, [id]: text }));
  };

  // 프롬프트 텍스트 복사
  const handleCopyPrompt = async (id: string, buttonLabel: string) => {
    const textToCopy = prompts[id] || "";
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedId(id);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopiedId(null), 2000);
      pushToast(`'${buttonLabel}' 완료! 클립보드에 복사되었습니다.`, "success");
    } catch {
      pushToast("클립보드 복사에 실패했습니다.", "error");
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#0b0f19] text-gray-100 antialiased selection:bg-orange-500/30">
      {/* 글로벌 상단 헤더 */}
      <AppHeader subtitle="교재 및 프롬프트 관리 / Aside" />

      {/* 상단 1번째 줄: BookToc (작성자별) 네비게이션/페이지네이션 영역 */}
      {/* <div className="border-b border-white/5 py-3 px-6 flex items-center justify-between shrink-0 glass shadow-sm gap-6">
        <div className="flex flex-wrap items-center gap-2 max-w-[65%] overflow-x-auto py-1">
          {btError ? (
            <span className="text-xs text-red-400 py-1">목록 로드 오류</span>
          ) : bookTocs === null ? (
            <span className="text-xs text-gray-500 py-1">BookToc 로딩 중...</span>
          ) : bookTocs.length === 0 ? (
            <span className="text-xs text-gray-500 py-1">저장된 BookToc이 없습니다.</span>
          ) : (
            bookTocs.map((b) => (
              <button
                key={b.id}
                onClick={() => handleSelectBookToc(b)}
                className={`px-3 py-1 text-xs rounded-lg border transition-all shrink-0 ${selectedKey === `booktoc:${b.id}` ? tabActive : tabIdle
                  }`}
              >
                {b.bookTitle}
              </button>
            ))
          )}
        </div>
        <div className="flex items-center gap-4 shrink-0 font-medium text-xs">
          <div className="flex items-center gap-1">
            <span className="text-gray-400">작성자:</span>
            <span
              className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-200 font-mono"
              title="로그인한 사용자 아이디"
            >
              {writer || "-"}
            </span>
          </div>
          <span className="text-xs text-gray-400 font-medium">
            {btPage.page + 1} / {btPage.totalPages} (총 {btPage.total})
          </span>
          <div className="flex items-center gap-1">
            <button className={navBtn} title="처음" disabled={btPage.page <= 0} onClick={() => loadBookTocs(0)}>
              <ChevronsLeft className="w-3.5 h-3.5" />
            </button>
            <button
              className={navBtn}
              title="이전"
              disabled={btPage.page <= 0}
              onClick={() => loadBookTocs(btPage.page - 1)}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              className={navBtn}
              title="다음"
              disabled={btPage.page >= btPage.totalPages - 1}
              onClick={() => loadBookTocs(btPage.page + 1)}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              className={navBtn}
              title="끝"
              disabled={btPage.page >= btPage.totalPages - 1}
              onClick={() => loadBookTocs(btPage.totalPages - 1)}
            >
              <ChevronsRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div> */}

      {/* 상단 2번째 줄: TOC 다큐먼트 네비게이션/페이지네이션 영역 */}
      <div className="border-b border-white/5 py-3 px-6 flex items-center justify-between shrink-0 glass shadow-sm gap-6">
        <div className="flex flex-wrap items-center gap-2 max-w-[70%] overflow-x-auto py-1">
          {docError ? (
            <span className="text-xs text-red-400 py-1">목록 로드 오류</span>
          ) : docs === null ? (
            <span className="text-xs text-gray-500 py-1">TOC 도서 로딩 중...</span>
          ) : docs.length === 0 ? (
            <span className="text-xs text-gray-500 py-1">등록된 TOC 도서가 없습니다.</span>
          ) : (
            docs.map((d) => {
              const status =
                d.status === "processing"
                  ? { c: "border-blue-500/40 bg-blue-500/10 text-blue-400", l: "진행중" }
                  : d.status === "queued"
                    ? { c: "border-amber-500/40 bg-amber-500/10 text-amber-400", l: "대기중" }
                    : d.status === "done"
                      ? { c: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400", l: "완료" }
                      : { c: tabIdle, l: "" };
              const active = selectedKey === `document:${d.id}`;
              return (
                <button
                  key={d.id}
                  onClick={() => handleDocClick(d)}
                  title="클릭 시 PDF 다운로드 확인 모달이 열립니다"
                  className={`flex items-center gap-1.5 border rounded-full px-3 py-1 text-xs font-semibold transition-all shadow-sm shrink-0 cursor-pointer ${active ? tabActive : status.c
                    }`}
                >
                  <span>{d.main_stem || String(d.name).replace(".json", "")}</span>
                  {status.l && (
                    <span
                      className={`text-[8px] font-bold px-1 rounded ${d.status === "done" ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"
                        }`}
                    >
                      {status.l}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
        <div className="flex items-center gap-4 shrink-0 font-medium">
          <span className="text-xs text-gray-400 font-medium">
            전체 {docPage.total}개 ({docPage.page}/{docPage.totalPages} 페이지)
          </span>
          <div className="flex items-center gap-1.5">
            <button className={navBtn} disabled={docPage.page <= 1} onClick={() => loadDocs(docPage.page - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              className={navBtn}
              disabled={docPage.page >= docPage.totalPages}
              onClick={() => loadDocs(docPage.page + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 본문 콘텐츠 영역 */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* 현재 설정된 다큐먼트 상태 안내 바 */}
        <div className="p-4 rounded-2xl glass border border-white/10 bg-white/[0.02] flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/30 flex items-center justify-center text-orange-400">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white">현재 활성 Document</h2>
                {currentDocument ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    선택 완료
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/5 text-gray-400 border border-white/10">
                    미선택 (상단 다큐먼트 클릭 시 설정)
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {currentDocument
                  ? `${currentDocument.main_stem || currentDocument.name} (문서 ID: #${currentDocument.id})`
                  : currentBook
                    ? `${currentBook.title} (${currentBook.source} #${currentBook.sourceId})`
                    : "상단 다큐먼트 목록에서 교재를 클릭하여 본문, 부록, 해설서, 답안 PDF를 일괄 다운로드하고 프롬프트를 생성하세요."}
              </p>
            </div>
          </div>

          {currentDocument && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleDocClick(currentDocument)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-orange-500/40 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 text-xs font-semibold transition-all shadow-sm"
              >
                <Download className="w-3.5 h-3.5" />
                <span>PDF 재다운로드</span>
              </button>
            </div>
          )}
        </div>

        {/* 5개 프롬프트 행 영역 */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-orange-400" />
              <h3 className="text-sm font-bold text-gray-200 tracking-tight">AI 생성 프롬프트 관리 (5종)</h3>
            </div>
            <span className="text-xs text-gray-500 font-normal">
              각 줄의 오른쪽 복사 버튼을 클릭하여 프롬프트를 즉시 복사할 수 있습니다.
            </span>
          </div>

          <div className="space-y-4">
            {DEFAULT_PROMPTS.map((prompt) => {
              const Icon = prompt.icon;
              const isCopied = copiedId === prompt.id;

              return (
                <div
                  key={prompt.id}
                  className="glass p-4 rounded-2xl border border-white/10 bg-white/[0.015] hover:border-white/20 transition-all shadow-lg flex flex-col gap-3"
                >
                  {/* 행 상단: 타이틀, 설명 & 우측 복사 버튼 */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400 shrink-0">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-gray-200">{prompt.title}</h4>
                        <p className="text-[11px] text-gray-400">{prompt.description}</p>
                      </div>
                    </div>

                    {/* 요청된 5줄의 각 오른쪽 복사 버튼 */}
                    <button
                      onClick={() => handleCopyPrompt(prompt.id, prompt.buttonLabel)}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm shrink-0 ${isCopied
                        ? "bg-emerald-500 text-white border border-emerald-400 shadow-emerald-500/20 scale-[0.98]"
                        : "bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border border-orange-400/30 shadow-orange-500/20 hover:scale-[1.02] active:scale-[0.98]"
                        }`}
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{isCopied ? "복사 완료!" : prompt.buttonLabel}</span>
                    </button>
                  </div>

                  {/* 프롬프트 텍스트 입력창 (편집 가능) */}
                  <div className="relative">
                    <textarea
                      rows={4}
                      value={prompts[prompt.id]}
                      onChange={(e) => handlePromptChange(prompt.id, e.target.value)}
                      placeholder={`${prompt.title} 내용을 입력하세요...`}
                      className="w-full bg-[#0d121f]/90 border border-white/10 focus:border-orange-500/60 rounded-xl p-3 text-xs text-gray-200 font-mono focus:outline-none focus:ring-1 focus:ring-orange-500/50 transition-all resize-y leading-relaxed"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* '다운로드 하시겠습니까?' 확인 모달 */}
      {isModalOpen && pendingDoc && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-[#121824] border border-orange-500/30 rounded-3xl max-w-md w-full p-6 shadow-2xl shadow-orange-500/10 space-y-5 transform transition-all scale-100">
            <div className="flex items-start justify-between">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-orange-500/20 to-amber-500/20 border border-orange-500/40 flex items-center justify-center text-orange-400 shadow-lg shadow-orange-500/10">
                <Download className="w-6 h-6" />
              </div>
              <button
                onClick={handleCloseModal}
                disabled={isDownloading}
                className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <h3 className="text-base font-bold text-white tracking-tight">다운로드 하시겠습니까?</h3>
              <p className="text-xs text-gray-400 mt-1">
                선택한 다큐먼트의 모든 PDF 파일(본문, 부록, 해설서, 답안)을 일괄 다운로드하고 활성 문서로 설정합니다.
              </p>
            </div>

            {/* 선택된 다큐먼트 정보 요약 */}
            <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">다큐먼트명:</span>
                <span className="font-bold text-gray-200">{pendingDoc.main_stem || pendingDoc.name}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">문서 ID:</span>
                <span className="font-mono text-gray-300">#{pendingDoc.id}</span>
              </div>
              <div className="border-t border-white/5 pt-2 mt-2">
                <span className="text-[11px] text-gray-400 block mb-1.5 font-medium">다운로드 대상 목록:</span>
                <div className="grid grid-cols-2 gap-1.5 text-[11px] text-gray-300">
                  <span className="flex items-center gap-1">
                    <FileText className="w-3 h-3 text-orange-400" /> 본문 PDF
                  </span>
                  <span className="flex items-center gap-1">
                    <FileText className="w-3 h-3 text-orange-400" /> 부록 PDF
                  </span>
                  <span className="flex items-center gap-1">
                    <FileText className="w-3 h-3 text-orange-400" /> 해설서 PDF
                  </span>
                  <span className="flex items-center gap-1">
                    <FileText className="w-3 h-3 text-orange-400" /> 답안 PDF
                  </span>
                </div>
              </div>
            </div>

            {/* 모달 액션 버튼 */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleCloseModal}
                disabled={isDownloading}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-300 border border-white/10 hover:bg-white/10 transition-all disabled:opacity-50"
              >
                아니오
              </button>
              <button
                type="button"
                onClick={handleConfirmDownload}
                disabled={isDownloading}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 border border-orange-400/40 shadow-lg shadow-orange-500/20 transition-all active:scale-95 disabled:opacity-50"
              >
                {isDownloading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>다운로드 중...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>예</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 토스트 알림 */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs font-medium border backdrop-blur-md animate-in slide-in-from-bottom-3 duration-200 ${toast.type === "error"
            ? "bg-red-500/20 border-red-500/40 text-red-300"
            : toast.type === "info"
              ? "bg-blue-500/20 border-blue-500/40 text-blue-300"
              : "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
            }`}
        >
          {toast.type === "error" ? (
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
          ) : toast.type === "info" ? (
            <Sparkles className="w-4 h-4 shrink-0 text-blue-400" />
          ) : (
            <Check className="w-4 h-4 shrink-0 text-emerald-400" />
          )}
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}
