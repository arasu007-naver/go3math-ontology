"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  UploadCloud,
  Layers,
  HelpCircle,
  Hash,
  Database,
  Copy,
  Check,
  Search,
  RotateCw,
  AlertTriangle,
  Lightbulb,
  ListOrdered,
  Filter,
  ChevronDown,
  ChevronUp,
  Bookmark,
  CheckCircle2,
  FileCode
} from "lucide-react";
import AppHeader from "@/components/AppHeader";
import BookBars from "@/components/BookBars";
import { fetchToc } from "@/lib/ocrApi";
import { commentaryList, extractTocUnitsWithPageRanges, stripExt } from "@/lib/toc";
import type {
  BookTocRow,
  DocEntry,
  SelectedBook,
  TocData,
  DictionaryItem,
  FlashcardItem,
  QuizItem,
  BookIndexItem,
  TocUnitRange
} from "@/lib/types";

type Toast = { msg: string; type: "success" | "error" | "info" } | null;
type PromptTaskKey = "toc" | "flashcards" | "quizzes" | "index" | "dictionary";

// ── 0. TOC 목차 JSON 추출 프롬프트 생성 헬퍼 ──
function getTocExtractionPrompt(bookTitle: string) {
  return `이 교재(${bookTitle})의 앞부분에 목차(TOC)가 존재하면, 전체 대단원(Chapter)과 중/소단원(Section), 세부 항목(Item) 및 시작 페이지 번호를 아래 표준 JSON 포맷으로 구성하여, 사용자가 toc.json 파일로 다운로드받을 수 있도록 JSON 코드 블록을 작성해 줘.

[표준 TOC JSON 포맷 규격]
{
  "bookTitle": "${bookTitle}",
  "chapters": [
    {
      "chapterId": "I",
      "chapterTitle": "대단원 명칭 (예: 지수함수와 로그함수)",
      "sections": [
        {
          "sectionId": "01",
          "sectionTitle": "소단원 명칭 (예: 지수)",
          "page": 8,
          "items": [
            { "name": "세부 항목명 (예: 거듭제곱과 거듭제곱근)", "page": 8 },
            { "name": "세부 항목명 (예: 지수의 확장)", "page": 12 }
          ]
        }
      ]
    }
  ],
  "commentaryFile": ""
}

[규칙]
1. 교재 내 목차 페이지를 정밀 분석하여 모든 대단원/소단원을 계층적 구조로 빠짐없이 작성할 것.
2. 각 section 및 item의 page 값은 실제 교재 PDF 내 페이지 번호(정수)로 정확히 지정할 것.
3. 목차가 완성되면 순수 JSON 코드 블록으로 출력하여 사용자가 바로 toc.json 파일로 저장할 수 있게 할 것.`;
}

// ── 단원별 4대 개별 프롬프트 생성 헬퍼 ──
function getFlashcardPrompt(bookTitle: string, unit: TocUnitRange) {
  return `이 교재(${bookTitle})의 【${unit.title}】 (p.${unit.startPage} ~ p.${unit.endPage}) 단원에서 학생이 반드시 암기하고 숙지해야 할 핵심 개념/공식 플래시카드를 JSON 배열 형식으로 추출해 줘.

[단원 지정 규칙]
- 대상 단원: ${unit.title} (페이지 범위: p.${unit.startPage} ~ p.${unit.endPage})
- 반드시 해당 단원 범위 내의 내용만을 바탕으로 추출할 것.
- 모든 항목의 chapter_title에는 "${unit.title}"을 정확히 기재할 것.

[필드 규격]
- chapter_title: "${unit.title}" (단원명)
- front: 핵심 질문, 개념/정의 명칭, 또는 빈칸 채우기
- back: 명쾌한 정답, 공식, 핵심 설명 (수식은 LaTeX $...$ 표기)
- hint: 기억을 돕는 가벼운 힌트 (1줄)
- formula: 대표 수식 (없으면 빈 문자열)
- pages: 출처 페이지 번호 배열 (p.${unit.startPage}~p.${unit.endPage} 내 정수)

[출력 JSON 예시]
[
  {
    "chapter_title": "${unit.title}",
    "front": "지수법칙에서 $a^0$의 값은? (단, $a \\neq 0$)",
    "back": "1",
    "hint": "모든 0이 아닌 수의 0제곱",
    "formula": "$a^0 = 1$",
    "pages": [${unit.startPage}]
  }
]`;
}

function getQuizPrompt(bookTitle: string, unit: TocUnitRange) {
  return `이 교재(${bookTitle})의 【${unit.title}】 (p.${unit.startPage} ~ p.${unit.endPage}) 단원에서 개념 이해도를 정밀 평가하는 4지선다형 퀴즈 3~5문제와 3단계 소크라테스식 힌트를 JSON 배열로 생성해 줘.

[단원 지정 규칙]
- 대상 단원: ${unit.title} (페이지 범위: p.${unit.startPage} ~ p.${unit.endPage})
- 반드시 해당 단원 범위 내의 핵심 개념과 오개념을 바탕으로 문제를 구성할 것.
- 모든 항목의 chapter_title에는 "${unit.title}"을 정확히 기재할 것.

[필드 규격]
- chapter_title: "${unit.title}" (단원명)
- question: 문제 내용 (수식은 LaTeX $...$ 표기)
- options: 4개의 선택지 배열 [{ "id": 1, "text": "선택지 내용" }, ...]
- correct_option_id: 정답 번호 (1~4)
- explanation: 상세한 풀이 및 정답 근거
- socratic_hints: 오답 시 학생의 생각을 순차 유도할 3단계 소크라테스식 질문/힌트 배열
  - Level 1 (개념 상기): 문제 해결에 필요한 기본 정의/정리 상기 유도
  - Level 2 (오개념 반문): 자주 범하는 실수나 잘못된 가정을 짚는 질문
  - Level 3 (단계별 유도): 정답 도출의 핵심 단계를 밟아가도록 돕는 하위 질문
- pages: 출처 페이지 번호 배열 (p.${unit.startPage}~p.${unit.endPage} 내 정수)

[출력 JSON 예시]
[
  {
    "chapter_title": "${unit.title}",
    "question": "다음 중 지수함수 $y=2^x$의 성질로 옳은 것은?",
    "options": [
      { "id": 1, "text": "점근선은 $y$축이다." },
      { "id": 2, "text": "정의역은 실수 전체의 집합이다." },
      { "id": 3, "text": "치역은 실수 전체의 집합이다." },
      { "id": 4, "text": "$x$가 증가할 때 $y$는 감소한다." }
    ],
    "correct_option_id": 2,
    "explanation": "지수함수 $y=2^x$는 정의역이 실수 전체이고 치역은 양의 실수 전체이며, 점근선은 $x$축($y=0$)입니다.",
    "socratic_hints": [
      "지수함수 $y=a^x$ ($a>1$)의 그래프 개형과 축과의 관계를 떠올려 보세요.",
      "$x$ 자리에 음수나 0, 양수를 대입할 때 제한 조건이 있는지 확인해 보세요.",
      "$2^x$의 값이 음수가 될 수 있는지 치역과 정의역을 구분해 보세요."
    ],
    "pages": [${unit.startPage}]
  }
]`;
}

