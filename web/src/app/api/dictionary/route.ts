import { NextResponse } from "next/server";
import {
  getDictionaryItems,
  saveDictionaryItems,
  getFlashcards,
  saveFlashcards,
  getQuizzes,
  saveQuizzes,
  getBookIndex,
  saveBookIndex,
  deleteDictionaryItem,
  deleteFlashcard,
  deleteQuiz,
  deleteBookIndex,
  isDescriptiveQuizRow
} from "@/lib/dictionaryDb";
import { requireSession } from "@/lib/server/auth";
import { logBulkCreate, writeWorkLog, type WorkLogCategory } from "@/lib/server/workLog";

export async function GET(req: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  try {
    const url = new URL(req.url);
    const bookStem = url.searchParams.get("bookStem") || undefined;
    const search = url.searchParams.get("q") || undefined;

    const [dictionary, flashcards, quizzes, bookIndex] = await Promise.all([
      getDictionaryItems(bookStem, search),
      getFlashcards(bookStem),
      getQuizzes(bookStem),
      getBookIndex(bookStem)
    ]);

    return NextResponse.json({
      success: true,
      bookStem,
      dictionary,
      flashcards,
      quizzes,
      bookIndex
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[API /api/dictionary GET]", err);
    return NextResponse.json({ error: err.message || "Failed to fetch dictionary data" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  try {
    const body = await req.json();
    const { dictionary = [], flashcards = [], quizzes = [], bookIndex = [] } = body;

    const [savedDictCount, savedFcCount, savedQzCount, savedIdxCount] = await Promise.all([
      dictionary.length > 0 ? saveDictionaryItems(dictionary) : 0,
      flashcards.length > 0 ? saveFlashcards(flashcards) : 0,
      quizzes.length > 0 ? saveQuizzes(quizzes) : 0,
      bookIndex.length > 0 ? saveBookIndex(bookIndex) : 0
    ]);

    // 저장에 성공한 만큼만 기록(0건 category 는 건너뜀). 기록 실패는 응답에 영향을 주지 않는다.
    await logBulkCreate(
      {
        dictionary: savedDictCount ? dictionary : [],
        flashcards: savedFcCount ? flashcards : [],
        quizzes: savedQzCount ? quizzes : [],
        bookIndex: savedIdxCount ? bookIndex : []
      },
      s.user.id
    );

    return NextResponse.json({
      success: true,
      counts: {
        dictionary: savedDictCount,
        flashcards: savedFcCount,
        quizzes: savedQzCount,
        bookIndex: savedIdxCount
      }
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[API /api/dictionary POST]", err);
    return NextResponse.json({ error: err.message || "Failed to save dictionary data" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  try {
    const body = await req.json();
    const { type, id, bookStem, term, front, question } = body;

    let success = false;
    let category: WorkLogCategory = "dictionary";
    let label = "";
    const numId = id !== undefined && id !== null ? Number(id) : undefined;

    if (type === "dictionary") {
      label = `딕셔너리 삭제: ${String(term ?? id ?? "").slice(0, 40)}`;
      success = await deleteDictionaryItem(numId, bookStem, term);
    } else if (type === "flashcards") {
      category = "flashcard";
      label = `플래시카드 삭제: ${String(front ?? id ?? "").slice(0, 40)}`;
      success = await deleteFlashcard(numId, bookStem, front);
    } else if (type === "quizzes") {
      const descriptive = await isDescriptiveQuizRow(numId, bookStem, question).catch(() => false);
      category = descriptive ? "descriptive_quiz" : "quiz";
      label = `${descriptive ? "서술형 퀴즈" : "객관식 퀴즈"} 삭제: ${String(question ?? id ?? "").slice(0, 40)}`;
      success = await deleteQuiz(numId, bookStem, question);
    } else if (type === "index" || type === "bookIndex") {
      category = "book_index";
      label = `색인 삭제: ${String(term ?? id ?? "").slice(0, 40)}`;
      success = await deleteBookIndex(numId, bookStem, term);
    } else {
      return NextResponse.json({ error: "올바른 항목 타입이 아닙니다." }, { status: 400 });
    }

    if (success) {
      await writeWorkLog({
        category,
        action: "delete",
        summary: label,
        itemCount: 1,
        bookStem: bookStem ?? null,
        detail: { id: numId ?? null, bookStem: bookStem ?? null, ...(term !== undefined && { term }), ...(front !== undefined && { front }), ...(question !== undefined && { question }) },
        actor: s.user.id
      });
    }

    return NextResponse.json({ success });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[API /api/dictionary DELETE]", err);
    return NextResponse.json({ error: err.message || "항목 삭제에 실패했습니다." }, { status: 500 });
  }
}

