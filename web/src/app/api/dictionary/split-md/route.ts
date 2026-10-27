import { requireSession } from "@/lib/server/auth";
import { getText, putText } from "@/lib/server/s3";

const MD_PREFIX = process.env.S3_MD_PREFIX || "mathpix";

export type TocChapterItem = {
  chapterId?: string;
  chapterTitle?: string;
  startLine?: number;
  endLine?: number;
  page?: number | string;
  sections?: {
    sectionId?: string;
    sectionTitle?: string;
    startLine?: number;
    endLine?: number;
    page?: number | string;
    items?: { name?: string; startLine?: number; endLine?: number; page?: number | string }[];
  }[];
};

export type TocFileStructure = {
  bookTitle?: string;
  mdKey?: string;
  chapters?: TocChapterItem[];
};

export function sanitizeChapterId(chapterId?: string, chapterTitle?: string, fallbackIndex?: number): string {
  const raw = (chapterId && chapterId.trim()) || (chapterTitle && chapterTitle.trim()) || `chapter_${fallbackIndex ?? 1}`;
  const clean = raw.replace(/[\\/:*?"<>|]/g, "_").trim();
  return clean || `chapter_${fallbackIndex ?? 1}`;
}

export function resolveChapterLineRange(ch: TocChapterItem): { startLine: number; endLine: number; hasLine: boolean; reason?: string } {
  let start = typeof ch.startLine === "number" ? ch.startLine : 0;
  let end = typeof ch.endLine === "number" ? ch.endLine : 0;

  if (start <= 0 || end < start) {
    const validStarts: number[] = [];
    const validEnds: number[] = [];
    for (const sec of ch.sections ?? []) {
      if (typeof sec.startLine === "number" && sec.startLine > 0) validStarts.push(sec.startLine);
      if (typeof sec.endLine === "number" && sec.endLine > 0) validEnds.push(sec.endLine);
    }
    if (validStarts.length > 0 && validEnds.length > 0) {
      start = Math.min(...validStarts);
      end = Math.max(...validEnds);
    }
  }

  if (start > 0 && end >= start) {
    return { startLine: start, endLine: end, hasLine: true };
  }

  return {
    startLine: 0,
    endLine: 0,
    hasLine: false,
    reason: ch.page ? `페이지 지정 단원 (p.${ch.page})` : "라인 번호 미지정 (startLine <= 0)"
  };
}

async function loadTocAndMd(bookStem: string) {
  // toc.json 탐색 (mathpix/<stem>.toc.json 또는 mathpix/<stem>/toc.json)
  const candidateTocKeys = [
    `${MD_PREFIX}/${bookStem}.toc.json`,
    `${MD_PREFIX}/${bookStem}/toc.json`
  ];

  let tocText: string | null = null;
  let resolvedTocKey = candidateTocKeys[0];

  for (const k of candidateTocKeys) {
    tocText = await getText(k);
    if (tocText) {
      resolvedTocKey = k;
      break;
    }
  }

  if (!tocText) {
    throw new Error(`저장소에서 ${bookStem}의 목차 파일(${candidateTocKeys.join(" 또는 ")})을 찾을 수 없습니다.`);
  }

  let toc: TocFileStructure;
  try {
    toc = JSON.parse(tocText);
  } catch (e) {
    throw new Error(`toc.json 파싱 실패: ${(e as Error).message}`);
  }

  // 원본 md 파일 탐색 (toc.mdKey 또는 mathpix/<stem>.md)
  const candidateMdKeys = [
    toc.mdKey,
    `${MD_PREFIX}/${bookStem}.md`
  ].filter(Boolean) as string[];

  let mdText: string | null = null;
  let resolvedMdKey = candidateMdKeys[0];

  for (const k of candidateMdKeys) {
    mdText = await getText(k);
    if (mdText) {
      resolvedMdKey = k;
      break;
    }
  }

  if (!mdText) {
    throw new Error(`저장소에서 ${bookStem}의 원본 MD 파일(${candidateMdKeys.join(" 또는 ")})을 찾을 수 없습니다.`);
  }

  return { toc, resolvedTocKey, mdText, resolvedMdKey };
}

// 1. 미리보기: Line 지정 단원과 제외 단원(페이지 단원) 분석
export async function GET(req: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;

  const bookStem = new URL(req.url).searchParams.get("bookStem");
  if (!bookStem) return Response.json({ error: "bookStem 파라미터가 필요합니다." }, { status: 400 });

  try {
    const { toc, resolvedTocKey, mdText, resolvedMdKey } = await loadTocAndMd(bookStem);
    const lines = mdText.split(/\r?\n/);

    const lineChapters: {
      chapterId: string;
      chapterTitle: string;
      startLine: number;
      endLine: number;
      lineCount: number;
      targetFilename: string;
      targetKey: string;
    }[] = [];

    const excludedChapters: {
      chapterId: string;
      chapterTitle: string;
      reason: string;
    }[] = [];

    (toc.chapters ?? []).forEach((ch, idx) => {
      const res = resolveChapterLineRange(ch);
      const chId = (ch.chapterId && ch.chapterId.trim()) || `제${idx + 1}장`;
      const chTitle = (ch.chapterTitle && ch.chapterTitle.trim()) || "";

      if (res.hasLine) {
        const safeChapter = sanitizeChapterId(ch.chapterId, ch.chapterTitle, idx + 1);
        const filename = `${safeChapter}.md`;
        const targetKey = `${MD_PREFIX}/${bookStem}/${filename}`;
        const lineCount = Math.min(lines.length, res.endLine) - Math.max(1, res.startLine) + 1;

        lineChapters.push({
          chapterId: chId,
          chapterTitle: chTitle,
          startLine: res.startLine,
          endLine: res.endLine,
          lineCount,
          targetFilename: filename,
          targetKey
        });
      } else {
        excludedChapters.push({
          chapterId: chId,
          chapterTitle: chTitle,
          reason: res.reason || "페이지 지정 단원 (라인 정보 없음)"
        });
      }
    });

    return Response.json({
      bookStem,
      bookTitle: toc.bookTitle || bookStem,
      tocKey: resolvedTocKey,
      mdKey: resolvedMdKey,
      totalLines: lines.length,
      prefix: `${MD_PREFIX}/${bookStem}/`,
      lineChapters,
      excludedChapters
    });
  } catch (e) {
    console.error("[API /api/dictionary/split-md GET]", e);
    return Response.json({ error: (e as Error).message || "분할 미리보기 조회 실패" }, { status: 500 });
  }
}

// 2. 분할 실행 및 MinIO 저장
export async function POST(req: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;

  try {
    const { bookStem } = (await req.json()) as { bookStem?: string };
    if (!bookStem) return Response.json({ error: "bookStem 이 필요합니다." }, { status: 400 });

    const { toc, resolvedTocKey, mdText, resolvedMdKey } = await loadTocAndMd(bookStem);
    const lines = mdText.split(/\r?\n/);

    const savedResults: {
      chapterId: string;
      chapterTitle: string;
      startLine: number;
      endLine: number;
      lineCount: number;
      byteSize: number;
      targetFilename: string;
      targetKey: string;
    }[] = [];

    const excludedChapters: {
      chapterId: string;
      chapterTitle: string;
      reason: string;
    }[] = [];

    for (let idx = 0; idx < (toc.chapters ?? []).length; idx++) {
      const ch = toc.chapters![idx];
      const res = resolveChapterLineRange(ch);
      const chId = (ch.chapterId && ch.chapterId.trim()) || `제${idx + 1}장`;
      const chTitle = (ch.chapterTitle && ch.chapterTitle.trim()) || "";

      if (res.hasLine) {
        const safeChapter = sanitizeChapterId(ch.chapterId, ch.chapterTitle, idx + 1);
        const filename = `${safeChapter}.md`;
        const targetKey = `${MD_PREFIX}/${bookStem}/${filename}`;

        const safeStart = Math.max(1, res.startLine);
        const safeEnd = Math.min(lines.length, res.endLine);
        const chapterLines = lines.slice(safeStart - 1, safeEnd);
        const chapterContent = chapterLines.join("\n");

        await putText(targetKey, chapterContent, "text/markdown; charset=utf-8");

        savedResults.push({
          chapterId: chId,
          chapterTitle: chTitle,
          startLine: safeStart,
          endLine: safeEnd,
          lineCount: safeEnd - safeStart + 1,
          byteSize: Buffer.byteLength(chapterContent, "utf-8"),
          targetFilename: filename,
          targetKey
        });
      } else {
        excludedChapters.push({
          chapterId: chId,
          chapterTitle: chTitle,
          reason: res.reason || "페이지 지정 단원 (라인 정보 없음)"
        });
      }
    }

    return Response.json({
      success: true,
      bookStem,
      bookTitle: toc.bookTitle || bookStem,
      prefix: `${MD_PREFIX}/${bookStem}/`,
      savedCount: savedResults.length,
      excludedCount: excludedChapters.length,
      savedResults,
      excludedChapters,
      tocKey: resolvedTocKey,
      mdKey: resolvedMdKey
    });
  } catch (e) {
    console.error("[API /api/dictionary/split-md POST]", e);
    return Response.json({ error: (e as Error).message || "MD 파일 분할 실행 실패" }, { status: 500 });
  }
}
