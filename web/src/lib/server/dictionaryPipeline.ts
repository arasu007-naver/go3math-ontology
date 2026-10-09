import fs from "node:fs/promises";
import path from "node:path";
import type { DictionaryItem, FlashcardItem, QuizItem, BookIndexItem, QuizOption } from "../types";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6I_16X61JkqZh5BcXWUjLNlSZuzQMoRzKr7lKYPzLF8Zw";
const OCR_SERVER_URL = process.env.OCR_SERVER_URL || "http://localhost:8088";

// ── S3 / 로컬 페이지 텍스트 로드 ──
export async function loadPageTextsForRange(
  bookStem: string,
  startPage: number,
  endPage: number,
  kind: "main" | "commentary" = "main"
): Promise<{ combinedText: string; pageMap: Map<number, string> }> {
  const pageMap = new Map<number, string>();
  const textChunks: string[] = [];

  for (let p = startPage; p <= endPage; p++) {
    let pageContent = "";
    // 1) 로컬 outputs 폴더 시도
    const localPaths = [
      path.join(process.cwd(), "..", "mvps", "unlimited-ocr", "outputs", bookStem, `${p}.txt`),
      path.join(process.cwd(), "outputs", bookStem, `${p}.txt`),
      path.join(process.cwd(), "..", "mvps", "unlimited-ocr", `${p}_extracted.txt`)
    ];

    for (const lp of localPaths) {
      try {
        pageContent = await fs.readFile(lp, "utf-8");
        if (pageContent) break;
      } catch {}
    }

    // 2) OCR 서버 API 시도
    if (!pageContent) {
      try {
        const res = await fetch(`${OCR_SERVER_URL}/api/get-page-json?pdf_name=${encodeURIComponent(bookStem)}&kind=${kind}&page=${p}`);
        if (res.ok) {
          const json = (await res.json()) as { items?: Array<{ content?: string; html?: string }> };
          if (json?.items) {
            pageContent = json.items.map(it => it.content || it.html || "").join("\n");
          }
        }
      } catch {}
    }

    if (pageContent && pageContent.trim()) {
      pageMap.set(p, pageContent.trim());
      textChunks.push(`--- [Page ${p}] ---\n${pageContent.trim()}`);
    }
  }

  return {
    combinedText: textChunks.join("\n\n"),
    pageMap
  };
}

// ── Gemini JSON API 호출 헬퍼 ──
async function callGeminiJson<T>(prompt: string, contextText: string, schema: Record<string, unknown>): Promise<T | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          { text: contextText }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: schema
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("[Gemini API Error]", res.status, errText);
    throw new Error(`Gemini API Error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawJson) return null;
  return JSON.parse(rawJson) as T;
}

// ── 1. 플래시카드 추출 ──
export async function extractChapterFlashcards(
  bookStem: string,
  bookTitle: string,
  chapterTitle: string,
  chapterText: string
): Promise<FlashcardItem[]> {
  const prompt = `
당신은 대한민국 최고의 고등/중등 수학 교육 전문가입니다.
주어진 [${chapterTitle}] 챕터 본문을 분석하여, 학생이 반드시 암기하고 숙지해야 할 핵심 개념 플래시카드를 추출하세요.

[규칙]
- front: 핵심 질문, 개념/정의 명칭, 빈칸 채우기 형식
- back: 명쾌한 정답, 공식, 핵심 설명 (수식은 LaTeX $...$ 표기)
- hint: 기억을 돕는 가벼운 힌트 (1줄)
- pages: 본문의 [Page X] 태그를 기준으로 관련 페이지 번호 배열
`;

  const schema = {
    type: "OBJECT",
    properties: {
      items: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            front: { type: "STRING" },
            back: { type: "STRING" },
            hint: { type: "STRING" },
            formula: { type: "STRING" },
            pages: { type: "ARRAY", items: { type: "INTEGER" } }
          },
          required: ["front", "back", "pages"]
        }
      }
    },
    required: ["items"]
  };

  const result = await callGeminiJson<{ items: Array<{ front: string; back: string; hint?: string; formula?: string; pages?: number[] }> }>(prompt, chapterText, schema);
  if (!result || !result.items) return [];

  return result.items.map(it => ({
    book_stem: bookStem,
    book_title: bookTitle,
    chapter_title: chapterTitle,
    front: it.front,
    back: it.back,
    hint: it.hint || "",
    formula: it.formula || "",
    pages: it.pages || []
  }));
}

// ── 2. 퀴즈 추출 (소크라테스 3단계 힌트 포함) ──
export async function extractChapterQuizzes(
  bookStem: string,
  bookTitle: string,
  chapterTitle: string,
  chapterText: string
): Promise<QuizItem[]> {
  const prompt = `
주어진 [${chapterTitle}] 챕터 본문을 분석하여, 학생들의 개념 이해도를 정밀 평가하는 4지선다형 퀴즈를 생성하세요.

[규칙]
- question: 문제 내용 (수식은 LaTeX $...$ 표기)
- options: 4개의 선택지 배열 (id: 1, 2, 3, 4와 text)
- correct_option_id: 정답 번호 (1~4)
- explanation: 상세한 풀이 및 정답 근거
- socratic_hints: 오답 시 순차 제공할 3단계 소크라테스식 유도 힌트 배열
  1) Level 1: 개념 상기 힌트
  2) Level 2: 오개념 짚기 질문
  3) Level 3: 단계별 하위 유도 질문
