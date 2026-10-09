import { NextResponse } from "next/server";
import {
  loadPageTextsForRange,
  extractChapterFlashcards,
  extractChapterQuizzes,
  extractChapterIndex,
  buildDictionaryFromIndex,
  generateNotebookLMPromptPack
} from "@/lib/server/dictionaryPipeline";
import {
  saveDictionaryItems,
  saveFlashcards,
  saveQuizzes,
  saveBookIndex
} from "@/lib/dictionaryDb";
import type { FlashcardItem, QuizItem, BookIndexItem, DictionaryItem } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      action = "full_pipeline", // "full_pipeline" | "generate_prompts" | "flashcards" | "quizzes" | "index" | "dictionary"
      bookStem,
      bookTitle = bookStem,
      chapterTitle = "전체 단원",
      startPage = 1,
      endPage = 30,
      kind = "main",
      units = [] // Array of { id: string, title: string, startPage: number, endPage: number }
    } = body;

    if (!bookStem) {
      return NextResponse.json({ error: "bookStem이 필요합니다." }, { status: 400 });
    }

    // 1) NotebookLM 프롬프트 생성 액션
    if (action === "generate_prompts") {
      const promptPack = generateNotebookLMPromptPack(bookTitle, chapterTitle, units.length > 0 ? units : undefined);
      return NextResponse.json({
        success: true,
        action,
        promptPack
      });
    }

    // 2) 단원(Units) 목록 결정
    const targetUnits: Array<{ title: string; startPage: number; endPage: number }> =
      units.length > 0
        ? units
        : [{ title: chapterTitle, startPage: Number(startPage), endPage: Number(endPage) }];

    let totalFlashcards: FlashcardItem[] = [];
    let totalQuizzes: QuizItem[] = [];
    let totalBookIndex: BookIndexItem[] = [];
    let totalDictionary: DictionaryItem[] = [];

    for (const unit of targetUnits) {
      console.log(`[TOC Pipeline] Processing Unit '${unit.title}' (p.${unit.startPage}~${unit.endPage}) for ${bookStem}...`);
      
      const { combinedText, pageMap } = await loadPageTextsForRange(bookStem, unit.startPage, unit.endPage, kind);
      if (!combinedText) {
        console.warn(`  ⚠️ Unit '${unit.title}' page text not found, skipping...`);
        continue;
      }

      // 플래시카드 추출
      if (action === "full_pipeline" || action === "flashcards") {
        const fc = await extractChapterFlashcards(bookStem, bookTitle, unit.title, combinedText);
        if (fc.length > 0) {
          await saveFlashcards(fc);
          totalFlashcards = totalFlashcards.concat(fc);
        }
      }

      // 퀴즈 추출
      if (action === "full_pipeline" || action === "quizzes") {
        const qz = await extractChapterQuizzes(bookStem, bookTitle, unit.title, combinedText);
        if (qz.length > 0) {
          await saveQuizzes(qz);
          totalQuizzes = totalQuizzes.concat(qz);
        }
      }

      // 색인 추출
      if (action === "full_pipeline" || action === "index" || action === "dictionary") {
        const idx = await extractChapterIndex(bookStem, bookTitle, unit.title, combinedText);
        if (idx.length > 0) {
          await saveBookIndex(idx);
          totalBookIndex = totalBookIndex.concat(idx);

          // 심층 딕셔너리 구축 (full_pipeline 또는 dictionary 액션인 경우)
          if (action === "full_pipeline" || action === "dictionary") {
            const dict = await buildDictionaryFromIndex(bookStem, bookTitle, unit.title, idx, pageMap);
            if (dict.length > 0) {
              await saveDictionaryItems(dict);
              totalDictionary = totalDictionary.concat(dict);
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      bookStem,
      bookTitle,
      processedUnitsCount: targetUnits.length,
      counts: {
        flashcards: totalFlashcards.length,
        quizzes: totalQuizzes.length,
        bookIndex: totalBookIndex.length,
        dictionary: totalDictionary.length
      },
      results: {
        flashcards: totalFlashcards,
        quizzes: totalQuizzes,
        bookIndex: totalBookIndex,
        dictionary: totalDictionary
      }
    });

  } catch (error: unknown) {
    const err = error as Error;
    console.error("[API /api/dictionary/process Error]", err);
    return NextResponse.json({ error: err.message || "Pipeline processing failed" }, { status: 500 });
  }
}