function getIndexPrompt(bookTitle: string, unit: TocUnitRange) {
  return `이 교재(${bookTitle})의 【${unit.title}】 (p.${unit.startPage} ~ p.${unit.endPage}) 단원에 등장하는 모든 수학 용어, 개념, 정리(Theorem)의 색인(Index)을 JSON 배열로 추출해 줘.

[단원 지정 규칙]
- 대상 단원: ${unit.title} (페이지 범위: p.${unit.startPage} ~ p.${unit.endPage})
- 해당 단원 페이지에 등장하는 모든 중요 개념어 및 용어를 누락 없이 색인화할 것.
- 모든 항목의 chapter_title에는 "${unit.title}"을 정확히 기재할 것.

[필드 규격]
- chapter_title: "${unit.title}" (단원명)
- term: 용어/개념명
- category: 정의 / 정리 / 공식 / 성질 / 방법 중 하나
- definition: 1~2문장의 간결하고 명확한 핵심 정의
- formula: 대표 수식 (없으면 빈 문자열)
- pages: 실제 등장한 페이지 번호 배열 (p.${unit.startPage}~p.${unit.endPage} 내 정수)

[출력 JSON 예시]
[
  {
    "chapter_title": "${unit.title}",
    "term": "지수함수",
    "category": "정의",
    "definition": "실수 $x$에 대하여 $y=a^x$ ($a>0, a \\neq 1$) 꼴로 나타내어지는 함수",
    "formula": "$y = a^x$",
    "pages": [${unit.startPage}]
  }
]`;
}

function getDictionaryPrompt(bookTitle: string, unit: TocUnitRange) {
  return `이 교재(${bookTitle})의 【${unit.title}】 (p.${unit.startPage} ~ p.${unit.endPage}) 단원에 등장하는 핵심 수학 개념들에 대해 깊이 있는 딕셔너리 백과 온톨로지 항목들을 JSON 배열로 작성해 줘.

[단원 지정 규칙]
- 대상 단원: ${unit.title} (페이지 범위: p.${unit.startPage} ~ p.${unit.endPage})
- 해당 단원 내 핵심 개념들을 중심으로 정의부터 기하학적 의미, 오개념, 예제까지 포괄적으로 작성할 것.
- 모든 항목의 chapter_title에는 "${unit.title}"을 정확히 기재할 것.

[필드 규격]
- chapter_title: "${unit.title}" (단원명)
- term: 한글 용어명
- english_term: 영문 용어명
- definition: 엄밀한 수학적 정의 및 기본 공식 ($...$ LaTeX)
- geometric_meaning: 기하학적 / 시각적 / 직관적 의미 설명
- theorems: 관련 핵심 정리 배열 [{ "name": "정리 이름", "description": "설명" }]
- misconceptions: 학생들이 자주 빠지는 오개념 및 주의할 점 배열 (문자열 배열)
- examples: 대표 예제와 풀이 배열 [{ "problem": "문제 내용", "solution": "풀이 내용" }]
- prerequisites: 선수 학습 개념 배열 (문자열 배열)
- subsequent_concepts: 후속 학습 개념 배열 (문자열 배열)
- pages: 관련 페이지 번호 배열 (p.${unit.startPage}~p.${unit.endPage} 내 정수)

[출력 JSON 예시]
[
  {
    "chapter_title": "${unit.title}",
    "term": "지수함수",
    "english_term": "exponential function",
    "definition": "임의의 실수 $x$에 대하여 $a^x$ ($a>0, a \\neq 1$)를 대응시키는 함수 $y=a^x$",
    "geometric_meaning": "$a>1$일 때 $x$가 증가함에 따라 급격히 증가하며, $x$축($y=0$)을 점근선으로 가집니다.",
    "theorems": [
      { "name": "지수함수의 일대일대응", "description": "$a>0, a \\neq 1$일 때 $x_1 \\neq x_2 \\implies a^{x_1} \\neq a^{x_2}$" }
    ],
    "misconceptions": [
      "밑 $a$가 1이 될 수 있다고 생각하는 오류 (밑은 $a>0, a \\neq 1$이어야 함)",
      "$a^x \\le 0$이 되는 실수가 존재한다고 오해하는 오류"
    ],
    "examples": [
      { "problem": "함수 $f(x)=3^x$에 대하여 $f(2)$의 값을 구하시오.", "solution": "$f(2)=3^2=9$" }
    ],
    "prerequisites": ["거듭제곱근", "지수의 확장"],
    "subsequent_concepts": ["지수방정식", "로그함수"],
    "pages": [${unit.startPage}]
  }
]`;
}