- pages: 출처 [Page X] 번호 배열
`;

  const schema = {
    type: "OBJECT",
    properties: {
      items: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            question: { type: "STRING" },
            options: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  id: { type: "INTEGER" },
                  text: { type: "STRING" }
                },
                required: ["id", "text"]
              }
            },
            correct_option_id: { type: "INTEGER" },
            explanation: { type: "STRING" },
            socratic_hints: { type: "ARRAY", items: { type: "STRING" } },
            pages: { type: "ARRAY", items: { type: "INTEGER" } }
          },
          required: ["question", "options", "correct_option_id", "explanation", "socratic_hints", "pages"]
        }
      }
    },
    required: ["items"]
  };

  const result = await callGeminiJson<{
    items: Array<{
      question: string;
      options: QuizOption[];
      correct_option_id: number;
      explanation: string;
      socratic_hints?: string[];
      pages?: number[];
    }>;
  }>(prompt, chapterText, schema);

  if (!result || !result.items) return [];

  return result.items.map(it => ({
    book_stem: bookStem,
    book_title: bookTitle,
    chapter_title: chapterTitle,
    question: it.question,
    options: it.options || [],
    correct_option_id: it.correct_option_id,
    explanation: it.explanation,
    socratic_hints: it.socratic_hints || [],
    pages: it.pages || []
  }));
}

// ── 3. 색인 추출 ──
export async function extractChapterIndex(
  bookStem: string,
  bookTitle: string,
  chapterTitle: string,
  chapterText: string
): Promise<BookIndexItem[]> {
  const prompt = `
주어진 [${chapterTitle}] 챕터 본문에 나오는 모든 수학 용어, 개념, 정리(Theorem)의 색인(Index)을 추출하세요.

