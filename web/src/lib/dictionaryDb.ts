import { Pool } from "pg";
import type { DictionaryItem, FlashcardItem, QuizItem, BookIndexItem } from "./types";
import { indexKey, linkIndexId, toPages } from "./bookIndices";

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

// 색인 zip 한 장(章) 분량. 각 배열은 JSON 파일 내용 그대로다.
type Raw = Record<string, unknown>;
export type BookIndexChapter = { n: number; indices: Raw[]; dictionary: Raw[]; flashcards: Raw[]; quizzes: Raw[] };

// 색인 zip 저장: 색인을 넣고, 딕셔너리·플래시카드·퀴즈는 index 키(색인명)로 book_index_id 를 연결한다. 전체가 한 트랜잭션.
// 같은 도서·단원을 다시 올리면 그 단원의 플래시카드·퀴즈는 교체한다(유니크 키가 없어 쌓이지 않게).
export async function saveBookIndexChapters(bookStem: string, chapters: BookIndexChapter[]) {
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  const counts = { indices: 0, dictionary: 0, flashcards: 0, quizzes: 0, unlinked: 0 };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const ch of chapters) {
      const chapterOf = (it: Raw) => text(it.chapter_title) ?? `제${ch.n}장`;
      const link = (it: Raw) => {
        const id = linkIndexId(it, idByTerm);
        if (id === null) counts.unlinked++;
        return id;
      };

      const idByTerm = new Map<string, number>();
      for (const it of ch.indices) {
        const term = indexKey(it.term ?? it.index);
        const res = await client.query(
          `INSERT INTO kg.book_index (book_stem, book_title, chapter_title, term, category, definition, formula, pages)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (book_stem, term) DO UPDATE SET
             book_title = COALESCE(EXCLUDED.book_title, kg.book_index.book_title),
             chapter_title = EXCLUDED.chapter_title,
             category = COALESCE(EXCLUDED.category, kg.book_index.category),
             definition = COALESCE(EXCLUDED.definition, kg.book_index.definition),
             formula = COALESCE(EXCLUDED.formula, kg.book_index.formula),
             pages = EXCLUDED.pages
           RETURNING id`,
          [bookStem, text(it.book_title), chapterOf(it), term, text(it.category), text(it.definition), text(it.formula), toPages(it.pages)]
        );
        idByTerm.set(term, Number(res.rows[0].id));
        counts.indices++;
      }

      for (const it of ch.dictionary) {
        await client.query(
          `INSERT INTO kg.dictionary (
             book_stem, book_title, chapter_title, term, english_term, definition, formula, geometric_meaning,
             theorems, misconceptions, examples, prerequisites, subsequent_concepts, pages, book_index_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (book_stem, term) DO UPDATE SET
             book_title = COALESCE(EXCLUDED.book_title, kg.dictionary.book_title),
             chapter_title = EXCLUDED.chapter_title,
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
             book_index_id = EXCLUDED.book_index_id,
             updated_at = now()`,
          [
            bookStem, text(it.book_title), chapterOf(it), indexKey(it.term ?? it.index), text(it.english_term),
            text(it.definition) ?? "", text(it.formula), text(it.geometric_meaning),
            JSON.stringify(it.theorems ?? []), JSON.stringify(it.misconceptions ?? []), JSON.stringify(it.examples ?? []),
            JSON.stringify(it.prerequisites ?? []), JSON.stringify(it.subsequent_concepts ?? []), toPages(it.pages), link(it),
          ]
        );
        counts.dictionary++;
      }

      await client.query(`DELETE FROM kg.flashcards WHERE book_stem = $1 AND chapter_title = ANY($2)`, [bookStem, [...new Set(ch.flashcards.map(chapterOf))]]);
      for (const it of ch.flashcards) {
        await client.query(
          `INSERT INTO kg.flashcards (book_stem, book_title, chapter_title, front, back, hint, formula, pages, book_index_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [bookStem, text(it.book_title), chapterOf(it), text(it.front) ?? "", text(it.back) ?? "", text(it.hint), text(it.formula), toPages(it.pages), link(it)]
        );
        counts.flashcards++;
      }

      await client.query(`DELETE FROM kg.quizzes WHERE book_stem = $1 AND chapter_title = ANY($2)`, [bookStem, [...new Set(ch.quizzes.map(chapterOf))]]);
      for (const it of ch.quizzes) {
        await client.query(
          `INSERT INTO kg.quizzes (book_stem, book_title, chapter_title, question, options, correct_option_id, explanation, socratic_hints, pages, book_index_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            bookStem, text(it.book_title), chapterOf(it), text(it.question) ?? "", JSON.stringify(it.options ?? []),
            Number(it.correct_option_id) || 0, text(it.explanation) ?? "", JSON.stringify(it.socratic_hints ?? []), toPages(it.pages), link(it),
          ]
        );
        counts.quizzes++;
      }
    }
    await client.query("COMMIT");
    return counts;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteDictionaryItem(id?: number, bookStem?: string, term?: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    if (id) {
      const res = await client.query(`DELETE FROM kg.dictionary WHERE id = $1`, [id]);
      return (res.rowCount ?? 0) > 0;
    } else if (bookStem && term) {
      const res = await client.query(`DELETE FROM kg.dictionary WHERE book_stem = $1 AND term = $2`, [bookStem, term]);
      return (res.rowCount ?? 0) > 0;
    }
    return false;
  } finally {
    client.release();
  }
}

export async function deleteFlashcard(id?: number, bookStem?: string, front?: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    if (id) {
      const res = await client.query(`DELETE FROM kg.flashcards WHERE id = $1`, [id]);
      return (res.rowCount ?? 0) > 0;
    } else if (bookStem && front) {
      const res = await client.query(`DELETE FROM kg.flashcards WHERE book_stem = $1 AND front = $2`, [bookStem, front]);
      return (res.rowCount ?? 0) > 0;
    }
    return false;
  } finally {
    client.release();
  }
}

export async function deleteQuiz(id?: number, bookStem?: string, question?: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    if (id) {
      const res = await client.query(`DELETE FROM kg.quizzes WHERE id = $1`, [id]);
      return (res.rowCount ?? 0) > 0;
    } else if (bookStem && question) {
      const res = await client.query(`DELETE FROM kg.quizzes WHERE book_stem = $1 AND question = $2`, [bookStem, question]);
      return (res.rowCount ?? 0) > 0;
    }
    return false;
  } finally {
    client.release();
  }
}

export async function deleteBookIndex(id?: number, bookStem?: string, term?: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    if (id) {
      const res = await client.query(`DELETE FROM kg.book_index WHERE id = $1`, [id]);
      return (res.rowCount ?? 0) > 0;
    } else if (bookStem && term) {
      const res = await client.query(`DELETE FROM kg.book_index WHERE book_stem = $1 AND term = $2`, [bookStem, term]);
      return (res.rowCount ?? 0) > 0;
    }
    return false;
  } finally {
    client.release();
  }
}

