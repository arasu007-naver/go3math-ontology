// unlimited-ocr 쪽 데이터 형태 (ocr.html 과 동일)
export type TocItem = { name: string; page: number | string };
export type TocSection = { sectionId: string; sectionTitle: string; page: number | string; items?: TocItem[] };
export type TocChapter = { chapterId: string; chapterTitle: string; sections: TocSection[] };
export type TocData = {
  chapters?: TocChapter[];
  commentaryFile?: string | string[];
  commentary?: string | string[];
  bookTitle?: string;
  documentId?: number;
};

export type BookTocRow = { id: number; bookTitle: string; pdfFilename: string; toc: string; [k: string]: unknown };
export type DocEntry = { id: string; name: string; main_stem: string; status: string };

export type PageJsonItem = { category?: string; content?: string; html?: string };
export type PageJson = { page?: string | number; dimensions?: string; items?: PageJsonItem[] };

// 선택된 도서
export type SelectedBook = {
  source: "booktoc" | "document";
  sourceId: string;
  title: string;
  stem: string; // origin/<stem>/ , main/<stem>/
  documentId: number | null;
  toc: TocData | null;
  commentaryStem: string; // 첫 번째 해설서 (없으면 "")
};

// 그래프 스키마 (스펙: 도서 / TOC 항목 / 페이지 / 문단)
export const PARAGRAPH_KINDS = ["정의", "공식", "성질", "문제", "해답"] as const;
export type ParagraphKind = (typeof PARAGRAPH_KINDS)[number];

export type TocNodeInput = {
  key: string; // 도서 안에서 고유 (예: "1/1-2")
  parentKey: string | null;
  level: "chapter" | "section" | "item";
  label: string;
  page: number | null;
  order: number;
};

export type BookInput = {
  stem: string;
  title: string;
  documentId: number | null;
  sourceOrder: number | null; // 시작 교재 순서 1~5
  pageOffset: number; // PDF 페이지 = TOC 페이지 + pageOffset (ocr.html 페이지 보정값)
  commentaryStem: string;
  toc: TocNodeInput[];
};

export type ParagraphInput = {
  idx: number; // 추출 JSON items 안의 위치. 문단 id 의 일부라 제외/재저장해도 바뀌지 않는다
  kind: ParagraphKind;
  category: string; // OCR JSON 원래 카테고리
  content: string;
  answersTo: string | null; // 해답 → 문제 문단 id
};

export type PageInput = {
  stem: string;
  kind: "main" | "commentary";
  page: number;
  tocKey: string | null;
  jsonKey: string | null;
  paragraphs: ParagraphInput[];
};

export type SavedParagraph = ParagraphInput & { id: string };
export type SavedPage = { id: string; tocKey: string | null; paragraphs: SavedParagraph[]; updatedAt: string };
export type ProblemRef = { id: string; page: number; kind: string; idx: number; snippet: string };