[규칙]
- term: 용어/개념명
- category: 정의 / 정리 / 공식 / 성질 / 방법
- definition: 1~2문장의 간결한 핵심 정의
- formula: 대표 수식
- pages: 본문 [Page X]에 등장한 실제 페이지 번호 목록
`;

  const schema = {
    type: "OBJECT",
    properties: {
      items: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            term: { type: "STRING" },
            category: { type: "STRING" },
            definition: { type: "STRING" },
            formula: { type: "STRING" },
            pages: { type: "ARRAY", items: { type: "INTEGER" } }
          },
          required: ["term", "category", "definition", "pages"]
        }
      }
    },
    required: ["items"]
  };

  const result = await callGeminiJson<{
    items: Array<{
      term: string;
      category?: string;
      definition?: string;
      formula?: string;
      pages?: number[];
    }>;
  }>(prompt, chapterText, schema);

  if (!result || !result.items) return [];

  return result.items.map(it => ({
    book_stem: bookStem,
    book_title: bookTitle,
    chapter_title: chapterTitle,
    term: it.term,
    category: it.category || "개념",
    definition: it.definition || "",
    formula: it.formula || "",
    pages: it.pages || []
  }));
}

// ── 4. 색인 기반 타깃 페이지 심층 딕셔너리 구축 ──
export async function buildDictionaryFromIndex(
  bookStem: string,
  bookTitle: string,
  chapterTitle: string,
  indexTerms: BookIndexItem[],
  pageMap: Map<number, string>
): Promise<DictionaryItem[]> {
  const dictionaryList: DictionaryItem[] = [];

  for (const idxItem of indexTerms) {
    // 해당 용어가 등장하는 페이지만 선별
    const targetedPagesText = (idxItem.pages || [])
      .filter(p => pageMap.has(p))
      .map(p => `--- [Page ${p}] ---\n${pageMap.get(p)}`)
      .join("\n\n");

    if (!targetedPagesText) {
      // 페이지 텍스트가 부족하더라도 기본 색인 정보로 딕셔너리 생성
      dictionaryList.push({
        book_stem: bookStem,
        book_title: bookTitle,
        chapter_title: chapterTitle,
        term: idxItem.term,
        definition: idxItem.definition || `${idxItem.term}에 대한 수학적 정의`,
        formula: idxItem.formula || "",
        pages: idxItem.pages || []
      });
      continue;
    }

    const prompt = `
당신은 수학 개념 백과사전(Ontology Dictionary) 편찬자입니다.
주어진 특정 페이지 본문을 참고하여 용어 [${idxItem.term}]에 대한 깊이 있는 딕셔너리 항목을 생성하세요.

