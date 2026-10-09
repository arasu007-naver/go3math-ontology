import { NextResponse } from "next/server";
import {
  getDictionaryItems,
  saveDictionaryItems,
  getFlashcards,
  saveFlashcards,
  getQuizzes,
  saveQuizzes,
  getBookIndex,
  saveBookIndex
} from "@/lib/dictionaryDb";

export async function GET(req: Request) {
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
  try {
    const body = await req.json();
    const { dictionary = [], flashcards = [], quizzes = [], bookIndex = [] } = body;

    const [savedDictCount, savedFcCount, savedQzCount, savedIdxCount] = await Promise.all([
      dictionary.length > 0 ? saveDictionaryItems(dictionary) : 0,
      flashcards.length > 0 ? saveFlashcards(flashcards) : 0,
      quizzes.length > 0 ? saveQuizzes(quizzes) : 0,
      bookIndex.length > 0 ? saveBookIndex(bookIndex) : 0
    ]);

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
