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
  FileCode,
  Eye,
  EyeOff
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
type ConvertLogView = { book_stem: string; status: "submitted" | "completed" | "saved" | "failed"; md_key: string | null; error: string | null };
const MATHPIX_LABEL: Record<ConvertLogView["status"] | "none", string> = {
  none: "PDF → Mathpix",
  failed: "PDF → Mathpix",
  submitted: "제출",
  completed: "MD 전환 완료",
  saved: "저장 완료",
};
type PromptTaskKey = "toc" | "flashcards" | "metaFlashcards" | "quizzes" | "metaQuizzes" | "index" | "metaIndex" | "dictionary" | "metaDictionary";

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

// ── 단원 순번(index) 추출 헬퍼 ──
function getUnitIndex(unit: TocUnitRange): number {
  if (unit.id === "all") return 1;
  if (typeof unit.order === "number" && unit.order >= 0) {
    return unit.order + 1;
  }
  return 1;
}

// ── 단원별 4대 개별 프롬프트 생성 헬퍼 ──
function getFlashcardPrompt(bookTitle: string, unit: TocUnitRange) {
  const index = getUnitIndex(unit);
  return `이 교재(${bookTitle})의 【${unit.title}】 (p.${unit.startPage} ~ p.${unit.endPage}) 단원에서 ${index}-indices.json의 색인을 모두 활용해서 학생이 반드시 암기하고 숙지해야 할 핵심 개념/공식 플래시카드를 JSON 배열 형식으로 추출하고, ${index}-flashcards.json으로 다운로드 받도록 해줘.

[단원 지정 규칙]
- 대상 단원: ${unit.title} (페이지 범위: p.${unit.startPage} ~ p.${unit.endPage})
- 반드시 해당 단원 범위 내의 내용만을 바탕으로 추출할 것.
- 모든 항목의 chapter_title에는 "${unit.title}"을 정확히 기재할 것.
- 추출된 결과는 사용자가 ${index}-flashcards.json 파일로 다운로드받을 수 있도록 순수 JSON 코드 블록으로 작성해 줘.

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
]

반드시 순수 JSON 배열만 코드 블록으로 출력하여 사용자가 ${index}-flashcards.json으로 다운로드 받도록 해줘.`;
}

function getQuizPrompt(bookTitle: string, unit: TocUnitRange) {
  const index = getUnitIndex(unit);

  return `이 교재(${bookTitle})의 【${unit.title}】 (p.${unit.startPage} ~ p.${unit.endPage})에서 ${index}-dictionary.json의 딕셔너리의 내용을 모두 사용하여 개념 이해도를 정밀평가하는 4지 선다형의 퀴즈를 먼저 생성하고 그리고 생성한 4지 선다형을 서술형으로 전환한 퀴즈 2벌을 작성하는데 각 퀴즈에 대하여 3단계 소크라테스식 힌트를 JSON 배열로 생성하고, ${index}-quizzes.json으로 다운로드 받도록 해줘.

[단원 지정 및 문항 구성 규칙]
- 대상 단원: ${unit.title} (페이지 범위: p.${unit.startPage} ~ p.${unit.endPage})
- 반드시 제공하는 단원 딕셔너리의 핵심 개념·정의·공식·오개념을 바탕으로 문제를 구성할 것.
- 모든 항목의 chapter_title에는 "${unit.title}"을 정확히 기재할 것.
- 1벌: 제공하는 딕셔너리를 기준으로 개념 이해도를 정밀 평가하는 4지선다형 퀴즈 
- 2벌: 위 4지선다형 퀴즈를 서술형으로 전환한 퀴즈 (각 4지선다 문항과 1:1 대응되는 서술형 퀴즈)
- 총 2벌의 퀴즈를 하나의 JSON 배열에 순차적으로 작성할 것.
- 각 퀴즈에 대하여 3단계 소크라테스식 힌트(Level 1 개념 상기, Level 2 오개념 반문, Level 3 단계별 유도)를 반드시 포함할 것.
- 생성된 결과는 사용자가 ${index}-quizzes.json 파일로 다운로드받을 수 있도록 순수 JSON 코드 블록으로 작성해 줘.

[필드 규격]
1. 4지선다형 문항 규격:
- chapter_title: "${unit.title}" (단원명)
- quiz_type: "multiple_choice" (4지선다형)
- question: 4지선다 문제 내용 (수식은 LaTeX $...$ 표기)
- options: 4개의 선택지 배열 [{ "id": 1, "text": "선택지 내용" }, ...]
- correct_option_id: 정답 번호 (1~4)
- explanation: 상세한 풀이 및 정답 근거
- socratic_hints: 오답 시 학생의 생각을 순차 유도할 3단계 소크라테스식 질문/힌트 배열
  - Level 1 (개념 상기): 문제 해결에 필요한 딕셔너리 기본 정의/정리 상기 유도
  - Level 2 (오개념 반문): 자주 범하는 실수나 잘못된 가정을 짚는 질문
  - Level 3 (단계별 유도): 정답 도출의 핵심 단계를 밟아가도록 돕는 하위 질문
- pages: 출처 페이지 번호 배열 (p.${unit.startPage}~p.${unit.endPage} 내 정수)

2. 서술형 문항 규격 (4지선다에서 전환):
- chapter_title: "${unit.title}" (단원명)
- quiz_type: "descriptive" (서술형)
- question: 같은 개념을 풀이 과정·근거와 함께 서술하도록 요구하는 질문 (수식은 LaTeX $...$ 표기)
- explanation: 모범 답안 및 상세 채점 기준/풀이 근거
- socratic_hints: 생각을 순차 유도할 3단계 소크라테스식 질문/힌트 배열
- pages: 출처 페이지 번호 배열 (p.${unit.startPage}~p.${unit.endPage} 내 정수)

[출력 JSON 예시]
[
  {
    "chapter_title": "${unit.title}",
    "quiz_type": "multiple_choice",
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
  },
  {
    "chapter_title": "${unit.title}",
    "quiz_type": "descriptive",
    "question": "지수함수 $y=2^x$의 정의역, 치역, 점근선을 각각 구하고 그 이유를 풀이 과정과 함께 서술하시오.",
    "explanation": "모든 실수 $x$에 대해 $2^x$가 정의되므로 정의역은 실수 전체의 집합이다. $2^x>0$이고 모든 양수 값을 가지므로 치역은 양의 실수 전체의 집합이다. $x \\to -\\infty$일 때 $2^x \\to 0$이므로 점근선은 $x$축($y=0$)이다.",
    "socratic_hints": [
      "지수함수 $y=a^x$ ($a>1$)의 그래프 개형과 축과의 관계를 떠올려 보세요.",
      "$x$ 자리에 음수나 0, 양수를 대입할 때 제한 조건이 있는지 확인해 보세요.",
      "$2^x$의 값이 음수가 될 수 있는지 치역과 정의역을 구분해 보세요."
    ],
    "pages": [${unit.startPage}]
  }
]

반드시 순수 JSON 배열만 코드 블록으로 출력하여 사용자가 ${index}-quizzes.json으로 다운로드 받도록 해줘.`;
}

function getIndexPrompt(bookTitle: string, unit: TocUnitRange) {
  const index = getUnitIndex(unit);
  return `이 교재(${bookTitle})의 【${unit.title}】 (p.${unit.startPage} ~ p.${unit.endPage}) 단원에 등장하는 모든 수학 용어, 개념, 정리(Theorem)의 색인(Index)을 JSON 배열로 추출하고, ${index}-indices.json으로 다운로드 받도록 해줘.

[단원 지정 규칙]
- 대상 단원: ${unit.title} (페이지 범위: p.${unit.startPage} ~ p.${unit.endPage})
- 해당 단원 페이지에 등장하는 모든 중요 개념어 및 용어를 누락 없이 색인화할 것.
- 모든 항목의 chapter_title에는 "${unit.title}"을 정확히 기재할 것.
- 추출된 결과는 사용자가 ${index}-indices.json 파일로 다운로드받을 수 있도록 순수 JSON 코드 블록으로 작성해 줘.

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
]

반드시 순수 JSON 배열만 코드 블록으로 출력하여 사용자가 ${index}-indices.json으로 다운로드 받도록 해줘.`;
}