[작성 필드]
- english_term: 영문 용어명
- definition: 수학적 정의 및 기본 공식 ($...$ LaTeX)
- geometric_meaning: 기하학적 / 시각적 / 직관적 의미
- theorems: 관련 핵심 정리 배열 [{ name: "정리 이름", description: "설명", note: "주의사항" }]
- misconceptions: 학생들이 자주 빠지는 오개념 및 주의할 점 배열
- examples: 교재 예제와 풀이 배열 [{ problem: "문제", solution: "풀이" }]
- prerequisites: 선수 학습 개념 배열
- subsequent_concepts: 후속 학습 개념 배열
`;

    const schema = {
      type: "OBJECT",
      properties: {
        english_term: { type: "STRING" },
        definition: { type: "STRING" },
        geometric_meaning: { type: "STRING" },
        theorems: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING" },
              description: { type: "STRING" },
              note: { type: "STRING" }
            },
            required: ["name", "description"]
          }
        },
        misconceptions: { type: "ARRAY", items: { type: "STRING" } },
        examples: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              problem: { type: "STRING" },
              solution: { type: "STRING" }
            },
            required: ["problem", "solution"]
          }
        },
        prerequisites: { type: "ARRAY", items: { type: "STRING" } },
        subsequent_concepts: { type: "ARRAY", items: { type: "STRING" } }
      },
      required: ["definition"]
    };

    try {
      const detailed = await callGeminiJson<{
        english_term?: string;
        definition?: string;
        geometric_meaning?: string;
        theorems?: Array<{ name: string; description: string; note?: string }>;
        misconceptions?: string[];
        examples?: Array<{ problem: string; solution: string }>;
        prerequisites?: string[];
        subsequent_concepts?: string[];
      }>(prompt, targetedPagesText, schema);

      if (detailed) {
        dictionaryList.push({
          book_stem: bookStem,
          book_title: bookTitle,
          chapter_title: chapterTitle,
          term: idxItem.term,
          english_term: detailed.english_term || "",
          definition: detailed.definition || idxItem.definition || "",
          formula: idxItem.formula || "",
          geometric_meaning: detailed.geometric_meaning || "",
          theorems: detailed.theorems || [],
          misconceptions: detailed.misconceptions || [],
          examples: detailed.examples || [],
          prerequisites: detailed.prerequisites || [],
          subsequent_concepts: detailed.subsequent_concepts || [],
          pages: idxItem.pages || []
        });
      }
    } catch (err) {
      console.warn(`[Dictionary Item Build Error on ${idxItem.term}]`, err);
      dictionaryList.push({
        book_stem: bookStem,
        book_title: bookTitle,
        chapter_title: chapterTitle,
        term: idxItem.term,
        definition: idxItem.definition || "",
        formula: idxItem.formula || "",
        pages: idxItem.pages || []
      });
    }
  }

  return dictionaryList;
}

// ── 5. NotebookLM 복사 전용 프롬프트 팩 생성기 ──
export function generateNotebookLMPromptPack(
  bookTitle: string,
  chapterTitle: string,
  units?: Array<{ title: string; startPage: number; endPage: number }>
): string {
  if (units && units.length > 0) {
    let result = `=== [NotebookLM 마스터 프롬프트 팩: ${bookTitle} (총 ${units.length}개 단원)] ===\n\n`;
    units.forEach((u, i) => {
      result += `--------------------------------------------------\n`;
      result += `【 단원 ${i + 1}/${units.length}: ${u.title} (p.${u.startPage} ~ p.${u.endPage}) 】\n`;
      result += `--------------------------------------------------\n\n`;
      result += `[1. 플래시카드 추출 프롬프트]\n`;
      result += `이 교재의 [${u.title} (p.${u.startPage}~${u.endPage})]에서 학생이 반드시 외워야 할 핵심 플래시카드를 JSON 배열 형식으로 작성해 줘.\n`;
      result += `[규칙: front, back, hint, pages([${u.startPage}~${u.endPage}] 내 페이지)]\n\n`;
      result += `[2. 4지선다 퀴즈 추출 프롬프트]\n`;
      result += `이 교재의 [${u.title} (p.${u.startPage}~${u.endPage})]에서 개념 이해도를 평가하는 4지선다형 퀴즈 5~10문제를 JSON 배열로 생성해 줘.\n`;
      result += `[규칙: question, options([{id:1~4, text}]), correct_option_id, explanation, socratic_hints([Level 1, 2, 3]), pages]\n\n`;
      result += `[3. 색인 및 수학 딕셔너리 구축 프롬프트]\n`;
      result += `이 교재의 [${u.title} (p.${u.startPage}~${u.endPage})]에 등장하는 모든 핵심 용어 색인과 깊이 있는 딕셔너리 항목을 JSON 배열로 생성해 줘.\n`;
      result += `[규칙: term, english_term, definition($...$ LaTeX), geometric_meaning, theorems, misconceptions, examples, prerequisites, pages]\n\n\n`;
    });
    return result;
  }

  return `=== [NotebookLM 전용 프롬프트 팩: ${bookTitle} - ${chapterTitle}] ===

[1. 플래시카드 추출 프롬프트]
이 교재의 [${chapterTitle}]을 정밀 분석하여 학생이 반드시 숙지해야 할 핵심 플래시카드를 JSON 배열 형식으로 작성해 줘.
[규칙: front(질문), back(정답/공식), hint(가벼운 힌트), pages(출처 페이지 배열)]

[2. 4지선다 퀴즈 추출 프롬프트]
이 교재의 [${chapterTitle}]에서 개념 이해도를 평가하는 4지선다 퀴즈 5~10문제를 JSON 배열로 생성해 줘.
[규칙: question, options([{id, text}]), correct_option_id(1~4), explanation, socratic_hints(3단계 힌트 배열), pages]

[3. 색인 및 수학 딕셔너리 구축 프롬프트]
이 교재의 [${chapterTitle}]에 등장하는 모든 핵심 용어 색인과 딕셔너리를 JSON 배열로 생성해 줘.
[규칙: term, english_term, definition(LaTeX수식포함), geometric_meaning, theorems, misconceptions, examples, prerequisites, pages]
`;
}

