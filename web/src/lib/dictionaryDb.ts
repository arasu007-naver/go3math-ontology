import { Pool } from "pg";
import type { DictionaryItem, FlashcardItem, QuizItem, BookIndexItem } from "./types";

const pool = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});

export async function getDictionaryItems(bookStem?: string, search?: string): Promise<DictionaryItem[]> {
  const client = await pool.connect();
  try {
    let q = `SELECT * FROM kg.dictionary WHERE 1=1`;
    const params: unknown[] = [];
    if (bookStem) {
      params.push(bookStem);
      q += ` AND book_stem = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      q += ` AND (term ILIKE $${params.length} OR definition ILIKE $${params.length} OR english_term ILIKE $${params.length})`;
    }
    q += ` ORDER BY term ASC`;
    const res = await client.query(q, params);
    return res.rows;
  } finally {
    client.release();
  }
}

export async function saveDictionaryItems(items: DictionaryItem[]): Promise<number> {
  if (!items || items.length === 0) return 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const item of items) {
      await client.query(
        `INSERT INTO kg.dictionary (
          book_stem, book_title, chapter_title, term, english_term, definition, formula,
          geometric_meaning, theorems, misconceptions, examples, prerequisites, subsequent_concepts, pages
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (book_stem, term) DO UPDATE SET
          book_title = COALESCE(EXCLUDED.book_title, kg.dictionary.book_title),
          chapter_title = COALESCE(EXCLUDED.chapter_title, kg.dictionary.chapter_title),
          english_term = COALESCE(EXCLUDED.english_term, kg.dictionary.english_term),
          definition = EXCLUDED.definition,
          formula = COALESCE(EXCLUDED.formula, kg.dictionary.formula),
          geometric_meaning = COALESCE(EXCLUDED.geometric_meaning, kg.dictionary.geometric_meaning),
          theorems = EXCLUDED.theorems,
          misconceptions = EXCLUDED.misconceptions,
          examples = EXCLUDED.examples,
          prerequisites = EXCLUDED.prerequisites,
          subsequent_concepts = EXCLUDED.subsequent_concepts,
          pages = EXCLUDED.pages,
          updated_at = now()`,
        [
          item.book_stem,
          item.book_title || null,
          item.chapter_title || null,
          item.term,
          item.english_term || null,
          item.definition,
          item.formula || null,
          item.geometric_meaning || null,
          JSON.stringify(item.theorems || []),
          JSON.stringify(item.misconceptions || []),
          JSON.stringify(item.examples || []),
          JSON.stringify(item.prerequisites || []),
          JSON.stringify(item.subsequent_concepts || []),
          item.pages || []
        ]
      );
    }
    await client.query("COMMIT");
    return items.length;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getFlashcards(bookStem?: string): Promise<FlashcardItem[]> {
  const client = await pool.connect();
  try {
    let q = `SELECT * FROM kg.flashcards WHERE 1=1`;
    const params: unknown[] = [];
    if (bookStem) {
      params.push(bookStem);
      q += ` AND book_stem = $${params.length}`;
    }
    q += ` ORDER BY id ASC`;
    const res = await client.query(q, params);
    return res.rows;
  } finally {
    client.release();
  }
}

export async function saveFlashcards(items: FlashcardItem[]): Promise<number> {
  if (!items || items.length === 0) return 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const item of items) {
      await client.query(
        `INSERT INTO kg.flashcards (
          book_stem, book_title, chapter_title, front, back, hint, formula, pages
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          item.book_stem,
          item.book_title || null,
          item.chapter_title || null,
          item.front,
          item.back,
          item.hint || null,
          item.formula || null,
          item.pages || []
        ]
      );
    }
    await client.query("COMMIT");
    return items.length;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getQuizzes(bookStem?: string): Promise<QuizItem[]> {
  const client = await pool.connect();
  try {
    let q = `SELECT * FROM kg.quizzes WHERE 1=1`;
    const params: unknown[] = [];
    if (bookStem) {
      params.push(bookStem);
      q += ` AND book_stem = $${params.length}`;
    }
    q += ` ORDER BY id ASC`;
    const res = await client.query(q, params);
    return res.rows;
  } finally {
    client.release();
  }
}

export async function saveQuizzes(items: QuizItem[]): Promise<number> {
  if (!items || items.length === 0) return 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const item of items) {
      await client.query(
        `INSERT INTO kg.quizzes (
          book_stem, book_title, chapter_title, question, options, correct_option_id, explanation, socratic_hints, pages
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          item.book_stem,
          item.book_title || null,
          item.chapter_title || null,
          item.question,
          JSON.stringify(item.options || []),
          item.correct_option_id,
          item.explanation,
          JSON.stringify(item.socratic_hints || []),
          item.pages || []
        ]
      );
    }
    await client.query("COMMIT");
    return items.length;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getBookIndex(bookStem?: string): Promise<BookIndexItem[]> {
  const client = await pool.connect();
  try {
    let q = `SELECT * FROM kg.book_index WHERE 1=1`;
    const params: unknown[] = [];
    if (bookStem) {
      params.push(bookStem);
      q += ` AND book_stem = $${params.length}`;
    }
    q += ` ORDER BY term ASC`;
    const res = await client.query(q, params);
    return res.rows;
  } finally {
    client.release();
  }
}

export async function saveBookIndex(items: BookIndexItem[]): Promise<number> {
  if (!items || items.length === 0) return 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const item of items) {
      await client.query(
        `INSERT INTO kg.book_index (
          book_stem, book_title, chapter_title, term, category, definition, formula, pages
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (book_stem, term) DO UPDATE SET
          book_title = COALESCE(EXCLUDED.book_title, kg.book_index.book_title),
          chapter_title = COALESCE(EXCLUDED.chapter_title, kg.book_index.chapter_title),
          category = COALESCE(EXCLUDED.category, kg.book_index.category),
          definition = COALESCE(EXCLUDED.definition, kg.book_index.definition),
          formula = COALESCE(EXCLUDED.formula, kg.book_index.formula),
          pages = EXCLUDED.pages`,
        [
          item.book_stem,
          item.book_title || null,
          item.chapter_title || null,
          item.term,
          item.category || null,
          item.definition || null,
          item.formula || null,
          item.pages || []
        ]
      );
    }
    await client.query("COMMIT");
    return items.length;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