// ── 메타 정보(유래·교육과정·학습법·문제해결 전략 등) 프롬프트 공통 규칙 ──
function getMetaRules(unit: TocUnitRange) {
  return `[단원 지정 규칙]
- 대상 단원: ${unit.title} (페이지 범위: p.${unit.startPage} ~ p.${unit.endPage})
- 본문뿐 아니라 단원 도입글, 학습 목표, 읽기 자료, 수학자 이야기, 쉬어가기/탐구 활동 박스, 교사용 지도 노트, 평가 안내 등 주변 서술까지 빠짐없이 살필 것.
- 모든 항목의 chapter_title에는 "${unit.title}"을 정확히 기재할 것.

[수학 콘텐츠와의 경계 규칙 — 반드시 지킬 것]
- 수학적 정의·정리·공식·성질을 가진 용어(예: 지수함수, 피타고라스 정리, 수학적 귀납법)는 제외할 것. 그런 내용은 별도의 수학 프롬프트로 추출한다.
- 같은 이름이라도 관점이 다르면 메타로 분류한다.
  · "피타고라스 정리"는 제외(수학)하고, "피타고라스(인물)"와 "피타고라스 학파"는 포함(역사·유래)한다.
  · "수학적 귀납법"은 제외(증명법)하고, "귀납적 추론(사고 전략)"은 포함(문제해결 전략)한다.
- 교재에 실제로 서술된 내용만 근거로 삼을 것. 교재에 없는 유래·연도·인물 정보를 외부 지식으로 지어내지 말 것.
- 해당 단원에 메타 정보가 없으면 빈 배열 []을 출력할 것.

[메타 분류 기준]
- category: 다음 7개 중 하나
  · 역사·유래: 수학자, 학파, 개념의 기원, 어원, 기호의 유래
  · 교육과정·정책: 교육과정, 성취기준, 평가·입시 제도, 교육 정책
  · 학습법: 학습 전략, 메타인지, 오답 관리, 복습법, 학습 습관
  · 문제해결 전략: 폴리아 4단계, 거꾸로 풀기, 특수화·일반화, 표 만들기 같은 범용 휴리스틱
  · 교수법: 수업 모형, 표현 방식(구체물→반구체물→추상), 교구, 발문 기법
  · 응용·맥락: 실생활 활용 사례, 타 교과·산업·기술과의 연계
  · 태도·역량: 문제해결, 추론, 의사소통, 연결, 정보처리 같은 교과 역량, 수학적 태도·흥미·자신감
- scope: "범교과" (모든 학습에 통용) 또는 "수학특화" (수학 학습에만 해당)`;
}

function getMetaIndexPrompt(bookTitle: string, unit: TocUnitRange) {
  const index = getUnitIndex(unit);
  return `이 교재(${bookTitle})의 【${unit.title}】 (p.${unit.startPage} ~ p.${unit.endPage}) 단원에서 "수학 개념 그 자체"가 아닌, 수학 학습을 둘러싼 메타 정보(유래·역사, 교육과정·정책, 학습법, 문제해결 전략, 교수법, 실생활·타 교과 맥락, 수학적 태도·역량)에 해당하는 용어의 색인(Index)을 JSON 배열로 추출하고, ${index}-indices.json으로 다운로드 받도록 해줘.

${getMetaRules(unit)}
- 추출된 결과는 사용자가 ${index}-indices.json 파일로 다운로드받을 수 있도록 순수 JSON 코드 블록으로 작성해 줘.

[필드 규격]
- chapter_title: "${unit.title}" (단원명)
- term: 메타 용어명 (인물명, 제도명, 전략명, 교수법명, 어원 등)
- category: 위 [메타 분류 기준]의 7개 중 하나
- scope: "범교과" 또는 "수학특화"
- definition: 교재 서술을 바탕으로 한 1~2문장 설명
- related_math_terms: 이 메타 용어가 연결되는 같은 단원의 수학 용어 배열 (KG 말단 노드 연결용, 없으면 [])
- evidence: 근거가 되는 교재 문장 일부 (30자 이내 요약 또는 발췌)
- pages: 실제 등장한 페이지 번호 배열 (p.${unit.startPage}~p.${unit.endPage} 내 정수)

[출력 JSON 예시]
[
  {
    "chapter_title": "${unit.title}",
    "term": "네이피어(John Napier)",
    "category": "역사·유래",
    "scope": "수학특화",
    "definition": "천문학 계산의 곱셈을 덧셈으로 바꾸기 위해 로그를 고안한 17세기 스코틀랜드의 수학자",
    "related_math_terms": ["로그", "상용로그"],
    "evidence": "복잡한 천문 계산을 간단히 하기 위해 로그를 발명",
    "pages": [${unit.startPage}]
  },
  {
    "chapter_title": "${unit.title}",
    "term": "거꾸로 풀기",
    "category": "문제해결 전략",
    "scope": "범교과",
    "definition": "구하려는 결과에서 출발해 조건 쪽으로 역방향으로 추론하는 문제해결 전략",
    "related_math_terms": ["지수방정식"],
    "evidence": "결론에서 거슬러 올라가 조건을 찾아보자",
    "pages": [${unit.startPage}]
  }
]

반드시 순수 JSON 배열만 코드 블록으로 출력하여 사용자가 ${index}-indices.json으로 다운로드 받도록 해줘.`;
}

function getMetaFlashcardPrompt(bookTitle: string, unit: TocUnitRange) {
  const index = getUnitIndex(unit);
  return `이 교재(${bookTitle})의 【${unit.title}】 (p.${unit.startPage} ~ p.${unit.endPage}) 단원에서 ${index}-indices.json의 색인을 모두 사용하여 "수학 개념 그 자체"가 아닌 메타 정보(유래·역사, 교육과정·정책, 학습법, 문제해결 전략, 교수법, 실생활·타 교과 맥락, 수학적 태도·역량)를 학생이 기억하고 활용할 수 있도록 플래시카드를 JSON 배열 형식으로 추출하고, ${index}-flashcards.json으로 다운로드 받도록 해줘.

${getMetaRules(unit)}
- 추출된 결과는 사용자가 ${index}-flashcards.json 파일로 다운로드받을 수 있도록 순수 JSON 코드 블록으로 작성해 줘.

[필드 규격]
- chapter_title: "${unit.title}" (단원명)
- category: 위 [메타 분류 기준]의 7개 중 하나
- scope: "범교과" 또는 "수학특화"
- front: 핵심 질문 (예: 인물·유래 묻기, 전략의 이름이나 적용 상황 묻기, 빈칸 채우기)
- back: 교재 서술에 근거한 명쾌한 답 (1~2문장)
- hint: 기억을 돕는 가벼운 힌트 (1줄)
- related_math_terms: 연결되는 같은 단원의 수학 용어 배열 (없으면 [])
- pages: 출처 페이지 번호 배열 (p.${unit.startPage}~p.${unit.endPage} 내 정수)

[출력 JSON 예시]
[
  {
    "chapter_title": "${unit.title}",
    "category": "역사·유래",
    "scope": "수학특화",
    "front": "로그를 처음 고안한 수학자와 그 목적은?",
    "back": "네이피어(John Napier). 천문학 계산의 복잡한 곱셈을 덧셈으로 바꿔 간단히 하기 위해 고안했다.",
    "hint": "곱셈 → 덧셈",
    "related_math_terms": ["로그"],
    "pages": [${unit.startPage}]
  },
  {
    "chapter_title": "${unit.title}",
    "category": "문제해결 전략",
    "scope": "범교과",
    "front": "구하려는 결과에서 출발해 조건 쪽으로 거슬러 추론하는 전략의 이름은?",
    "back": "거꾸로 풀기. 결론이 분명하고 조건이 여러 단계로 얽힌 문제에 효과적이다.",
    "hint": "결론 → 조건",
    "related_math_terms": [],
    "pages": [${unit.startPage}]
  }
]

반드시 순수 JSON 배열만 코드 블록으로 출력하여 사용자가 ${index}-flashcards.json으로 다운로드 받도록 해줘.`;
}