export default function DictionaryPage() {
  // ── 도서 선택 상태 ──
  const [book, setBook] = useState<SelectedBook | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  // ── TOC 기반 단원 목록 및 선택 ──
  const [selectedUnitId, setSelectedUnitId] = useState<string>("all");
  const [showTocPanel, setShowTocPanel] = useState<boolean>(true);

  // ── 활성 탭 및 필터 ──
  const [activeTab, setActiveTab] = useState<"dictionary" | "flashcards" | "quizzes" | "index">("dictionary");
  const [selectedChapterFilter, setSelectedChapterFilter] = useState<string>("all");

  // ── 데이터 상태 ──
  const [dictionaryList, setDictionaryList] = useState<DictionaryItem[]>([]);
  const [flashcardList, setFlashcardList] = useState<FlashcardItem[]>([]);
  const [quizList, setQuizList] = useState<QuizItem[]>([]);
  const [indexList, setIndexList] = useState<BookIndexItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // ── 플래시카드 플립 상태 ──
  const [flippedCards, setFlippedCards] = useState<Record<number, boolean>>({});
  const [showHints, setShowHints] = useState<Record<number, boolean>>({});

  // ── 퀴즈 인터랙션 상태 ──
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [quizHintLevels, setQuizHintLevels] = useState<Record<number, number>>({});

  // ── NotebookLM 개별 프롬프트 모달 상태 ──
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [promptTargetUnitId, setPromptTargetUnitId] = useState<string>("");
  const [copiedPromptKey, setCopiedPromptKey] = useState<PromptTaskKey | null>(null);

  // ── NotebookLM 결과 직접 붙여넣기 모달 ──
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteDataType, setPasteDataType] = useState<"dictionary" | "flashcards" | "quizzes" | "index">("dictionary");
  const [pasteTargetUnitTitle, setPasteTargetUnitTitle] = useState<string>("");
  const [pastedJsonText, setPastedJsonText] = useState("");

  // ── 토스트 ──
  const [toast, setToast] = useState<Toast>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const pushToast = useCallback((msg: string, type: "success" | "error" | "info" = "success") => {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const onError = useCallback((e: unknown) => {
    pushToast(`오류 발생: ${(e as Error).message}`, "error");
  }, [pushToast]);

  // ── 도서 선택 콜백 ──
  const selectBook = useCallback((b: SelectedBook) => {
    setBook(b);
    setSelectedFileName(null);
    setSelectedUnitId("all");
    setSelectedChapterFilter("all");
    pushToast(`도서 '${b.title}'이(가) 선택되었습니다.`, "info");
  }, [pushToast]);

  const onSelectBookToc = useCallback((row: BookTocRow) => {
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
  }, [pushToast, selectBook]);

  const onSelectDoc = useCallback(async (entry: DocEntry) => {
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
  }, [onError, selectBook]);

  // ── TOC 기반 단원 목록 산출 ──
  const tocUnits = useMemo<TocUnitRange[]>(() => {
    return extractTocUnitsWithPageRanges(book?.toc || null);
  }, [book?.toc]);

  // ── DB 데이터 로드 ──
  const loadData = useCallback(async (stem?: string) => {
    setIsLoading(true);
    try {
      const url = stem ? `/api/dictionary?bookStem=${encodeURIComponent(stem)}` : `/api/dictionary`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setDictionaryList(data.dictionary || []);
        setFlashcardList(data.flashcards || []);
        setQuizList(data.quizzes || []);
        setIndexList(data.bookIndex || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData(book?.stem);
  }, [book?.stem, loadData]);

  // ── 단원별 구축 통계 집계 ──
  const unitStatsMap = useMemo(() => {
    const map = new Map<string, { dict: number; flash: number; quiz: number; index: number; total: number }>();
    
    tocUnits.forEach(u => {
      const isMatch = (itemCh?: string, itemPages?: number[]) => {
        if (itemCh && itemCh === u.title) return true;
        if (itemPages && itemPages.some(p => p >= u.startPage && p <= u.endPage)) return true;
        return false;
      };

      const dCount = dictionaryList.filter(it => isMatch(it.chapter_title, it.pages)).length;
      const fCount = flashcardList.filter(it => isMatch(it.chapter_title, it.pages)).length;
      const qCount = quizList.filter(it => isMatch(it.chapter_title, it.pages)).length;
      const iCount = indexList.filter(it => isMatch(it.chapter_title, it.pages)).length;

      map.set(u.id, {
        dict: dCount,
        flash: fCount,
        quiz: qCount,
        index: iCount,
        total: dCount + fCount + qCount + iCount
      });
    });

    return map;
  }, [tocUnits, dictionaryList, flashcardList, quizList, indexList]);

  // ── PDF 파일 직접 선택 및 업로드 ──
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("pdfFile", file);

    pushToast(`'${file.name}' 업로드 및 분석 준비 중...`, "info");
    try {
      const res = await fetch("/api/dictionary/upload-pdf", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSelectedFileName(file.name);
      setBook({
        source: "document",
        sourceId: "uploaded",
        title: data.bookTitle,
        stem: data.stem,
        documentId: null,
        toc: null,
        commentaryStem: ""
      });
      pushToast(`PDF '${file.name}'이(가) 소스로 로드되었습니다!`, "success");
    } catch (err: unknown) {
      const error = err as Error;
      pushToast(`업로드 실패: ${error.message}`, "error");
    }
  };

  // ── NotebookLM 프롬프트 모달 열기 ──
  const openPromptModalForUnit = (unitId?: string) => {
    const targetId = unitId || (selectedUnitId !== "all" ? selectedUnitId : tocUnits[0]?.id || "all");
    setPromptTargetUnitId(targetId);
    setCopiedPromptKey(null);
    setShowPromptModal(true);
  };

  // 프롬프트 단건 복사 함수
  const copySinglePrompt = (text: string, key: PromptTaskKey, taskTitle: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPromptKey(key);
    pushToast(`'${taskTitle}' 프롬프트가 복사되었습니다! NotebookLM에 붙여넣으세요.`, "success");
  };

  // ── NotebookLM 결과 직접 파싱 및 DB 적재 ──
  const handlePastedDataImport = async () => {
    if (!pastedJsonText.trim()) {
      pushToast("붙여넣을 JSON 데이터를 입력해 주세요.", "error");
      return;
    }

    try {
      let parsed = JSON.parse(pastedJsonText);
      if (!Array.isArray(parsed)) {
        if (parsed.items && Array.isArray(parsed.items)) parsed = parsed.items;
        else throw new Error("JSON이 배열 형태여야 합니다.");
      }

      const payload: {
        dictionary?: DictionaryItem[];
        flashcards?: FlashcardItem[];
        quizzes?: QuizItem[];
        bookIndex?: BookIndexItem[];
      } = {};
      const currentStem = book?.stem || "imported_book";
      const currentTitle = book?.title || "교재";
      const chapterTitle = pasteTargetUnitTitle.trim() || undefined;

      if (pasteDataType === "dictionary") {
        payload.dictionary = parsed.map((it: Record<string, unknown>) => ({
          book_stem: currentStem,
          book_title: currentTitle,
          chapter_title: chapterTitle || String(it.chapter_title || it.chapterTitle || ""),
          term: String(it.term || ""),
          english_term: String(it.english_term || it.englishTerm || ""),
          definition: String(it.definition || ""),
          formula: String(it.formula || ""),
          geometric_meaning: String(it.geometric_meaning || it.geometricMeaning || ""),
          theorems: (it.theorems as Array<{ name: string; description: string }>) || [],
          misconceptions: (it.misconceptions as string[]) || [],
          examples: (it.examples as Array<{ problem: string; solution: string }>) || [],
          prerequisites: (it.prerequisites as string[]) || [],
          subsequent_concepts: (it.subsequent_concepts as string[]) || [],
          pages: (it.pages as number[]) || []
        }));
      } else if (pasteDataType === "flashcards") {
        payload.flashcards = parsed.map((it: Record<string, unknown>) => ({
          book_stem: currentStem,
          book_title: currentTitle,
          chapter_title: chapterTitle || String(it.chapter_title || it.chapterTitle || ""),
          front: String(it.front || ""),
          back: String(it.back || ""),
          hint: String(it.hint || ""),
          formula: String(it.formula || ""),
          pages: (it.pages as number[]) || []
        }));
      } else if (pasteDataType === "quizzes") {
        payload.quizzes = parsed.map((it: Record<string, unknown>) => ({
          book_stem: currentStem,
          book_title: currentTitle,
          chapter_title: chapterTitle || String(it.chapter_title || it.chapterTitle || ""),
          question: String(it.question || ""),
          options: (it.options as Array<{ id: number; text: string }>) || [],
          correct_option_id: Number(it.correct_option_id || it.correctOptionId || 1),
          explanation: String(it.explanation || ""),
          socratic_hints: (it.socratic_hints as string[]) || (it.socraticHints as string[]) || [],
          pages: (it.pages as number[]) || []
        }));
      } else if (pasteDataType === "index") {
        payload.bookIndex = parsed.map((it: Record<string, unknown>) => ({
          book_stem: currentStem,
          book_title: currentTitle,
          chapter_title: chapterTitle || String(it.chapter_title || it.chapterTitle || ""),
          term: String(it.term || ""),
          category: String(it.category || "개념"),
          definition: String(it.definition || ""),
          formula: String(it.formula || ""),
          pages: (it.pages as number[]) || []
        }));
      }

      const res = await fetch("/api/dictionary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);

      pushToast(`DB에 ${parsed.length}개 항목이 성공적으로 적재되었습니다!`, "success");
      setShowPasteModal(false);
      setPastedJsonText("");
      loadData(currentStem);
    } catch (err: unknown) {
      const error = err as Error;
      pushToast(`JSON 파싱/적재 오류: ${error.message}`, "error");
    }
  };

  // ── 챕터 필터링 데이터 ──
  const chapterOptions = useMemo(() => {
    const set = new Set<string>();
    tocUnits.forEach(u => set.add(u.title));
    dictionaryList.forEach(it => { if (it.chapter_title) set.add(it.chapter_title); });
    flashcardList.forEach(it => { if (it.chapter_title) set.add(it.chapter_title); });
    quizList.forEach(it => { if (it.chapter_title) set.add(it.chapter_title); });
    indexList.forEach(it => { if (it.chapter_title) set.add(it.chapter_title); });
    return Array.from(set);
  }, [tocUnits, dictionaryList, flashcardList, quizList, indexList]);

  // 필터 적용 헬퍼
  const matchesChapter = useCallback((chapterTitle?: string, pages?: number[]) => {
    if (selectedChapterFilter === "all") return true;
    if (chapterTitle === selectedChapterFilter) return true;
    const targetUnit = tocUnits.find(u => u.title === selectedChapterFilter);
    if (targetUnit && pages && pages.some(p => p >= targetUnit.startPage && p <= targetUnit.endPage)) {
      return true;
    }
    return false;
  }, [selectedChapterFilter, tocUnits]);

  const filteredDict = dictionaryList.filter(it => {
    const matchSearch =
      it.term.toLowerCase().includes(searchQuery.toLowerCase()) ||
      it.definition.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (it.english_term && it.english_term.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchSearch && matchesChapter(it.chapter_title, it.pages);
  });

  const filteredFlashcards = flashcardList.filter(it => matchesChapter(it.chapter_title, it.pages));
  const filteredQuizzes = quizList.filter(it => matchesChapter(it.chapter_title, it.pages));
  const filteredIndex = indexList.filter(it => {
    const matchSearch =
      it.term.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (it.definition && it.definition.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchSearch && matchesChapter(it.chapter_title, it.pages);
  });

  // 현재 프롬프트 모달 대상 단원 객체
  const activePromptUnit = useMemo<TocUnitRange>(() => {
    const found = tocUnits.find(u => u.id === promptTargetUnitId);
    if (found) return found;
    return tocUnits[0] || {
      id: "all",
      title: "전체 도서",
      startPage: 1,
      endPage: 300,
      level: "chapter",
      order: 0
    };
  }, [tocUnits, promptTargetUnitId]);

  const currentBookTitle = book?.title || "고등수학";

  return (
    <>
      <AppHeader subtitle="TOC 기반 단원별 수학 딕셔너리 · 플래시카드 · 퀴즈 · 색인 구축 센터" />

      {/* 1. 상단 Document 목록 네비게이션 영역 (인덱스 페이지와 동일) */}
      <BookBars
        selectedKey={book ? `${book.source}:${book.sourceId}` : null}
        onSelectBookToc={onSelectBookToc}
        onSelectDoc={onSelectDoc}
        onError={onError}
      />

      {/* 2. 한 줄 액션 버튼 그룹 영역 */}
      <div className="border-b border-white/5 py-2.5 px-6 flex items-center justify-between shrink-0 glass shadow-sm gap-4 flex-wrap">
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* PDF 파일 선택 버튼 */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handlePdfUpload}
            accept=".pdf"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 text-xs font-bold rounded-xl bg-orange-600 hover:bg-orange-700 text-white transition-all shadow-md shadow-orange-600/20 flex items-center gap-1.5 cursor-pointer"
            title="로컬 PDF 파일 선택 및 소스 업로드"
          >
            <UploadCloud className="w-4 h-4" />
            <span>PDF 파일 선택</span>
          </button>

          {/* 현재 선택된 도서 뱃지 */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs font-mono text-gray-300">
            <BookOpen className="w-3.5 h-3.5 text-orange-400" />
            <span className="text-gray-400 font-sans font-semibold text-[10px]">도서:</span>
            <span className="text-orange-300 font-bold truncate max-w-[200px]">
              {selectedFileName || book?.title || "선택된 도서 없음"}
            </span>
          </div>

          {/* TOC 단원 선택 드롭다운 */}
          <div className="flex items-center gap-1.5 bg-black/40 px-2.5 py-1 rounded-xl border border-white/10">
            <ListOrdered className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[10px] text-gray-400 font-semibold">TOC 대상:</span>
            <select
              value={selectedUnitId}
              onChange={e => {
                setSelectedUnitId(e.target.value);
                const u = tocUnits.find(unit => unit.id === e.target.value);
                setSelectedChapterFilter(u ? u.title : "all");
              }}
              className="bg-transparent text-xs font-semibold text-emerald-300 outline-none cursor-pointer max-w-[190px] truncate"
            >
              <option value="all" className="bg-[#121824] text-white">전체 단원 ({tocUnits.length}개)</option>
              {tocUnits.map((u) => (
                <option key={u.id} value={u.id} className="bg-[#121824] text-gray-200">
                  {u.title} (p.{u.startPage}~{u.endPage})
                </option>
              ))}
            </select>
          </div>

          <div className="h-4 w-[1px] bg-white/10 mx-1"></div>

          {/* NotebookLM 프롬프트 팩 (개별 프롬프트 복사 센터) */}
          <button
            onClick={() => openPromptModalForUnit()}
            className="px-3.5 py-1.5 text-xs font-bold rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all shadow-md shadow-indigo-600/20 flex items-center gap-1.5 cursor-pointer"
            title="NotebookLM용 TOC 및 단원별 4대 프롬프트 개별 복사 (비용 0원 워크플로우)"
          >
            <Copy className="w-4 h-4 text-amber-300" />
            <span>NotebookLM 프롬프트 팩</span>
          </button>

          {/* 결과 붙여넣기 */}
          <button
            onClick={() => {
              const u = tocUnits.find(unit => unit.id === selectedUnitId);
              setPasteTargetUnitTitle(u ? u.title : "");
              setShowPasteModal(true);
            }}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 transition-all flex items-center gap-1.5 cursor-pointer"
            title="NotebookLM 생성 결과를 직접 붙여넣어 DB 적재"
          >
            <Database className="w-3.5 h-3.5 text-blue-400" />
            <span>결과 붙여넣기</span>
          </button>
        </div>

        {/* 오른쪽: TOC 패널 토글 & 데이터 요약 */}
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <div className="flex items-center gap-2 bg-black/30 px-2.5 py-1 rounded-lg border border-white/5 font-mono text-[11px]">
            <span>사전: <strong className="text-orange-400">{dictionaryList.length}</strong></span>
            <span>·</span>
            <span>카드: <strong className="text-purple-400">{flashcardList.length}</strong></span>
            <span>·</span>
            <span>퀴즈: <strong className="text-emerald-400">{quizList.length}</strong></span>
            <span>·</span>
            <span>색인: <strong className="text-blue-400">{indexList.length}</strong></span>
          </div>

          <button
            onClick={() => setShowTocPanel(prev => !prev)}
            className="px-2.5 py-1 rounded-lg border border-white/10 hover:bg-white/10 text-emerald-300 font-semibold text-xs transition-all flex items-center gap-1 cursor-pointer"
            title="TOC 단원별 패널 열기/닫기"
          >
            <ListOrdered className="w-3.5 h-3.5 text-emerald-400" />
            <span>TOC 단원 목록</span>
            {showTocPanel ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          <button
            onClick={() => loadData(book?.stem)}
            className="p-1.5 rounded-lg border border-white/10 hover:bg-white/10 text-gray-300 transition-all cursor-pointer"
            title="새로고침"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── 3. TOC 단원별 목록 & 개별 프롬프트 생성 패널 ── */}
      {showTocPanel && (
        <div className="border-b border-white/5 bg-[#0a0f18]/90 px-6 py-3 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <ListOrdered className="w-4 h-4 text-emerald-400" />
              <h2 className="text-xs font-bold text-gray-200">
                TOC 단원 목록 및 NotebookLM 개별 프롬프트
                <span className="ml-2 text-[10px] text-gray-400 font-normal">
                  (총 {tocUnits.length}개 단원 · 단원 카드의 [📋 프롬프트] 버튼을 누르면 해당 단원의 프롬프트를 1개씩 복사할 수 있습니다)
                </span>
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setSelectedUnitId("all");
                  setSelectedChapterFilter("all");
                }}
                className={`text-[10px] px-2.5 py-0.5 rounded-lg border transition-all cursor-pointer ${
                  selectedChapterFilter === "all"
                    ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300 font-bold"
                    : "border-white/10 text-gray-400 hover:text-white"
                }`}
              >
                전체 단원 보기
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 max-h-56 overflow-y-auto pr-1">
            {tocUnits.map((unit) => {
              const stats = unitStatsMap.get(unit.id) || { dict: 0, flash: 0, quiz: 0, index: 0, total: 0 };
              const isSelectedForFilter = selectedChapterFilter === unit.title;
              const hasData = stats.total > 0;

              return (
                <div
                  key={unit.id}
                  className={`rounded-xl border p-2.5 flex flex-col justify-between gap-2 transition-all ${
                    isSelectedForFilter
                      ? "bg-emerald-950/40 border-emerald-500/50 shadow-md shadow-emerald-500/10"
                      : "bg-black/30 border-white/10 hover:border-white/20"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono ${
                          unit.level === "chapter" ? "bg-amber-500/20 text-amber-300" : "bg-teal-500/20 text-teal-300"
                        }`}>
                          {unit.level === "chapter" ? "대단원" : "소단원"}
                        </span>
                        <h3
                          onClick={() => {
                            setSelectedUnitId(unit.id);
                            setSelectedChapterFilter(unit.title);
                          }}
                          className="text-xs font-bold text-gray-200 hover:text-emerald-300 truncate cursor-pointer"
                          title={unit.title}
                        >
                          {unit.title}
                        </h3>
                      </div>
                      <span className="text-[10px] font-mono text-gray-400 block mt-0.5">
                        페이지: <strong className="text-emerald-400">p.{unit.startPage} ~ p.{unit.endPage}</strong>
                      </span>
                    </div>

                    {hasData ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold flex items-center gap-1 shrink-0">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        {stats.total}개
                      </span>
                    ) : (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500 font-mono shrink-0">
                        미구축
                      </span>
                    )}
                  </div>

                  {/* 단원별 적재 수치 배지 */}
                  <div className="flex items-center gap-1.5 text-[9px] font-mono bg-white/5 px-2 py-1 rounded-lg border border-white/5">
                    <span className="text-orange-300">사전: <strong>{stats.dict}</strong></span>
                    <span className="text-gray-600">|</span>
                    <span className="text-purple-300">카드: <strong>{stats.flash}</strong></span>
                    <span className="text-gray-600">|</span>
                    <span className="text-teal-300">퀴즈: <strong>{stats.quiz}</strong></span>
                    <span className="text-gray-600">|</span>
                    <span className="text-blue-300">색인: <strong>{stats.index}</strong></span>
                  </div>

                  {/* 단원별 개별 액션 바 */}
                  <div className="flex items-center justify-between gap-1 pt-1 border-t border-white/5 text-[10px]">
                    <button
                      onClick={() => {
                        setSelectedUnitId(unit.id);
                        setSelectedChapterFilter(unit.title);
                      }}
                      className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-gray-300 font-medium transition-all cursor-pointer"
                      title="이 단원의 데이터만 필터링하여 보기"
                    >
                      데이터 필터
                    </button>

                    <button
                      onClick={() => openPromptModalForUnit(unit.id)}
                      className="px-2.5 py-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 font-bold transition-all flex items-center gap-1 cursor-pointer"
                      title="이 단원의 프롬프트 개별 복사 창 열기"
                    >
                      <Copy className="w-3 h-3 text-amber-300" />
                      <span>프롬프트 복사</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 4. 메인 작업 영역: 탭 + 콘텐츠 뷰 ── */}
      <main className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
        {/* 상단 탭 및 필터/검색 바 */}
        <div className="flex items-center justify-between gap-4 shrink-0 flex-wrap">
          <div className="flex items-center gap-2 bg-black/40 p-1 rounded-xl border border-white/10">
            <button
              onClick={() => setActiveTab("dictionary")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === "dictionary"
                  ? "bg-orange-600 text-white shadow-md shadow-orange-600/20"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>수학 딕셔너리 ({filteredDict.length})</span>
            </button>
            <button
              onClick={() => setActiveTab("flashcards")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === "flashcards"
                  ? "bg-purple-600 text-white shadow-md shadow-purple-600/20"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>플래시카드 ({filteredFlashcards.length})</span>
            </button>
            <button
              onClick={() => setActiveTab("quizzes")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === "quizzes"
                  ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>퀴즈 은행 ({filteredQuizzes.length})</span>
            </button>
            <button
              onClick={() => setActiveTab("index")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === "index"
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/20"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <Hash className="w-3.5 h-3.5" />
              <span>개념 색인 ({filteredIndex.length})</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* 단원(Chapter) 필터 */}
            {chapterOptions.length > 0 && (
              <div className="flex items-center gap-1.5 bg-[#121824] border border-white/10 px-2.5 py-1 rounded-xl text-xs">
                <Filter className="w-3.5 h-3.5 text-gray-400" />
                <select
                  value={selectedChapterFilter}
                  onChange={e => setSelectedChapterFilter(e.target.value)}
                  className="bg-transparent text-gray-300 text-xs outline-none cursor-pointer max-w-[160px] truncate"
                >
                  <option value="all" className="bg-[#121824] text-white">모든 단원 보기</option>
                  {chapterOptions.map((ch, idx) => (
                    <option key={idx} value={ch} className="bg-[#121824] text-gray-200">
                      {ch}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* 검색창 */}
            <div className="relative w-64">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="용어, 개념, 정의 검색..."
                className="w-full bg-[#121824] border border-white/10 rounded-xl pl-9 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-orange-500 transition-colors"
              />
            </div>
          </div>
        </div>

        {/* 탭 콘텐츠 영역 */}
        <div className="flex-1 min-h-0 glass rounded-2xl p-4 overflow-y-auto border border-white/5">
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-gray-500">
              <RotateCw className="w-6 h-6 animate-spin text-orange-400" />
              <span className="text-xs">데이터를 로드하고 있습니다...</span>
            </div>
          ) : activeTab === "dictionary" ? (
            /* ── [1] 딕셔너리 뷰 ── */
            filteredDict.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-500 text-xs">
                <BookOpen className="w-10 h-10 text-gray-600" />
                <p>구축된 수학 딕셔너리 항목이 없습니다.</p>
                <button
                  onClick={() => openPromptModalForUnit()}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition-all cursor-pointer shadow-lg shadow-indigo-600/20 flex items-center gap-1.5"
                >
                  <Copy className="w-4 h-4 text-amber-300" />
                  <span>NotebookLM 프롬프트 열기</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredDict.map((item, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-white/10 bg-black/40 p-4 flex flex-col gap-3 shadow-lg hover:border-orange-500/40 transition-all"
                  >
                    <div className="flex items-start justify-between gap-2 border-b border-white/5 pb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-extrabold text-orange-300">{item.term}</h3>
                          {item.english_term && (
                            <span className="text-[10px] text-gray-500 font-mono italic">({item.english_term})</span>
                          )}
                        </div>
                        {item.chapter_title && (
                          <span className="text-[10px] text-gray-400 block mt-0.5">{item.chapter_title}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {item.pages?.map(p => (
                          <span key={p} className="px-1.5 py-0.5 rounded bg-orange-500/10 border border-orange-500/20 text-orange-400 font-mono text-[9px]">
                            p.{p}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* 정의 */}
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">정의 및 공식</span>
                      <p className="text-xs text-gray-200 font-medium leading-relaxed bg-white/5 p-2 rounded-lg border border-white/5 font-mono">
                        {item.definition}
                      </p>
                    </div>

                    {/* 기하학적 의미 */}
                    {item.geometric_meaning && (
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">기하학적/직관적 의미</span>
                        <p className="text-xs text-gray-300 bg-blue-500/5 border border-blue-500/10 p-2 rounded-lg">
                          {item.geometric_meaning}
                        </p>
                      </div>
                    )}

                    {/* 정리(Theorems) */}
                    {item.theorems && item.theorems.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-purple-400 flex items-center gap-1">
                          <Bookmark className="w-3 h-3" /> 관련 핵심 정리
                        </span>
                        <div className="space-y-1">
                          {item.theorems.map((th, thIdx) => (
                            <div key={thIdx} className="text-xs bg-purple-500/5 border border-purple-500/10 p-2 rounded-lg">
                              <strong className="text-purple-300 font-semibold">{th.name}: </strong>
                              <span className="text-gray-300">{th.description}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 오개념 & 주의점 */}
                    {item.misconceptions && item.misconceptions.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-amber-400 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> 오개념 및 주의사항
                        </span>
                        <ul className="text-xs text-amber-200/90 list-disc list-inside bg-amber-500/5 border border-amber-500/10 p-2 rounded-lg space-y-0.5">
                          {item.misconceptions.map((m, mIdx) => (
                            <li key={mIdx}>{m}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* 선수 / 후속 개념 */}
                    <div className="flex items-center justify-between text-[10px] text-gray-400 pt-2 border-t border-white/5">
                      <div>
                        <span className="text-gray-500">선수: </span>
                        <span className="text-gray-300 font-semibold">{item.prerequisites?.join(", ") || "-"}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">후속: </span>
                        <span className="text-gray-300 font-semibold">{item.subsequent_concepts?.join(", ") || "-"}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : activeTab === "flashcards" ? (
            /* ── [2] 플래시카드 뷰 ── */
            filteredFlashcards.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-gray-500 text-xs">
                <Layers className="w-10 h-10 text-gray-600" />
                <p>추출된 플래시카드가 없습니다.</p>
                <button
                  onClick={() => openPromptModalForUnit()}
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Copy className="w-4 h-4 text-amber-300" />
                  <span>플래시카드 프롬프트 복사</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredFlashcards.map((card, idx) => {
                  const isFlipped = !!flippedCards[idx];
                  const isHintOpen = !!showHints[idx];

                  return (
                    <div
                      key={idx}
                      onClick={() => setFlippedCards(prev => ({ ...prev, [idx]: !prev[idx] }))}
                      className={`min-h-[220px] rounded-2xl border p-5 flex flex-col justify-between cursor-pointer transition-all duration-300 select-none shadow-xl ${
                        isFlipped
                          ? "bg-purple-950/40 border-purple-500/50 shadow-purple-500/10"
                          : "bg-black/40 border-white/10 hover:border-purple-500/30"
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] text-gray-400 border-b border-white/5 pb-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-purple-400">Card #{idx + 1}</span>
                          {card.chapter_title && (
                            <span className="text-[9px] text-gray-400 truncate max-w-[120px]">
                              ({card.chapter_title})
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {card.pages?.map(p => (
                            <span key={p} className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 font-mono text-[9px]">
                              p.{p}
                            </span>
                          ))}
                          <span className="text-[9px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                            {isFlipped ? "뒷면 (정답)" : "앞면 (질문)"}
                          </span>
                        </div>
                      </div>

                      <div className="py-4 flex-1 flex items-center justify-center text-center">
                        {isFlipped ? (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-purple-100 leading-relaxed whitespace-pre-wrap">
                              {card.back}
                            </p>
                            {card.formula && (
                              <div className="text-[11px] font-mono text-purple-300 bg-purple-500/10 px-2.5 py-1 rounded-lg">
                                {card.formula}
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm font-bold text-gray-100 leading-snug">
                            {card.front}
                          </p>
                        )}
                      </div>

                      {/* 힌트 & 플립 안내 */}
                      <div className="flex items-center justify-between text-[10px] pt-2 border-t border-white/5">
                        {card.hint ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowHints(prev => ({ ...prev, [idx]: !prev[idx] }));
                            }}
                            className="text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer font-semibold"
                          >
                            <Lightbulb className="w-3 h-3" />
                            <span>{isHintOpen ? card.hint : "힌트 보기"}</span>
                          </button>
                        ) : <span />}
                        <span className="text-gray-500 flex items-center gap-1 text-[9px]">
                          <RotateCw className="w-3 h-3" /> 클릭하여 뒤집기
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : activeTab === "quizzes" ? (
            /* ── [3] 퀴즈 은행 뷰 ── */
            filteredQuizzes.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-gray-500 text-xs">
                <HelpCircle className="w-10 h-10 text-gray-600" />
                <p>추출된 퀴즈가 없습니다.</p>
                <button
                  onClick={() => openPromptModalForUnit()}
                  className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Copy className="w-4 h-4 text-amber-300" />
                  <span>퀴즈 프롬프트 복사</span>
                </button>
              </div>
            ) : (
              <div className="space-y-4 max-w-3xl mx-auto">
                {filteredQuizzes.map((quiz, qIdx) => {
                  const selectedOpt = quizAnswers[qIdx];
                  const isSubmitted = selectedOpt !== undefined;
                  const isCorrect = isSubmitted && selectedOpt === quiz.correct_option_id;
                  const hintLevel = quizHintLevels[qIdx] || 0;

                  return (
                    <div
                      key={qIdx}
                      className="rounded-2xl border border-white/10 bg-black/40 p-5 space-y-4 shadow-xl"
                    >
                      {/* 퀴즈 헤더 */}
                      <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono font-bold text-xs">
                            Q{qIdx + 1}
                          </span>
                          <span className="text-xs text-gray-400 font-medium">4지선다 개념 확인</span>
                          {quiz.chapter_title && (
                            <span className="text-[10px] text-gray-500">
                              · {quiz.chapter_title}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {quiz.pages?.map(p => (
                            <span key={p} className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400 font-mono text-[9px]">
                              p.{p}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* 문제 내용 */}
                      <p className="text-xs font-bold text-gray-100 leading-relaxed whitespace-pre-wrap">
                        {quiz.question}
                      </p>

                      {/* 4개 보기 버튼 */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {quiz.options?.map(opt => {
                          const isThisSelected = selectedOpt === opt.id;
                          let btnClass = "border-white/10 bg-white/5 text-gray-300 hover:bg-white/10";
                          if (isSubmitted) {
                            if (opt.id === quiz.correct_option_id) {
                              btnClass = "border-emerald-500 bg-emerald-500/20 text-emerald-200 font-bold";
                            } else if (isThisSelected) {
                              btnClass = "border-red-500 bg-red-500/20 text-red-200";
                            } else {
                              btnClass = "opacity-40 border-white/5 bg-transparent text-gray-500";
                            }
                          }

                          return (
                            <button
                              key={opt.id}
                              onClick={() => {
                                setQuizAnswers(prev => ({ ...prev, [qIdx]: opt.id }));
                              }}
                              className={`p-3 rounded-xl border text-xs text-left transition-all flex items-start gap-2.5 cursor-pointer ${btnClass}`}
                            >
                              <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center font-mono font-bold text-[10px] shrink-0">
                                {opt.id}
                              </span>
                              <span className="leading-snug">{opt.text}</span>
                            </button>
                          );
                        })}
                      </div>

                      {/* 소크라테스 힌트 서랍 */}
                      {quiz.socratic_hints && quiz.socratic_hints.length > 0 && (
                        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-amber-400 flex items-center gap-1">
                              <Lightbulb className="w-3.5 h-3.5" /> 소크라테스식 단계별 힌트
                            </span>
                            <button
                              onClick={() => {
                                setQuizHintLevels(prev => ({
                                  ...prev,
                                  [qIdx]: Math.min((prev[qIdx] || 0) + 1, quiz.socratic_hints!.length)
                                }));
                              }}
                              className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-all font-semibold cursor-pointer"
                            >
                              {hintLevel === 0 ? "1단계 힌트 열기" : hintLevel < quiz.socratic_hints.length ? `${hintLevel + 1}단계 힌트 더보기` : "모든 힌트 표시됨"}
                            </button>
                          </div>
                          {hintLevel > 0 && (
                            <div className="space-y-1.5 pt-1">
                              {quiz.socratic_hints.slice(0, hintLevel).map((hint, hIdx) => (
                                <div key={hIdx} className="text-xs text-amber-200/90 flex items-start gap-2 bg-amber-500/10 p-2 rounded-lg">
                                  <span className="font-mono font-bold text-[10px] text-amber-400 shrink-0">L{hIdx + 1}</span>
                                  <span>{hint}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* 정답 해설 */}
                      {isSubmitted && (
                        <div className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                          isCorrect ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200" : "bg-red-500/10 border-red-500/30 text-red-200"
                        }`}>
                          <div className="font-bold flex items-center gap-1.5">
                            {isCorrect ? <Check className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-red-400" />}
                            <span>{isCorrect ? "정답입니다!" : `오답입니다 (정답: ${quiz.correct_option_id}번)`}</span>
                          </div>
                          <p className="text-gray-300 text-[11px] leading-relaxed pt-1">
                            {quiz.explanation}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            /* ── [4] 개념 색인 뷰 ── */
            filteredIndex.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-gray-500 text-xs">
                <Hash className="w-10 h-10 text-gray-600" />
                <p>추출된 색인 항목이 없습니다.</p>
                <button
                  onClick={() => openPromptModalForUnit()}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Copy className="w-4 h-4 text-amber-300" />
                  <span>개념 색인 프롬프트 복사</span>
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-white/5 border-b border-white/10 text-gray-400 font-semibold text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3 w-12 text-center">#</th>
                      <th className="py-2.5 px-3 w-36">용어명</th>
                      <th className="py-2.5 px-3 w-28">소속 단원</th>
                      <th className="py-2.5 px-3 w-20">분류</th>
                      <th className="py-2.5 px-3">정의</th>
                      <th className="py-2.5 px-3 w-32">대표 수식</th>
                      <th className="py-2.5 px-3 w-24 text-center">등장 페이지</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredIndex.map((idxItem, idx) => (
                      <tr key={idx} className="hover:bg-white/5 transition-colors">
                        <td className="py-2 px-3 text-center text-gray-500 font-mono text-[10px]">{idx + 1}</td>
                        <td className="py-2 px-3 font-bold text-orange-300">{idxItem.term}</td>
                        <td className="py-2 px-3 text-gray-400 text-[10px] truncate max-w-[140px]">{idxItem.chapter_title || "-"}</td>
                        <td className="py-2 px-3">
                          <span className="px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-300 text-[10px]">
                            {idxItem.category || "개념"}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-gray-300 text-[11px]">{idxItem.definition}</td>
                        <td className="py-2 px-3 font-mono text-[10px] text-purple-300">{idxItem.formula || "-"}</td>
                        <td className="py-2 px-3 text-center">
                          <div className="flex items-center justify-center gap-1 flex-wrap">
                            {idxItem.pages?.map(p => (
                              <span key={p} className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-300 font-mono text-[9px]">
                                p.{p}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      </main>

      {/* ── 5. NotebookLM 개별 프롬프트 복사 모달 (TOC 생성 및 4대 태스크 1개씩 개별 복사) ── */}
      {showPromptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="glass w-[900px] max-w-full max-h-[90vh] rounded-2xl p-6 border border-indigo-500/30 shadow-2xl flex flex-col gap-4 overflow-hidden">
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Copy className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-100">NotebookLM 프롬프트 개별 복사 센터</h3>
                  <p className="text-[10px] text-gray-400">교재 전체 TOC(목차) 및 단원별 4대 태스크 프롬프트를 1개씩 복사하여 NotebookLM에 붙여넣으세요 (Google Ultra 비용 0원)</p>
                </div>
              </div>
              <button
                onClick={() => setShowPromptModal(false)}
                className="text-gray-400 hover:text-white text-xs px-2 py-1 rounded-lg border border-white/10 hover:bg-white/10"
              >
                닫기
              </button>
            </div>

            {/* 대상 단원 선택 바 */}
            <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/10 shrink-0 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-300">대상 단원 선택:</span>
                <select
                  value={activePromptUnit.id}
                  onChange={e => setPromptTargetUnitId(e.target.value)}
                  className="bg-[#121824] border border-white/10 text-xs text-indigo-300 font-semibold rounded-lg px-3 py-1.5 outline-none focus:border-indigo-500 cursor-pointer"
                >
                  {tocUnits.map(u => (
                    <option key={u.id} value={u.id} className="bg-[#121824] text-gray-200">
                      {u.title} (p.{u.startPage} ~ p.{u.endPage})
                    </option>
                  ))}
                </select>
              </div>

              <div className="text-xs text-indigo-300 font-mono font-bold bg-indigo-500/10 border border-indigo-500/20 px-3 py-1 rounded-lg">
                단원 범위: p.{activePromptUnit.startPage} ~ p.{activePromptUnit.endPage}
              </div>
            </div>

            {/* 개별 프롬프트 카드 그리드 (각각 1개씩 독립 복사) */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
              {/* 0. TOC 목차 JSON 추출 및 toc.json 생성 프롬프트 (최상단) */}
              {(() => {
                const promptText = getTocExtractionPrompt(currentBookTitle);
                const isCopied = copiedPromptKey === "toc";
                return (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-xs flex items-center gap-1">
                          <FileCode className="w-3.5 h-3.5 text-amber-400" /> 0. TOC 목차 JSON 추출 및 `toc.json` 생성 프롬프트
                        </span>
                        <span className="text-[10px] text-amber-200/80">교재 목차 $\rightarrow$ 표준 TOC JSON 및 toc.json 파일 다운로드 생성</span>
                      </div>
                      <button
                        onClick={() => copySinglePrompt(promptText, "toc", "TOC(목차) JSON 추출")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${
                          isCopied
                            ? "bg-emerald-600 text-white shadow-emerald-600/20"
                            : "bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/20"
                        }`}
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{isCopied ? "복사 완료!" : "TOC 프롬프트 복사"}</span>
                      </button>
                    </div>
                    <textarea
                      readOnly
                      value={promptText}
                      className="w-full h-32 bg-black/60 border border-amber-500/20 rounded-lg p-2.5 font-mono text-[11px] text-amber-200 focus:outline-none select-all"
                    />
                  </div>
                );
              })()}

              {/* 1. 플래시카드 프롬프트 */}
              {(() => {
                const promptText = getFlashcardPrompt(currentBookTitle, activePromptUnit);
                const isCopied = copiedPromptKey === "flashcards";
                return (
                  <div className="rounded-xl border border-purple-500/30 bg-black/40 p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold text-xs flex items-center gap-1">
                          <Layers className="w-3.5 h-3.5" /> 1. 플래시카드 추출 프롬프트
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-purple-900/40 text-purple-200 border border-purple-500/20 font-mono">
                          단원: {activePromptUnit.title} (p.{activePromptUnit.startPage}~p.{activePromptUnit.endPage})
                        </span>
                      </div>
                      <button
                        onClick={() => copySinglePrompt(promptText, "flashcards", `플래시카드 (${activePromptUnit.title})`)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${
                          isCopied
                            ? "bg-emerald-600 text-white shadow-emerald-600/20"
                            : "bg-purple-600 hover:bg-purple-500 text-white shadow-purple-600/20"
                        }`}
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{isCopied ? "복사 완료!" : "이 단원 프롬프트 복사"}</span>
                      </button>
                    </div>
                    <textarea
                      readOnly
                      value={promptText}
                      className="w-full h-28 bg-black/60 border border-white/10 rounded-lg p-2.5 font-mono text-[11px] text-purple-200 focus:outline-none select-all"
                    />
                  </div>
                );
              })()}

              {/* 2. 퀴즈 & 소크라테스 힌트 프롬프트 */}
              {(() => {
                const promptText = getQuizPrompt(currentBookTitle, activePromptUnit);
                const isCopied = copiedPromptKey === "quizzes";
                return (
                  <div className="rounded-xl border border-teal-500/30 bg-black/40 p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 font-bold text-xs flex items-center gap-1">
                          <HelpCircle className="w-3.5 h-3.5" /> 2. 4지선다 퀴즈 & 소크라테스 힌트 프롬프트
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-teal-900/40 text-teal-200 border border-teal-500/20 font-mono">
                          단원: {activePromptUnit.title} (p.{activePromptUnit.startPage}~p.{activePromptUnit.endPage})
                        </span>
                      </div>
                      <button
                        onClick={() => copySinglePrompt(promptText, "quizzes", `퀴즈 (${activePromptUnit.title})`)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${
                          isCopied
                            ? "bg-emerald-600 text-white shadow-emerald-600/20"
                            : "bg-teal-600 hover:bg-teal-500 text-white shadow-teal-600/20"
                        }`}
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{isCopied ? "복사 완료!" : "이 단원 프롬프트 복사"}</span>
                      </button>
                    </div>
                    <textarea
                      readOnly
                      value={promptText}
                      className="w-full h-28 bg-black/60 border border-white/10 rounded-lg p-2.5 font-mono text-[11px] text-teal-200 focus:outline-none select-all"
                    />
                  </div>
                );
              })()}

              {/* 3. 개념 색인(Index) 프롬프트 */}
              {(() => {
                const promptText = getIndexPrompt(currentBookTitle, activePromptUnit);
                const isCopied = copiedPromptKey === "index";
                return (
                  <div className="rounded-xl border border-blue-500/30 bg-black/40 p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-bold text-xs flex items-center gap-1">
                          <Hash className="w-3.5 h-3.5" /> 3. 개념 색인(Index) 추출 프롬프트
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-blue-900/40 text-blue-200 border border-blue-500/20 font-mono">
                          단원: {activePromptUnit.title} (p.{activePromptUnit.startPage}~p.{activePromptUnit.endPage})
                        </span>
                      </div>
                      <button
                        onClick={() => copySinglePrompt(promptText, "index", `개념 색인 (${activePromptUnit.title})`)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${
                          isCopied
                            ? "bg-emerald-600 text-white shadow-emerald-600/20"
                            : "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/20"
                        }`}
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{isCopied ? "복사 완료!" : "이 단원 프롬프트 복사"}</span>
                      </button>
                    </div>
                    <textarea
                      readOnly
                      value={promptText}
                      className="w-full h-28 bg-black/60 border border-white/10 rounded-lg p-2.5 font-mono text-[11px] text-blue-200 focus:outline-none select-all"
                    />
                  </div>
                );
              })()}

              {/* 4. 심층 딕셔너리 구축 프롬프트 */}
              {(() => {
                const promptText = getDictionaryPrompt(currentBookTitle, activePromptUnit);
                const isCopied = copiedPromptKey === "dictionary";
                return (
                  <div className="rounded-xl border border-orange-500/30 bg-black/40 p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded bg-orange-500/20 text-orange-300 font-bold text-xs flex items-center gap-1">
                          <BookOpen className="w-3.5 h-3.5" /> 4. 심층 딕셔너리 구축 프롬프트
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-orange-900/40 text-orange-200 border border-orange-500/20 font-mono">
                          단원: {activePromptUnit.title} (p.{activePromptUnit.startPage}~p.{activePromptUnit.endPage})
                        </span>
                      </div>
                      <button
                        onClick={() => copySinglePrompt(promptText, "dictionary", `심층 딕셔너리 (${activePromptUnit.title})`)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${
                          isCopied
                            ? "bg-emerald-600 text-white shadow-emerald-600/20"
                            : "bg-orange-600 hover:bg-orange-500 text-white shadow-orange-600/20"
                        }`}
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{isCopied ? "복사 완료!" : "이 단원 프롬프트 복사"}</span>
                      </button>
                    </div>
                    <textarea
                      readOnly
                      value={promptText}
                      className="w-full h-28 bg-black/60 border border-white/10 rounded-lg p-2.5 font-mono text-[11px] text-orange-200 focus:outline-none select-all"
                    />
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── 6. NotebookLM 결과 직접 붙여넣기 모달 ── */}
      {showPasteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="glass w-[650px] max-w-full rounded-2xl p-6 border border-blue-500/30 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-blue-400" />
                <h3 className="text-sm font-bold text-gray-100">NotebookLM 결과 직접 붙여넣기 (DB 적재)</h3>
              </div>
              <button
                onClick={() => setShowPasteModal(false)}
                className="text-gray-400 hover:text-white text-xs"
              >
                닫기
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-gray-400 font-semibold block mb-1">데이터 유형</label>
                <select
                  value={pasteDataType}
                  onChange={e => setPasteDataType(e.target.value as "dictionary" | "flashcards" | "quizzes" | "index")}
                  className="w-full bg-[#121824] border border-white/10 text-xs text-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-500"
                >
                  <option value="dictionary">수학 딕셔너리 (Dictionary)</option>
                  <option value="flashcards">플래시카드 (Flashcards)</option>
                  <option value="quizzes">퀴즈 (Quizzes)</option>
                  <option value="index">개념 색인 (Index)</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] text-gray-400 font-semibold block mb-1">소속 단원(TOC)</label>
                <select
                  value={pasteTargetUnitTitle}
                  onChange={e => setPasteTargetUnitTitle(e.target.value)}
                  className="w-full bg-[#121824] border border-white/10 text-xs text-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-500"
                >
                  <option value="">자동 (JSON 내부 필드 따름)</option>
                  {tocUnits.map(u => (
                    <option key={u.id} value={u.title}>{u.title}</option>
                  ))}
                </select>
              </div>
            </div>

            <textarea
              value={pastedJsonText}
              onChange={e => setPastedJsonText(e.target.value)}
              placeholder="NotebookLM에서 생성된 JSON 배열 문자열을 여기에 붙여넣으세요..."
              className="w-full h-52 bg-black/60 border border-white/10 rounded-xl p-3 font-mono text-xs text-gray-200 focus:outline-none focus:border-blue-500"
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowPasteModal(false)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold text-gray-300 transition-all cursor-pointer"
              >
                취소
              </button>
              <button
                onClick={handlePastedDataImport}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-xs font-bold text-white transition-all flex items-center gap-1.5 cursor-pointer shadow-lg shadow-blue-600/20"
              >
                <Database className="w-3.5 h-3.5" />
                <span>DB에 즉시 적재</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 7. 토스트 알림 ── */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 px-4 py-2.5 rounded-xl text-xs font-bold shadow-2xl z-50 flex items-center gap-2 ${
            toast.type === "error"
              ? "bg-red-500/90 text-white border border-red-500"
              : toast.type === "info"
              ? "bg-blue-600/90 text-white border border-blue-500"
              : "bg-emerald-500/90 text-white border border-emerald-500"
          }`}
        >
          {toast.type === "error" ? <AlertTriangle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
          <span>{toast.msg}</span>
        </div>
      )}
    </>
  );
}
