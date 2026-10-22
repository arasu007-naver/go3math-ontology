import type { LineToc, ParagraphKind, TocData, TocNodeInput } from "./types";

const toPage = (v: unknown): number | null => {
  const n = parseInt(String(v), 10);
  return isNaN(n) ? null : n;
};

// 장 → 절 → 항목 순서(문서 순서)로 펼친다. 장의 페이지는 첫 절의 페이지.
export function flattenToc(toc: TocData | null): TocNodeInput[] {
  const out: TocNodeInput[] = [];
  let order = 0;
  (toc?.chapters || []).forEach((ch, ci) => {
    const chKey = String(ch.chapterId ?? ci);
    out.push({
      key: chKey,
      parentKey: null,
      level: "chapter",
      label: `${ch.chapterId ?? ""} ${ch.chapterTitle ?? ""}`.trim(),
      page: toPage(ch.sections?.[0]?.page),
      order: order++,
    });
    (ch.sections || []).forEach((sec, si) => {
      const secKey = `${chKey}/${sec.sectionId ?? si}`;
      out.push({
        key: secKey,
        parentKey: chKey,
        level: "section",
        label: `${sec.sectionId ?? ""} ${sec.sectionTitle ?? ""}`.trim(),
        page: toPage(sec.page),
        order: order++,
      });
      (sec.items || []).forEach((it, ii) => {
        out.push({
          key: `${secKey}/${ii}`,
          parentKey: secKey,
          level: "item",
          label: it.name,
          page: toPage(it.page),
          order: order++,
        });
      });
    });
  });
  return out;
}

// 현재 페이지가 속한 TOC 항목: 시작 페이지 <= page 인 마지막(가장 깊은) 항목
export function tocKeyForPage(nodes: TocNodeInput[], page: number): string | null {
  let found: string | null = null;
  for (const n of nodes) {
    if (n.page != null && n.page <= page) found = n.key;
  }
  return found;
}

// OCR JSON 카테고리(13종) → 그래프 문단 종류(5종). null 이면 기본 제외.
const CATEGORY_TO_KIND: Record<string, ParagraphKind> = {
  개념: "정의",
  정의: "정의",
  공식: "공식",
  정리: "성질",
  성질: "성질",
  예제: "문제",
  유제: "문제",
  문제: "문제",
  해답: "해답",
  "다른 풀이": "해답",
};

export function kindForCategory(category: string | undefined): ParagraphKind | null {
  return CATEGORY_TO_KIND[(category || "").trim()] ?? null;
}

export function commentaryList(toc: TocData | null): string[] {
  const v = toc?.commentaryFile ?? toc?.commentary;
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

export const stripExt = (s: string) =>
  String(s || "")
    .replace(/\.json$/i, "")
    .replace(/\.pdf$/i, "")
    .replace(/\.md$/i, "");

import type { TocUnitRange } from "./types";
export { type TocUnitRange };

// TOC 데이터를 기반으로 단원/챕터별 시작~끝 페이지 범위를 정밀 자동 산출
export function extractTocUnitsWithPageRanges(toc: TocData | null, maxPage: number = 300): TocUnitRange[] {
  if (!toc?.chapters || toc.chapters.length === 0) {
    return [{
      id: "all",
      title: "전체 도서",
      chapterTitle: "전체 도서",
      startPage: 1,
      endPage: maxPage,
      level: "chapter",
      order: 0
    }];
  }

  const rawUnits: Array<{
    id: string;
    title: string;
    chapterTitle: string;
    sectionTitle?: string;
    page: number;
    level: "chapter" | "section";
  }> = [];

  toc.chapters.forEach((ch, ci) => {
    const chTitle = `${ch.chapterId ?? ""} ${ch.chapterTitle ?? ""}`.trim() || `제${ci + 1}장`;
    const chSections = ch.sections || [];
    const chPage = parseInt(String(chSections[0]?.page || 1), 10) || 1;

    if (chSections.length === 0) {
      rawUnits.push({
        id: `ch_${ci}`,
        title: chTitle,
        chapterTitle: chTitle,
        page: chPage,
        level: "chapter"
      });
    } else {
      chSections.forEach((sec, si) => {
        const secTitle = `${sec.sectionId ?? ""} ${sec.sectionTitle ?? ""}`.trim() || `제${si + 1}절`;
        const secPage = parseInt(String(sec.page || chPage), 10) || chPage;
        rawUnits.push({
          id: `ch_${ci}_sec_${si}`,
          title: `${chTitle} > ${secTitle}`,
          chapterTitle: chTitle,
          sectionTitle: secTitle,
          page: secPage,
          level: "section"
        });
      });
    }
  });

  // 시작 페이지 순 정렬
  rawUnits.sort((a, b) => a.page - b.page);

  // 다음 단원의 시작 페이지 - 1을 현재 단원의 endPage로 설정
  const result: TocUnitRange[] = [];
  for (let i = 0; i < rawUnits.length; i++) {
    const current = rawUnits[i];
    const next = rawUnits[i + 1];
    let endPage: number;
    if (next && next.page > current.page) {
      endPage = next.page - 1;
    } else if (next && next.page === current.page) {
      endPage = current.page;
    } else {
      endPage = Math.max(current.page + 15, maxPage);
    }

    result.push({
      id: current.id,
      title: current.title,
      chapterTitle: current.chapterTitle,
      sectionTitle: current.sectionTitle,
      startPage: current.page,
      endPage: Math.max(current.page, endPage),
      level: current.level,
      order: i
    });
  }

  return result;
}

// 라인 TOC(toc.json) 의 대단원마다 단원 하나. 범위는 MD 라인이고,
// 페이지 범위(startPage/endPage)는 페이지 TOC 에서 같은 대단원 제목을 찾아 채운다 (없으면 1~maxPage)
export function extractTocUnitsWithLineRanges(lineToc: LineToc, pageToc: TocData | null, maxPage: number = 300): TocUnitRange[] {
  const pageUnits = extractTocUnitsWithPageRanges(pageToc, maxPage);
  return (lineToc.chapters ?? []).map((ch, ci) => {
    const title = `${ch.chapterId ?? ""} ${ch.chapterTitle ?? ""}`.trim() || `제${ci + 1}장`;
    const pages = pageUnits.filter((u) => u.chapterTitle === title);
    return {
      id: `line_ch_${ci}`,
      title,
      chapterTitle: title,
      startPage: pages.length ? Math.min(...pages.map((u) => u.startPage)) : 1,
      endPage: pages.length ? Math.max(...pages.map((u) => u.endPage)) : maxPage,
      startLine: ch.startLine || 0,
      endLine: ch.endLine || 0,
      level: "chapter" as const,
      order: ci,
    };
  });
}

// 단원 범위 표기: 라인이 지정된 단원은 MD 라인, 아니면 페이지
export const hasLineRange = (u: TocUnitRange) => !!u.startLine && u.startLine > 0;
export function unitRangeLabel(u: TocUnitRange): string {
  return hasLineRange(u) ? `L${u.startLine} ~ L${u.endLine}` : `p.${u.startPage} ~ p.${u.endPage}`;
}
// 프롬프트용 범위 설명
export function unitRangeText(u: TocUnitRange): string {
  return hasLineRange(u) ? `MD 라인 범위: L${u.startLine} ~ L${u.endLine}` : `페이지 범위: p.${u.startPage} ~ p.${u.endPage}`;
}