function getMetaQuizPrompt(bookTitle: string, unit: TocUnitRange) {
  const index = getUnitIndex(unit);

  return `이 교재(${bookTitle})의 【${unit.title}】 (p.${unit.startPage} ~ p.${unit.endPage}) 단원의 ${index}-dictionary.json의 내용을 모두 사용하여 메타 정보(유래·역사, 교육과정·정책, 학습법, 문제해결 전략, 교수법, 실생활·타 교과 맥락, 수학적 태도·역량)에 대해 개념 이해도를 정밀평가하는 4지 선다형의 퀴즈를 먼저 생성하고 그리고 생성한 4지 선다형을 서술형으로 전환한 퀴즈 2벌을 작성하는데 각 퀴즈에 대하여 3단계 소크라테스식 힌트를 JSON 배열로 생성하고, ${index}-quizzes.json으로 다운로드 받도록 해줘.

${getMetaRules(unit)}
- 생성된 결과는 사용자가 ${index}-quizzes.json 파일로 다운로드받을 수 있도록 순수 JSON 코드 블록으로 작성해 줘.

[문항 구성 규칙]
- 단순 암기(인물·연도)보다 "이 상황에 어떤 전략/학습법이 적절한가", "이 개념이 왜 등장했는가"처럼 이해와 적용을 묻는 문항을 우선할 것.
- 1벌: 제공하는 딕셔너리 기준 메타 4지선다형 퀴즈
- 2벌: 위 4지선다형 퀴즈를 메타 서술형(이유·맥락·전략 서술)으로 전환한 퀴즈
- 총 2벌의 퀴즈를 하나의 JSON 배열에 순차적으로 담을 것.

[필드 규격]
1. 4지선다형 문항 규격:
- chapter_title: "${unit.title}" (단원명)
- quiz_type: "multiple_choice" (4지선다형)
- category: 위 [메타 분류 기준]의 7개 중 하나
- scope: "범교과" 또는 "수학특화"
- question: 4지선다 문제 내용
- options: 4개의 선택지 배열 [{ "id": 1, "text": "선택지 내용" }, ...]
- correct_option_id: 정답 번호 (1~4)
- explanation: 정답 근거 및 오답 선택지가 틀린 이유
- socratic_hints: 오답 시 생각을 순차 유도할 3단계 소크라테스식 질문/힌트 배열
  - Level 1 (맥락 상기): 관련 유래·전략·학습법의 핵심을 떠올리게 하는 질문
  - Level 2 (오해 반문): 자주 혼동하는 전략·인물·제도를 짚는 질문
  - Level 3 (단계별 유도): 정답을 고르는 핵심 판단 기준으로 이끄는 하위 질문
- related_math_terms: 연결되는 같은 단원의 수학 용어 배열 (없으면 [])
- pages: 출처 페이지 번호 배열 (p.${unit.startPage}~p.${unit.endPage} 내 정수)

2. 서술형 문항 규격 (4지선다에서 전환):
- chapter_title: "${unit.title}" (단원명)
- quiz_type: "descriptive" (서술형)
- category: 위 [메타 분류 기준]의 7개 중 하나
- scope: "범교과" 또는 "수학특화"
- question: 같은 맥락을 근거와 함께 서술하도록 요구하는 질문
- explanation: 교재 서술에 근거한 모범 답안 및 해설 (2~4문장)
- socratic_hints: 생각을 순차 유도할 3단계 소크라테스식 질문/힌트 배열
- related_math_terms: 연결되는 같은 단원의 수학 용어 배열 (없으면 [])
- pages: 출처 페이지 번호 배열 (p.${unit.startPage}~p.${unit.endPage} 내 정수)

[출력 JSON 예시]
[
  {
    "chapter_title": "${unit.title}",
    "quiz_type": "multiple_choice",
    "category": "역사·유래",
    "scope": "수학특화",
    "question": "네이피어가 로그를 고안한 주된 목적으로 옳은 것은?",
    "options": [
      { "id": 1, "text": "함수의 그래프를 그리기 위해" },
      { "id": 2, "text": "천문학의 복잡한 곱셈 계산을 덧셈으로 바꾸기 위해" },
      { "id": 3, "text": "무리수의 존재를 증명하기 위해" },
      { "id": 4, "text": "확률을 계산하기 위해" }
    ],
    "correct_option_id": 2,
    "explanation": "로그는 큰 수의 곱셈을 지수의 덧셈으로 바꾸어 천문 계산을 간단히 하려고 고안되었습니다. 나머지 선택지는 로그의 발명 동기와 관련이 없습니다.",
    "socratic_hints": [
      "17세기 과학자들이 가장 많이 시간을 들인 계산은 어떤 종류였을까요?",
      "로그의 성질 $\\log_a xy = \\log_a x + \\log_a y$는 어떤 연산을 어떤 연산으로 바꾸나요?",
      "곱셈을 덧셈으로 바꾸면 손계산이 어떻게 달라지는지 생각해 보세요."
    ],
    "related_math_terms": ["로그"],
    "pages": [${unit.startPage}]
  },
  {
    "chapter_title": "${unit.title}",
    "quiz_type": "descriptive",
    "category": "역사·유래",
    "scope": "수학특화",
    "question": "네이피어가 로그를 고안한 배경을 설명하고, 로그의 어떤 성질이 그 목적을 달성하게 했는지 서술하시오.",
    "explanation": "17세기 천문학에서는 큰 수의 복잡한 곱셈 계산이 매우 많았습니다. 네이피어는 곱셈을 덧셈으로 바꾸는 로그의 성질($\\log_a xy = \\log_a x + \\log_a y$)을 이용하여 천문 계산을 대폭 단순화하기 위해 로그를 고안했습니다.",
    "socratic_hints": [
      "17세기 과학자들이 가장 많이 시간을 들인 계산은 어떤 종류였을까요?",
      "로그의 성질 $\\log_a xy = \\log_a x + \\log_a y$는 어떤 연산을 어떤 연산으로 바꾸나요?",
      "곱셈을 덧셈으로 바꾸면 손계산이 어떻게 달라지는지 생각해 보세요."
    ],
    "related_math_terms": ["로그"],
    "pages": [${unit.startPage}]
  }
]

반드시 순수 JSON 배열만 코드 블록으로 출력하여 사용자가 ${index}-quizzes.json으로 다운로드 받도록 해줘.`;
}

function getMetaDictionaryPrompt(bookTitle: string, unit: TocUnitRange) {
  const index = getUnitIndex(unit);
  return `이 교재(${bookTitle})의 【${unit.title}】 (p.${unit.startPage} ~ p.${unit.endPage}) 단원에서 ${index}-indices.json의 색인을 모두 사용하여 이 단원에 등장하는 메타 정보(유래·역사, 교육과정·정책, 학습법, 문제해결 전략, 교수법, 실생활·타 교과 맥락, 수학적 태도·역량)에 대해 깊이 있는 메타 딕셔너리 항목들을 JSON 배열로 작성하고, ${index}-dictionary.json으로 다운로드 받도록 해줘.

${getMetaRules(unit)}
- 작성된 결과는 사용자가 ${index}-dictionary.json 파일로 다운로드받을 수 있도록 순수 JSON 코드 블록으로 작성해 줘.

[필드 규격]
- chapter_title: "${unit.title}" (단원명)
- term: 한글 용어명 (인물명, 제도명, 전략명, 교수법명, 어원 등)
- english_term: 영문 용어명 (없으면 빈 문자열)
- category: 위 [메타 분류 기준]의 7개 중 하나
- scope: "범교과" 또는 "수학특화"
- definition: 교재 서술을 바탕으로 한 명확한 정의/설명
- background: 유래, 등장 배경, 역사적·교육적 맥락
- educational_significance: 이 메타 정보가 학습자에게 갖는 의미 (왜 알아야 하는가)
- application: 학습자/교사가 실제로 활용하는 방법 (절차나 단계가 있으면 순서대로)
- misconceptions: 자주 혼동하거나 잘못 이해하는 점 배열 (문자열 배열, 없으면 [])
- examples: 교재 속 적용 사례 배열 [{ "situation": "적용 상황", "description": "어떻게 적용되는지" }]
- related_math_terms: 연결되는 같은 단원의 수학 용어 배열 (KG 말단 노드 연결용, 없으면 [])
- related_meta_terms: 함께 알아두면 좋은 다른 메타 용어 배열 (없으면 [])
- evidence: 근거가 되는 교재 문장 일부 (30자 이내 요약 또는 발췌)
- pages: 관련 페이지 번호 배열 (p.${unit.startPage}~p.${unit.endPage} 내 정수)

[출력 JSON 예시]
[
  {
    "chapter_title": "${unit.title}",
    "term": "거꾸로 풀기",
    "english_term": "working backwards",
    "category": "문제해결 전략",
    "scope": "범교과",
    "definition": "구하려는 결과나 결론에서 출발하여 그것이 성립하기 위한 조건을 역방향으로 찾아가는 문제해결 전략",
    "background": "폴리아(G. Pólya)가 『어떻게 문제를 풀 것인가』에서 정리한 대표적인 발견술(heuristic) 중 하나로 소개된다.",
    "educational_significance": "조건이 여러 단계로 얽힌 문제에서 출발점을 찾지 못할 때 사고의 방향을 전환하는 도구가 된다.",
    "application": "1) 구하려는 값을 먼저 쓴다. 2) 그 값을 얻기 직전 단계에 필요한 조건을 쓴다. 3) 주어진 조건에 닿을 때까지 반복한다. 4) 순방향으로 다시 검산한다.",
    "misconceptions": ["답을 미리 가정하고 대입하는 것과 같다고 오해하는 경우"],
    "examples": [
      { "situation": "지수방정식에서 최종 값이 주어진 경우", "description": "결과 식에서 출발해 밑을 같게 만드는 단계를 거슬러 올라가 미지수 조건을 찾는다." }
    ],
    "related_math_terms": ["지수방정식"],
    "related_meta_terms": ["폴리아의 문제해결 4단계", "특수화와 일반화"],
    "evidence": "결론에서 거슬러 올라가 조건을 찾아보자",
    "pages": [${unit.startPage}]
  }
]

반드시 순수 JSON 배열만 코드 블록으로 출력하여 사용자가 ${index}-dictionary.json으로 다운로드 받도록 해줘.`;
}

function getDictionaryPrompt(bookTitle: string, unit: TocUnitRange) {
  const index = getUnitIndex(unit);
  return `이 교재(${bookTitle})의 【${unit.title}】 (p.${unit.startPage} ~ p.${unit.endPage}) 단원에 등장하는 핵심 수학 개념들에 대해 ${index}-indices.json의 색인을 모두 사용하여 깊이 있는 딕셔너리 백과 온톨로지 항목들을 JSON 배열로 작성하고, ${index}-dictionary.json으로 다운로드 받도록 해줘.

[단원 지정 규칙]
- 대상 단원: ${unit.title} (페이지 범위: p.${unit.startPage} ~ p.${unit.endPage})
- 해당 단원 내 핵심 개념들을 중심으로 정의부터 기하학적 의미, 오개념, 예제까지 포괄적으로 작성할 것.
- 모든 항목의 chapter_title에는 "${unit.title}"을 정확히 기재할 것.
- 작성된 결과는 사용자가 ${index}-dictionary.json 파일로 다운로드받을 수 있도록 순수 JSON 코드 블록으로 작성해 줘.

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
]

반드시 순수 JSON 배열만 코드 블록으로 출력하여 사용자가 ${index}-dictionary.json으로 다운로드 받도록 해줘.`;
}

export default function DictionaryPage() {
  // ── 도서 선택 상태 ──
  const [book, setBook] = useState<SelectedBook | null>(null);
  const [convertLog, setConvertLog] = useState<ConvertLogView | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  // ── TOC 기반 단원 목록 및 선택 ──
  const [selectedUnitId, setSelectedUnitId] = useState<string>("all");
  const [showTocPanel, setShowTocPanel] = useState<boolean>(true);

  // ── 활성 탭 및 필터 ──
  const [activeTab, setActiveTab] = useState<"dictionary" | "flashcards" | "quizzes" | "index">("index");
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
  const [revealedQuizAnswers, setRevealedQuizAnswers] = useState<Record<number, boolean>>({});

  // ── NotebookLM 개별 프롬프트 모달 상태 ──
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [promptTargetUnitId, setPromptTargetUnitId] = useState<string>("");
  const [promptOnlyTask, setPromptOnlyTask] = useState<PromptTaskKey | null>(null); // 탭의 '프롬프트 열기'는 그 탭 프롬프트만
  const [copiedPromptKey, setCopiedPromptKey] = useState<PromptTaskKey | null>(null);
  const [promptViewMode, setPromptViewMode] = useState<Record<string, "standard" | "meta">>({});

  // ── NotebookLM 결과 직접 붙여넣기 모달 ──
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteDataType, setPasteDataType] = useState<"dictionary" | "flashcards" | "quizzes" | "index">("dictionary");
  const [pasteTargetUnitTitle, setPasteTargetUnitTitle] = useState<string>("");
  const [pastedJsonText, setPastedJsonText] = useState("");

  // ── 토스트 ──
  const [toast, setToast] = useState<Toast>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jsonFileInputRef = useRef<HTMLInputElement | null>(null);
  const [isImportingJson, setIsImportingJson] = useState(false);

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

  // ── PDF → Mathpix 전환 (document_convert_log) ──
  // 제출 상태면 Mathpix 처리 상태를 서버가 조회해 갱신한다
  const loadConvertLog = useCallback(async (stem: string) => {
    try {
      const res = await fetch(`/api/dictionary/mathpix?bookStem=${encodeURIComponent(stem)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConvertLog(data.log);
    } catch (err) {
      pushToast(`Mathpix 조회 실패: ${(err as Error).message}`, "error");
    }
  }, [pushToast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConvertLog(null);
    if (book?.stem) loadConvertLog(book.stem);
  }, [book?.stem, loadConvertLog]);

  // 제출 상태 동안 5초마다 Mathpix 처리 상태 조회
  useEffect(() => {
    if (convertLog?.status !== "submitted") return;
    const t = setInterval(() => loadConvertLog(convertLog.book_stem), 5000);
    return () => clearInterval(t);
  }, [convertLog?.status, convertLog?.book_stem, loadConvertLog]);

  const handleMathpixClick = async () => {
    if (!book) return pushToast("도서를 먼저 선택하세요.", "error");
    const status = convertLog?.status;
    if (status === "submitted") return loadConvertLog(book.stem);
    const isSave = status === "completed" || status === "saved";
    setIsConverting(true);
    try {
      const res = await fetch("/api/dictionary/mathpix", {
        method: isSave ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookStem: book.stem, bookTitle: book.title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConvertLog(data.log);
      pushToast(isSave ? `MD 저장 완료: ${data.log.md_key}` : "Mathpix 에 제출했습니다.", "success");
    } catch (err) {
      pushToast(`Mathpix 처리 실패: ${(err as Error).message}`, "error");
    } finally {
      setIsConverting(false);
    }
  };

  // ── NotebookLM 프롬프트 모달 열기 ──
  const openPromptModalForUnit = (unitId?: string, onlyTask?: PromptTaskKey) => {
    setPromptOnlyTask(onlyTask ?? null);
    const targetId = unitId || (selectedUnitId !== "all" ? selectedUnitId : tocUnits[0]?.id || "all");
    setPromptTargetUnitId(targetId);
    setCopiedPromptKey(null);
    setPromptViewMode({});
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

  // ── 현재 탭별 액션 라벨 및 스타일 설정 ──
  const tabActionConfig = useMemo(() => {
    switch (activeTab) {
      case "dictionary":
        return {
          label: "딕셔너리 추가",
          cleanName: "수학 딕셔너리",
          colorClass: "bg-orange-600/30 hover:bg-orange-600/50 border-orange-500/40 text-orange-200 shadow-orange-600/10",
        };
      case "flashcards":
        return {
          label: "플래시카드 추가",
          cleanName: "플래시카드",
          colorClass: "bg-purple-600/30 hover:bg-purple-600/50 border-purple-500/40 text-purple-200 shadow-purple-600/10",
        };
      case "quizzes":
        return {
          label: "퀴즈 추가",
          cleanName: "퀴즈",
          colorClass: "bg-emerald-600/30 hover:bg-emerald-600/50 border-emerald-500/40 text-emerald-200 shadow-emerald-600/10",
        };
      case "index":
        return {
          label: "색인 추가",
          cleanName: "개념 색인",
          colorClass: "bg-blue-600/30 hover:bg-blue-600/50 border-blue-500/40 text-blue-200 shadow-blue-600/10",
        };
    }
  }, [activeTab]);

  // ── NotebookLM 생성 JSON 파일 선택 및 DB 적재 핸들러 ──
  const handleJsonFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // input 값 초기화(동일 파일 재선택 가능)
    e.target.value = "";

    setIsImportingJson(true);
    pushToast(`'${file.name}' 파일을 읽고 분석 중입니다...`, "info");

    try {
      let rawText = await file.text();
      rawText = rawText.replace(/^\uFEFF/, "").trim();

      if (!rawText) {
        throw new Error("선택한 파일이 비어 있습니다.");
      }

      let parsed: any;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        // 마크다운 코드 블록(```json ... ```) 또는 텍스트 내 JSON 추출
        const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (codeBlockMatch) {
          parsed = JSON.parse(codeBlockMatch[1].trim());
        } else {
          const arrayMatch = rawText.match(/\[\s*\{[\s\S]*\}\s*\]/);
          if (arrayMatch) {
            parsed = JSON.parse(arrayMatch[0]);
          } else {
            const objMatch = rawText.match(/\{\s*"[\s\S]*"\s*:[\s\S]*\}/);
            if (objMatch) {
              parsed = JSON.parse(objMatch[0]);
            } else {
              throw new Error("올바른 JSON 데이터 또는 JSON 코드 블록을 찾을 수 없습니다.");
            }
          }
        }
      }

      // 래핑 객체 지원 ({ dictionary: [...] }, { items: [...] } 등)
      let items: any[] = [];
      if (Array.isArray(parsed)) {
        items = parsed;
      } else if (typeof parsed === "object" && parsed !== null) {
        if (activeTab === "dictionary" && Array.isArray(parsed.dictionary)) items = parsed.dictionary;
        else if (activeTab === "flashcards" && Array.isArray(parsed.flashcards)) items = parsed.flashcards;
        else if (activeTab === "quizzes" && Array.isArray(parsed.quizzes)) items = parsed.quizzes;
        else if (activeTab === "index" && (Array.isArray(parsed.index) || Array.isArray(parsed.bookIndex))) {
          items = parsed.index || parsed.bookIndex;
        } else if (Array.isArray(parsed.items)) {
          items = parsed.items;
        } else if (Array.isArray(parsed.data)) {
          items = parsed.data;
        } else {
          items = [parsed];
        }
      }

      if (items.length === 0) {
        throw new Error("파일 내에 유효한 데이터 항목이 없습니다.");
      }

      const currentStem = book?.stem || "imported_book";
      const currentTitle = book?.title || "교재";
      const fallbackChapter = (() => {
        if (selectedChapterFilter && selectedChapterFilter !== "all") return selectedChapterFilter;
        const u = tocUnits.find(unit => unit.id === selectedUnitId);
        if (u) return u.title;
        return "";
      })();

      const payload: {
        dictionary?: DictionaryItem[];
        flashcards?: FlashcardItem[];
        quizzes?: QuizItem[];
        bookIndex?: BookIndexItem[];
      } = {};

      if (activeTab === "dictionary") {
        payload.dictionary = items.map((it: any) => ({
          book_stem: currentStem,
          book_title: currentTitle,
          chapter_title: String(it.chapter_title || it.chapterTitle || fallbackChapter || ""),
          term: String(it.term || it.name || ""),
          english_term: String(it.english_term || it.englishTerm || ""),
          definition: String(it.definition || it.desc || it.description || ""),
          formula: String(it.formula || ""),
          geometric_meaning: String(it.geometric_meaning || it.geometricMeaning || ""),
          theorems: Array.isArray(it.theorems)
            ? it.theorems.map((th: any) =>
              typeof th === "string"
                ? { name: "정리", description: th }
                : { name: String(th.name || ""), description: String(th.description || "") }
            )
            : [],
          misconceptions: Array.isArray(it.misconceptions) ? it.misconceptions.map(String) : [],
          examples: Array.isArray(it.examples)
            ? it.examples.map((ex: any) =>
              typeof ex === "string"
                ? { problem: ex, solution: "" }
                : { problem: String(ex.problem || ""), solution: String(ex.solution || "") }
            )
            : [],
          prerequisites: Array.isArray(it.prerequisites) ? it.prerequisites.map(String) : [],
          subsequent_concepts: Array.isArray(it.subsequent_concepts || it.subsequentConcepts)
            ? (it.subsequent_concepts || it.subsequentConcepts).map(String)
            : [],
          pages: Array.isArray(it.pages)
            ? it.pages.map(Number).filter((n: number) => !isNaN(n))
            : (it.pages ? [Number(it.pages)].filter((n: number) => !isNaN(n)) : (it.page ? [Number(it.page)].filter((n: number) => !isNaN(n)) : []))
        })).filter((item: any) => item.term && item.definition);

        if (payload.dictionary.length === 0) {
          throw new Error("유효한 딕셔너리 항목(term, definition 필수)이 없습니다.");
        }
      } else if (activeTab === "flashcards") {
        payload.flashcards = items.map((it: any) => ({
          book_stem: currentStem,
          book_title: currentTitle,
          chapter_title: String(it.chapter_title || it.chapterTitle || fallbackChapter || ""),
          front: String(it.front || it.question || it.term || ""),
          back: String(it.back || it.answer || it.definition || ""),
          hint: String(it.hint || ""),
          formula: String(it.formula || ""),
          pages: Array.isArray(it.pages)
            ? it.pages.map(Number).filter((n: number) => !isNaN(n))
            : (it.pages ? [Number(it.pages)].filter((n: number) => !isNaN(n)) : (it.page ? [Number(it.page)].filter((n: number) => !isNaN(n)) : []))
        })).filter((item: any) => item.front && item.back);

        if (payload.flashcards.length === 0) {
          throw new Error("유효한 플래시카드 항목(front, back 필수)이 없습니다.");
        }
      } else if (activeTab === "quizzes") {
        payload.quizzes = items.flatMap((it: any) => {
          let options: Array<{ id: number; text: string }> = [];
          if (Array.isArray(it.options) && it.options.length > 0) {
            options = it.options.map((opt: any, idx: number) =>
              typeof opt === "string"
                ? { id: idx + 1, text: opt }
                : { id: Number(opt.id || idx + 1), text: String(opt.text || "") }
            );
          }

          let correctId = 0;
          if (typeof it.correct_option_id !== "undefined" || typeof it.correctOptionId !== "undefined") {
            const rawId = it.correct_option_id ?? it.correctOptionId;
            if (typeof rawId === "number") correctId = rawId;
            else if (typeof rawId === "string") {
              const upper = rawId.trim().toUpperCase();
              if (upper === "A" || upper === "1") correctId = 1;
              else if (upper === "B" || upper === "2") correctId = 2;
              else if (upper === "C" || upper === "3") correctId = 3;
              else if (upper === "D" || upper === "4") correctId = 4;
              else {
                const parsedNum = parseInt(rawId, 10);
                if (!isNaN(parsedNum)) correctId = parsedNum;
              }
            }
          }

          const primaryQuiz: QuizItem = {
            book_stem: currentStem,
            book_title: currentTitle,
            chapter_title: String(it.chapter_title || it.chapterTitle || fallbackChapter || ""),
            quiz_type: it.quiz_type ? String(it.quiz_type) : (options.length > 0 ? "multiple_choice" : "descriptive"),
            question: String(it.question || it["퀴즈"] || ""),
            options,
            correct_option_id: correctId,
            explanation: String(it.explanation || it["답안"] || it.answer_and_explanation || ""),
            socratic_hints: Array.isArray(it.socratic_hints || it.socraticHints)
              ? (it.socratic_hints || it.socraticHints).map(String)
              : [],
            pages: Array.isArray(it.pages)
              ? it.pages.map(Number).filter((n: number) => !isNaN(n))
              : (it.pages ? [Number(it.pages)].filter((n: number) => !isNaN(n)) : (it.page ? [Number(it.page)].filter((n: number) => !isNaN(n)) : []))
          };

          const list: QuizItem[] = [];
          if (primaryQuiz.question) {
            list.push(primaryQuiz);
          }

          if (it.descriptive_quiz && typeof it.descriptive_quiz === "object") {
            const dq = it.descriptive_quiz;
            const descQ = String(dq.question || "");
            if (descQ && descQ !== primaryQuiz.question) {
              list.push({
                book_stem: currentStem,
                book_title: currentTitle,
                chapter_title: primaryQuiz.chapter_title,
                quiz_type: "descriptive",
                question: descQ,
                options: [],
                correct_option_id: 0,
                explanation: String(dq.model_answer || dq.explanation || ""),
                socratic_hints: Array.isArray(dq.socratic_hints)
                  ? dq.socratic_hints.map(String)
                  : primaryQuiz.socratic_hints,
                pages: primaryQuiz.pages
              });
            }
          }

          return list;
        }).filter((item: any) => item.question);

        if (payload.quizzes.length === 0) {
          throw new Error("유효한 퀴즈 항목(question 필수)이 없습니다.");
        }
      } else if (activeTab === "index") {
        payload.bookIndex = items.map((it: any) => ({
          book_stem: currentStem,
          book_title: currentTitle,
          chapter_title: String(it.chapter_title || it.chapterTitle || fallbackChapter || ""),
          term: String(it.term || it.name || ""),
          category: String(it.category || "개념"),
          definition: String(it.definition || it.desc || it.description || ""),
          formula: String(it.formula || ""),
          pages: Array.isArray(it.pages)
            ? it.pages.map(Number).filter((n: number) => !isNaN(n))
            : (it.pages ? [Number(it.pages)].filter((n: number) => !isNaN(n)) : (it.page ? [Number(it.page)].filter((n: number) => !isNaN(n)) : []))
        })).filter((item: any) => item.term);

        if (payload.bookIndex.length === 0) {
          throw new Error("유효한 색인 항목(term 필수)이 없습니다.");
        }
      }

      const res = await fetch("/api/dictionary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "DB 저장 실패");

      const savedCount =
        activeTab === "dictionary" ? payload.dictionary?.length :
          activeTab === "flashcards" ? payload.flashcards?.length :
            activeTab === "quizzes" ? payload.quizzes?.length :
              payload.bookIndex?.length;

      pushToast(`Knowledge Graph DB에 ${savedCount}개 ${tabActionConfig.cleanName} 항목이 성공적으로 저장되었습니다!`, "success");
      await loadData(currentStem);
    } catch (err: unknown) {
      const error = err as Error;
      pushToast(`파일 적재 오류: ${error.message}`, "error");
    } finally {
      setIsImportingJson(false);
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
          {/* NotebookLM JSON 파일 적재용 숨김 input */}
          <input
            type="file"
            ref={jsonFileInputRef}
            onChange={handleJsonFileImport}
            accept=".json,application/json"
            className="hidden"
          />
          {/* PDF → Mathpix 버튼: PDF → Mathpix → 제출 → MD 전환 완료 → 저장 완료 */}
          <button
            onClick={handleMathpixClick}
            disabled={!book || isConverting}
            className="px-3 py-1.5 text-xs font-bold rounded-xl bg-orange-600 hover:bg-orange-700 text-white transition-all shadow-md shadow-orange-600/20 flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title={convertLog?.status === "failed" ? `전환 실패: ${convertLog.error ?? ""} (클릭하여 다시 제출)` : convertLog?.md_key ? convertLog.md_key : "선택된 도서 PDF 를 Mathpix 로 MD 전환"}
          >
            {isConverting || convertLog?.status === "submitted" ? <RotateCw className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            <span>{MATHPIX_LABEL[convertLog?.status ?? "none"]}</span>
          </button>

          {/* 현재 선택된 도서 뱃지 */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs font-mono text-gray-300">
            <BookOpen className="w-3.5 h-3.5 text-orange-400" />
            <span className="text-gray-400 font-sans font-semibold text-[10px]">도서:</span>
            <span className="text-orange-300 font-bold truncate max-w-[200px]">
              {book?.title || "선택된 도서 없음"}
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
              setPasteDataType(activeTab);
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
                className={`text-[10px] px-2.5 py-0.5 rounded-lg border transition-all cursor-pointer ${selectedChapterFilter === "all"
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
                  className={`rounded-xl border p-2.5 flex flex-col justify-between gap-2 transition-all ${isSelectedForFilter
                    ? "bg-emerald-950/40 border-emerald-500/50 shadow-md shadow-emerald-500/10"
                    : "bg-black/30 border-white/10 hover:border-white/20"
                    }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono ${unit.level === "chapter" ? "bg-amber-500/20 text-amber-300" : "bg-teal-500/20 text-teal-300"
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
              onClick={() => setActiveTab("index")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === "index"
                ? "bg-blue-600 text-white shadow-md shadow-blue-600/20"
                : "text-gray-400 hover:text-white"
                }`}
            >
              <Hash className="w-3.5 h-3.5" />
              <span>개념 색인 ({filteredIndex.length})</span>
            </button>
            <button
              onClick={() => setActiveTab("dictionary")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === "dictionary"
                ? "bg-orange-600 text-white shadow-md shadow-orange-600/20"
                : "text-gray-400 hover:text-white"
                }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>수학 딕셔너리 ({filteredDict.length})</span>
            </button>
            <button
              onClick={() => setActiveTab("flashcards")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === "flashcards"
                ? "bg-purple-600 text-white shadow-md shadow-purple-600/20"
                : "text-gray-400 hover:text-white"
                }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>플래시카드 ({filteredFlashcards.length})</span>
            </button>
            <button
              onClick={() => setActiveTab("quizzes")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === "quizzes"
                ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                : "text-gray-400 hover:text-white"
                }`}
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>퀴즈 은행 ({filteredQuizzes.length})</span>
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

            <div className="h-4 w-[1px] bg-white/10 mx-1"></div>

            {/* 탭별 추가 버튼 (프롬프트 열기 버튼 왼쪽) */}
            <button
              type="button"
              onClick={() => jsonFileInputRef.current?.click()}
              disabled={isImportingJson}
              className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${tabActionConfig.colorClass}`}
              title={`NotebookLM에서 생성한 ${tabActionConfig.cleanName} JSON 파일을 선택하여 Knowledge Graph DB에 저장`}
            >
              {isImportingJson ? (
                <RotateCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <UploadCloud className="w-3.5 h-3.5" />
              )}
              <span>{tabActionConfig.label}</span>
            </button>

            {/* 프롬프트 열기 버튼 */}
            <button
              type="button"
              onClick={() => openPromptModalForUnit(undefined, activeTab)}
              className="px-3 py-1.5 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md shadow-indigo-600/10"
              title="NotebookLM 프롬프트 개별 복사 창 열기"
            >
              <Copy className="w-3.5 h-3.5 text-amber-300" />
              <span>프롬프트 열기</span>
            </button>
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
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => jsonFileInputRef.current?.click()}
                    disabled={isImportingJson}
                    className="px-4 py-2 rounded-xl bg-orange-600/30 hover:bg-orange-600/50 border border-orange-500/40 text-orange-200 font-bold transition-all cursor-pointer shadow-lg flex items-center gap-1.5"
                  >
                    {isImportingJson ? <RotateCw className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                    <span>딕셔너리 추가</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openPromptModalForUnit(undefined, activeTab)}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition-all cursor-pointer shadow-lg shadow-indigo-600/20 flex items-center gap-1.5"
                  >
                    <Copy className="w-4 h-4 text-amber-300" />
                    <span>프롬프트 열기</span>
                  </button>
                </div>
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
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => jsonFileInputRef.current?.click()}
                    disabled={isImportingJson}
                    className="px-4 py-2 rounded-xl bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/40 text-purple-200 font-bold transition-all cursor-pointer shadow-lg flex items-center gap-1.5"
                  >
                    {isImportingJson ? <RotateCw className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                    <span>플래시카드 추가</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openPromptModalForUnit(undefined, activeTab)}
                    className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold transition-all cursor-pointer shadow-lg shadow-purple-600/20 flex items-center gap-1.5"
                  >
                    <Copy className="w-4 h-4 text-amber-300" />
                    <span>프롬프트 열기</span>
                  </button>
                </div>
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
                      className={`min-h-[220px] rounded-2xl border p-5 flex flex-col justify-between cursor-pointer transition-all duration-300 select-none shadow-xl ${isFlipped
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
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => jsonFileInputRef.current?.click()}
                    disabled={isImportingJson}
                    className="px-4 py-2 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/40 text-emerald-200 font-bold transition-all cursor-pointer shadow-lg flex items-center gap-1.5"
                  >
                    {isImportingJson ? <RotateCw className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                    <span>퀴즈 추가</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openPromptModalForUnit(undefined, activeTab)}
                    className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold transition-all cursor-pointer shadow-lg shadow-teal-600/20 flex items-center gap-1.5"
                  >
                    <Copy className="w-4 h-4 text-amber-300" />
                    <span>프롬프트 열기</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 max-w-3xl mx-auto">
                {filteredQuizzes.map((quiz, qIdx) => {
                  const hasOptions = Array.isArray(quiz.options) && quiz.options.length > 0;
                  const selectedOpt = quizAnswers[qIdx];
                  const isSubmitted = selectedOpt !== undefined;
                  const isCorrect = isSubmitted && selectedOpt === quiz.correct_option_id;
                  const isRevealed = Boolean(revealedQuizAnswers[qIdx]);
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
                          <span className="text-xs text-gray-400 font-medium">
                            {hasOptions ? "4지선다 개념 확인" : "서술형 개념 퀴즈"}
                          </span>
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

                      {/* 4개 보기 버튼 (옵션이 있는 경우에만 표시) */}
                      {hasOptions && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {quiz.options!.map(opt => {
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
                      )}

                      {/* 옵션이 없는 서술형 퀴즈: 모범 답안 및 해설 확인 토글 버튼 */}
                      {!hasOptions && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setRevealedQuizAnswers(prev => ({ ...prev, [qIdx]: !prev[qIdx] }))}
                            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${isRevealed
                              ? "bg-emerald-600/30 border-emerald-500/50 text-emerald-200 shadow-md shadow-emerald-600/20"
                              : "bg-white/5 hover:bg-white/10 border-white/10 text-gray-300"
                              }`}
                          >
                            {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            <span>{isRevealed ? "모범 답안 및 해설 숨기기" : "모범 답안 및 해설 확인"}</span>
                          </button>
                        </div>
                      )}

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

                      {/* 정답 및 해설 (4지선다는 제출 시, 서술형은 확인 버튼 클릭 시) */}
                      {(hasOptions ? isSubmitted : isRevealed) && (
                        <div className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${hasOptions
                          ? (isCorrect ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200" : "bg-red-500/10 border-red-500/30 text-red-200")
                          : "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                          }`}>
                          <div className="font-bold flex items-center gap-1.5">
                            {hasOptions ? (
                              isCorrect ? <Check className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-red-400" />
                            ) : (
                              <Check className="w-4 h-4 text-emerald-400" />
                            )}
                            <span>
                              {hasOptions
                                ? (isCorrect ? "정답입니다!" : `오답입니다 (정답: ${quiz.correct_option_id}번)`)
                                : "모범 답안 및 해설"}
                            </span>
                          </div>
                          <p className="text-gray-300 text-[11px] leading-relaxed pt-1 whitespace-pre-wrap">
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
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => jsonFileInputRef.current?.click()}
                    disabled={isImportingJson}
                    className="px-4 py-2 rounded-xl bg-blue-600/30 hover:bg-blue-600/50 border border-blue-500/40 text-blue-200 font-bold transition-all cursor-pointer shadow-lg flex items-center gap-1.5"
                  >
                    {isImportingJson ? <RotateCw className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                    <span>색인 추가</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openPromptModalForUnit(undefined, activeTab)}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-all cursor-pointer shadow-lg shadow-blue-600/20 flex items-center gap-1.5"
                  >
                    <Copy className="w-4 h-4 text-amber-300" />
                    <span>프롬프트 열기</span>
                  </button>
                </div>
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          onMouseDown={e => { if (e.target === e.currentTarget) setShowPromptModal(false); }}
        >
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
                if (promptOnlyTask) return null;
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
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${isCopied
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
                if (promptOnlyTask && promptOnlyTask !== "flashcards") return null;
                const promptText = getFlashcardPrompt(currentBookTitle, activePromptUnit);
                const metaPromptText = getMetaFlashcardPrompt(currentBookTitle, activePromptUnit);
                const isCopied = copiedPromptKey === "flashcards";
                const isMetaCopied = copiedPromptKey === "metaFlashcards";
                const isMetaActive = promptViewMode["flashcards"] === "meta";
                const currentPromptText = isMetaActive ? metaPromptText : promptText;
                const unitIndex = getUnitIndex(activePromptUnit);

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
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setPromptViewMode(prev => ({ ...prev, flashcards: "meta" }));
                            copySinglePrompt(metaPromptText, "metaFlashcards", `메타 플래시카드 (${activePromptUnit.title})`);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${isMetaCopied
                            ? "bg-emerald-600 text-white shadow-emerald-600/20"
                            : isMetaActive
                              ? "bg-indigo-600 text-white ring-2 ring-indigo-400 shadow-indigo-600/30"
                              : "bg-indigo-600/70 hover:bg-indigo-600 text-white shadow-indigo-600/20"
                            }`}
                          title="이 단원 메타 플래시카드 추출 프롬프트 표시 및 복사"
                        >
                          {isMetaCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{isMetaCopied ? "복사 완료!" : "이단원에서 메타플래시카드추출 프롬프트 복사"}</span>
                        </button>
                        <button
                          onClick={() => {
                            setPromptViewMode(prev => ({ ...prev, flashcards: "standard" }));
                            copySinglePrompt(promptText, "flashcards", `플래시카드 (${activePromptUnit.title})`);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${isCopied
                            ? "bg-emerald-600 text-white shadow-emerald-600/20"
                            : !isMetaActive
                              ? "bg-purple-600 text-white ring-2 ring-purple-400 shadow-purple-600/30"
                              : "bg-purple-600/70 hover:bg-purple-500 text-white shadow-purple-600/20"
                            }`}
                          title="이 단원 플래시카드 기본 프롬프트 표시 및 복사"
                        >
                          {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{isCopied ? "복사 완료!" : "이단원프롬프트복사"}</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] bg-white/[0.03] px-2.5 py-1 rounded-lg border border-white/5">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 font-semibold text-[10px]">프롬프트 영역:</span>
                        <div className="flex items-center gap-1 bg-black/60 p-0.5 rounded border border-white/10">
                          <button
                            type="button"
                            onClick={() => setPromptViewMode(prev => ({ ...prev, flashcards: "standard" }))}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${!isMetaActive ? "bg-purple-600 text-white shadow-sm" : "text-gray-400 hover:text-gray-200"
                              }`}
                          >
                            이단원프롬프트
                          </button>
                          <button
                            type="button"
                            onClick={() => setPromptViewMode(prev => ({ ...prev, flashcards: "meta" }))}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${isMetaActive ? "bg-indigo-600 text-white shadow-sm" : "text-gray-400 hover:text-gray-200"
                              }`}
                          >
                            메타 프롬프트
                          </button>
                        </div>
                      </div>
                      <span className="text-[10px] text-purple-300/80 font-mono">
                        다운로드 파일: {unitIndex}-flashcards.json
                      </span>
                    </div>

                    <textarea
                      readOnly
                      value={currentPromptText}
                      className={`w-full h-28 bg-black/60 border rounded-lg p-2.5 font-mono text-[11px] focus:outline-none select-all transition-colors ${isMetaActive
                        ? "border-indigo-500/40 text-indigo-200"
                        : "border-white/10 text-purple-200"
                        }`}
                    />
                  </div>
                );
              })()}

              {/* 2. 퀴즈 & 소크라테스 힌트 프롬프트 */}
              {(() => {
                if (promptOnlyTask && promptOnlyTask !== "quizzes") return null;
                const promptText = getQuizPrompt(currentBookTitle, activePromptUnit);
                const metaPromptText = getMetaQuizPrompt(currentBookTitle, activePromptUnit);
                const isCopied = copiedPromptKey === "quizzes";
                const isMetaCopied = copiedPromptKey === "metaQuizzes";
                const isMetaActive = promptViewMode["quizzes"] === "meta";
                const currentPromptText = isMetaActive ? metaPromptText : promptText;
                const unitIndex = getUnitIndex(activePromptUnit);

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
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setPromptViewMode(prev => ({ ...prev, quizzes: "meta" }));
                            copySinglePrompt(metaPromptText, "metaQuizzes", `메타 퀴즈 (${activePromptUnit.title})`);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${isMetaCopied
                            ? "bg-emerald-600 text-white shadow-emerald-600/20"
                            : isMetaActive
                              ? "bg-indigo-600 text-white ring-2 ring-indigo-400 shadow-indigo-600/30"
                              : "bg-indigo-600/70 hover:bg-indigo-500 text-white shadow-indigo-600/20"
                            }`}
                          title="이 단원 메타 퀴즈 추출 프롬프트 표시 및 복사"
                        >
                          {isMetaCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{isMetaCopied ? "복사 완료!" : "이 단원메타퀴즈 추출 프롬프트 복사"}</span>
                        </button>
                        <button
                          onClick={() => {
                            setPromptViewMode(prev => ({ ...prev, quizzes: "standard" }));
                            copySinglePrompt(promptText, "quizzes", `퀴즈 (${activePromptUnit.title})`);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${isCopied
                            ? "bg-emerald-600 text-white shadow-emerald-600/20"
                            : !isMetaActive
                              ? "bg-teal-600 text-white ring-2 ring-teal-400 shadow-teal-600/30"
                              : "bg-teal-600/70 hover:bg-teal-500 text-white shadow-teal-600/20"
                            }`}
                          title="이 단원 퀴즈 기본 프롬프트 표시 및 복사"
                        >
                          {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{isCopied ? "복사 완료!" : "이단원프롬프트복사"}</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] bg-white/[0.03] px-2.5 py-1 rounded-lg border border-white/5">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 font-semibold text-[10px]">프롬프트 영역:</span>
                        <div className="flex items-center gap-1 bg-black/60 p-0.5 rounded border border-white/10">
                          <button
                            type="button"
                            onClick={() => setPromptViewMode(prev => ({ ...prev, quizzes: "standard" }))}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${!isMetaActive ? "bg-teal-600 text-white shadow-sm" : "text-gray-400 hover:text-gray-200"
                              }`}
                          >
                            이단원프롬프트
                          </button>
                          <button
                            type="button"
                            onClick={() => setPromptViewMode(prev => ({ ...prev, quizzes: "meta" }))}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${isMetaActive ? "bg-indigo-600 text-white shadow-sm" : "text-gray-400 hover:text-gray-200"
                              }`}
                          >
                            메타 프롬프트
                          </button>
                        </div>
                      </div>
                      <span className="text-[10px] text-teal-300/80 font-mono">
                        다운로드 파일: {unitIndex}-quizzes.json
                      </span>
                    </div>

                    <textarea
                      readOnly
                      value={currentPromptText}
                      className={`w-full h-28 bg-black/60 border rounded-lg p-2.5 font-mono text-[11px] focus:outline-none select-all transition-colors ${isMetaActive
                        ? "border-indigo-500/40 text-indigo-200"
                        : "border-white/10 text-teal-200"
                        }`}
                    />
                  </div>
                );
              })()}

              {/* 3. 개념 색인(Index) 프롬프트 */}
              {(() => {
                if (promptOnlyTask && promptOnlyTask !== "index") return null;
                const promptText = getIndexPrompt(currentBookTitle, activePromptUnit);
                const metaPromptText = getMetaIndexPrompt(currentBookTitle, activePromptUnit);
                const isCopied = copiedPromptKey === "index";
                const isMetaCopied = copiedPromptKey === "metaIndex";
                const isMetaActive = promptViewMode["index"] === "meta";
                const currentPromptText = isMetaActive ? metaPromptText : promptText;
                const unitIndex = getUnitIndex(activePromptUnit);

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
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setPromptViewMode(prev => ({ ...prev, index: "meta" }));
                            copySinglePrompt(metaPromptText, "metaIndex", `Meta 정보 색인 (${activePromptUnit.title})`);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${isMetaCopied
                            ? "bg-emerald-600 text-white shadow-emerald-600/20"
                            : isMetaActive
                              ? "bg-indigo-600 text-white ring-2 ring-indigo-400 shadow-indigo-600/30"
                              : "bg-indigo-600/70 hover:bg-indigo-500 text-white shadow-indigo-600/20"
                            }`}
                          title="meta 정보 색인 프롬프트 표시 및 복사"
                        >
                          {isMetaCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{isMetaCopied ? "복사 완료!" : "meta 정보 색인"}</span>
                        </button>
                        <button
                          onClick={() => {
                            setPromptViewMode(prev => ({ ...prev, index: "standard" }));
                            copySinglePrompt(promptText, "index", `개념 색인 (${activePromptUnit.title})`);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${isCopied
                            ? "bg-emerald-600 text-white shadow-emerald-600/20"
                            : !isMetaActive
                              ? "bg-blue-600 text-white ring-2 ring-blue-400 shadow-blue-600/30"
                              : "bg-blue-600/70 hover:bg-blue-500 text-white shadow-blue-600/20"
                            }`}
                          title="이 단원 개념 색인 기본 프롬프트 표시 및 복사"
                        >
                          {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{isCopied ? "복사 완료!" : "이 단원 프롬프트 복사"}</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] bg-white/[0.03] px-2.5 py-1 rounded-lg border border-white/5">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 font-semibold text-[10px]">프롬프트 영역:</span>
                        <div className="flex items-center gap-1 bg-black/60 p-0.5 rounded border border-white/10">
                          <button
                            type="button"
                            onClick={() => setPromptViewMode(prev => ({ ...prev, index: "standard" }))}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${!isMetaActive ? "bg-blue-600 text-white shadow-sm" : "text-gray-400 hover:text-gray-200"
                              }`}
                          >
                            이단원프롬프트
                          </button>
                          <button
                            type="button"
                            onClick={() => setPromptViewMode(prev => ({ ...prev, index: "meta" }))}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${isMetaActive ? "bg-indigo-600 text-white shadow-sm" : "text-gray-400 hover:text-gray-200"
                              }`}
                          >
                            메타 프롬프트
                          </button>
                        </div>
                      </div>
                      <span className="text-[10px] text-blue-300/80 font-mono">
                        다운로드 파일: {unitIndex}-indices.json
                      </span>
                    </div>

                    <textarea
                      readOnly
                      value={currentPromptText}
                      className={`w-full h-28 bg-black/60 border rounded-lg p-2.5 font-mono text-[11px] focus:outline-none select-all transition-colors ${isMetaActive
                        ? "border-indigo-500/40 text-indigo-200"
                        : "border-white/10 text-blue-200"
                        }`}
                    />
                  </div>
                );
              })()}

              {/* 4. 심층 딕셔너리 구축 프롬프트 */}
              {(() => {
                if (promptOnlyTask && promptOnlyTask !== "dictionary") return null;
                const promptText = getDictionaryPrompt(currentBookTitle, activePromptUnit);
                const metaPromptText = getMetaDictionaryPrompt(currentBookTitle, activePromptUnit);
                const isCopied = copiedPromptKey === "dictionary";
                const isMetaCopied = copiedPromptKey === "metaDictionary";
                const isMetaActive = promptViewMode["dictionary"] === "meta";
                const currentPromptText = isMetaActive ? metaPromptText : promptText;
                const unitIndex = getUnitIndex(activePromptUnit);

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
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setPromptViewMode(prev => ({ ...prev, dictionary: "meta" }));
                            copySinglePrompt(metaPromptText, "metaDictionary", `메타 딕셔너리 (${activePromptUnit.title})`);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${isMetaCopied
                            ? "bg-emerald-600 text-white shadow-emerald-600/20"
                            : isMetaActive
                              ? "bg-indigo-600 text-white ring-2 ring-indigo-400 shadow-indigo-600/30"
                              : "bg-indigo-600/70 hover:bg-indigo-500 text-white shadow-indigo-600/20"
                            }`}
                          title="이 단원 meta 딕셔너리 추출 프롬프트 표시 및 복사"
                        >
                          {isMetaCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{isMetaCopied ? "복사 완료!" : "이 단원 meta 딕셔너리 추출"}</span>
                        </button>
                        <button
                          onClick={() => {
                            setPromptViewMode(prev => ({ ...prev, dictionary: "standard" }));
                            copySinglePrompt(promptText, "dictionary", `심층 딕셔너리 (${activePromptUnit.title})`);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${isCopied
                            ? "bg-emerald-600 text-white shadow-emerald-600/20"
                            : !isMetaActive
                              ? "bg-orange-600 text-white ring-2 ring-orange-400 shadow-orange-600/30"
                              : "bg-orange-600/70 hover:bg-orange-500 text-white shadow-orange-600/20"
                            }`}
                          title="이 단원 딕셔너리 기본 프롬프트 표시 및 복사"
                        >
                          {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{isCopied ? "복사 완료!" : "이 단원 프롬프트 복사"}</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] bg-white/[0.03] px-2.5 py-1 rounded-lg border border-white/5">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 font-semibold text-[10px]">프롬프트 영역:</span>
                        <div className="flex items-center gap-1 bg-black/60 p-0.5 rounded border border-white/10">
                          <button
                            type="button"
                            onClick={() => setPromptViewMode(prev => ({ ...prev, dictionary: "standard" }))}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${!isMetaActive ? "bg-orange-600 text-white shadow-sm" : "text-gray-400 hover:text-gray-200"
                              }`}
                          >
                            이단원프롬프트
                          </button>
                          <button
                            type="button"
                            onClick={() => setPromptViewMode(prev => ({ ...prev, dictionary: "meta" }))}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${isMetaActive ? "bg-indigo-600 text-white shadow-sm" : "text-gray-400 hover:text-gray-200"
                              }`}
                          >
                            메타 프롬프트
                          </button>
                        </div>
                      </div>
                      <span className="text-[10px] text-orange-300/80 font-mono">
                        다운로드 파일: {unitIndex}-dictionary.json
                      </span>
                    </div>

                    <textarea
                      readOnly
                      value={currentPromptText}
                      className={`w-full h-28 bg-black/60 border rounded-lg p-2.5 font-mono text-[11px] focus:outline-none select-all transition-colors ${isMetaActive
                        ? "border-indigo-500/40 text-indigo-200"
                        : "border-white/10 text-orange-200"
                        }`}
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
          className={`fixed bottom-6 right-6 px-4 py-2.5 rounded-xl text-xs font-bold shadow-2xl z-50 flex items-center gap-2 ${toast.type === "error"
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
