# NotebookLM & 온톨로지 딕셔너리 구축 가이드

본 문서는 `go3math-ontology` 프로젝트의 수학 딕셔너리, 플래시카드, 퀴즈, 색인 구축 시스템에서 **NotebookLM**을 활용하는 0원 워크플로우와 구조를 설명합니다.

---

## 1. `upload-pdf` API의 역할

`POST /api/dictionary/upload-pdf` API는 사용자가 웹 화면에서 선택한 PDF 파일을 **우리 로컬/서버 환경(`mvps/unlimited-ocr/temp_uploads`)에 저장하고, 시스템 내 활성 소스 도서로 등록**하는 역할을 수행합니다.

### ❓ NotebookLM으로 직접 업로드되지 않는 이유
* **Google의 공식 외부 API 부재**: 현재 Google은 NotebookLM에 대한 공식 외부 파일 업로드 및 프롬프트 실행 REST API를 제공하지 않습니다.
* NotebookLM은 Google 계정으로 웹 브라우저([NotebookLM 웹사이트](https://notebooklm.google.com))에 직접 로그인하여 소스 문서를 등록하고 사용하는 구조입니다.

---

## 2. Google Ultra + NotebookLM 0원 워크플로우

Google One AI Premium / Google Ultra 요금제 구독자 혜택을 100% 활용하여 **API 토큰 비용을 전혀 쓰지 않고(0원)** 대용량 도서를 단원별로 정밀 분석하는 방법입니다.

```
[PDF 도서 소스] ──> NotebookLM 웹 소스 업로드
                           │
                           ├──> 0. [TOC 프롬프트 복사] ─────────> NotebookLM 실행 ──> `toc.json` 파일 생성 및 다운로드
                           ├──> 1. [플래시카드 프롬프트 복사] ──> NotebookLM 실행 ──> 결과 복사 ──> [결과 붙여넣기] ──┐
                           ├──> 2. [퀴즈 프롬프트 복사] ────────> NotebookLM 실행 ──> 결과 복사 ──> [결과 붙여넣기] ──┼─> PostgreSQL (kg 스키마)
                           ├──> 3. [색인 프롬프트 복사] ────────> NotebookLM 실행 ──> 결과 복사 ──> [결과 붙여넣기] ──┤
                           └──> 4. [딕셔너리 프롬프트 복사] ────> NotebookLM 실행 ──> 결과 복사 ──> [결과 붙여넣기] ──┘
```

### 📋 상세 진행 순서

1. **소스로 PDF 등록**:
   * [NotebookLM 웹사이트](https://notebooklm.google.com)에 접속하여 분석할 PDF 교재를 소스로 업로드합니다.
2. **단원별 1개씩 프롬프트 복사**:
   * 우리 웹 앱(`/dictionary`) 상단의 **`[NotebookLM 프롬프트 팩]`** 버튼 또는 각 단원 카드의 `[프롬프트 복사]` 버튼을 클릭합니다.
   * 대상 단원을 선택한 후, 원하는 태스크의 프롬프트를 **1개씩 개별 복사**합니다:
     - 📑 **0. TOC 목차 JSON 추출 및 `toc.json` 생성 프롬프트** `[TOC 프롬프트 복사]`
     - 🗂️ **1. 플래시카드 추출 프롬프트** (단원 지정 p.start~p.end) `[이 단원 프롬프트 복사]`
     - 📝 **2. 4지선다 퀴즈 & 소크라테스 힌트 프롬프트** (단원 지정 p.start~p.end) `[이 단원 프롬프트 복사]`
     - 📑 **3. 개념 색인(Index) 추출 프롬프트** (단원 지정 p.start~p.end) `[이 단원 프롬프트 복사]`
     - 📚 **4. 심층 딕셔너리 구축 프롬프트** (단원 지정 p.start~p.end) `[이 단원 프롬프트 복사]`
3. **NotebookLM에서 실행**:
   * NotebookLM 채팅창에 프롬프트를 붙여넣고 전송합니다.
   * NotebookLM이 생성한 JSON 형식의 결과를 복사합니다 (TOC의 경우 `toc.json` 파일 다운로드/저장).
4. **결과 DB 즉시 적재**:
   * 우리 웹 앱에서 **`[결과 붙여넣기]`** 버튼을 클릭합니다.
   * 데이터 유형(수학 딕셔너리 / 플래시카드 / 퀴즈 / 색인)과 소속 단원을 지정하고 JSON을 붙여넣은 뒤 `[DB에 즉시 적재]`를 클릭합니다.
   * PostgreSQL `kg.dictionary`, `kg.flashcards`, `kg.quizzes`, `kg.book_index` 테이블에 즉시 저장됩니다.

---

## 3. 데이터베이스 저장 구조 (`kg` 스키마)

| 테이블명 | 주요 필드 | 설명 |
| :--- | :--- | :--- |
| `kg.dictionary` | `term`, `english_term`, `definition`, `geometric_meaning`, `theorems`, `misconceptions`, `examples`, `prerequisites`, `subsequent_concepts`, `pages`, `chapter_title` | 심층 수학 개념 백과 온톨로지 |
| `kg.flashcards` | `front`, `back`, `hint`, `formula`, `pages`, `chapter_title` | 핵심 암기용 양면 플래시카드 |
| `kg.quizzes` | `question`, `options` (JSONB), `correct_option_id`, `explanation`, `socratic_hints` (JSONB 3단계), `pages`, `chapter_title` | 4지선다 퀴즈 및 소크라테스 유도 힌트 |
| `kg.book_index` | `term`, `category`, `definition`, `formula`, `pages`, `chapter_title` | 교재 내 용어/개념 색인표 |

---

## 4. 단원별 4대 프롬프트 규격 (TOC 기반)

### 0. 📑 TOC 목차 JSON 추출 및 `toc.json` 다운로드 생성 프롬프트
* **목적**: 교재의 목차 페이지를 분석하여 계층 구조 JSON 생성 및 `toc.json` 파일로 저장.
* **규격**:
  ```json
  {
    "bookTitle": "수학(상)",
    "chapters": [
      {
        "chapterId": "I",
        "chapterTitle": "다항식",
        "sections": [
          {
            "sectionId": "01",
            "sectionTitle": "다항식의 연산",
            "page": 10,
            "items": [
              { "name": "다항식의 덧셈과 뺄셈", "page": 10 },
              { "name": "다항식의 곱셈", "page": 14 }
            ]
          }
        ]
      }
    ],
    "commentaryFile": ""
  }
  ```

### 1. 🗂️ 플래시카드 추출 프롬프트 (단원별)
* **목적**: 대상 단원(`unit.title`, `p.start ~ p.end`)의 핵심 개념/공식 암기 카드 추출.
* **필드**: `chapter_title`, `front`, `back`, `hint`, `formula`, `pages`
* **JSON 예시**:
  ```json
  [
    {
      "chapter_title": "지수",
      "front": "지수법칙에서 $a^0$의 값은? (단, $a \\neq 0$)",
      "back": "1",
      "hint": "모든 0이 아닌 수의 0제곱",
      "formula": "$a^0 = 1$",
      "pages": [8]
    }
  ]
  ```

### 2. 📝 4지선다 퀴즈 & 3단계 소크라테스 힌트 프롬프트 (단원별)
* **목적**: 대상 단원(`unit.title`, `p.start ~ p.end`)의 개념 확인용 4지선다 퀴즈 및 3단계 소크라테스 유도 힌트 생성.
* **필드**: `chapter_title`, `question`, `options` (4개), `correct_option_id`, `explanation`, `socratic_hints` (L1 개념 상기 $\rightarrow$ L2 오개념 반문 $\rightarrow$ L3 단계별 유도), `pages`
* **JSON 예시**:
  ```json
  [
    {
      "chapter_title": "지수",
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
        "지수함수 $y=a^x$ ($a>1$)의 그래프 개형과 점근선을 떠올려 보세요.",
        "$x$ 자리에 음수나 0, 양수를 대입할 때 제한 조건이 있는지 확인해 보세요.",
        "$2^x$의 값이 음수가 될 수 있는지 치역과 정의역을 구분해 보세요."
      ],
      "pages": [8]
    }
  ]
  ```

### 3. 📑 개념 색인 (Index) 추출 프롬프트 (단원별)
* **목적**: 대상 단원(`unit.title`, `p.start ~ p.end`)에 등장하는 모든 수학 용어/개념 색인화.
* **필드**: `chapter_title`, `term`, `category` (정의/정리/공식/성질/방법), `definition`, `formula`, `pages`
* **JSON 예시**:
  ```json
  [
    {
      "chapter_title": "지수",
      "term": "지수함수",
      "category": "정의",
      "definition": "실수 $x$에 대하여 $y=a^x$ ($a>0, a \\neq 1$) 꼴로 나타내어지는 함수",
      "formula": "$y = a^x$",
      "pages": [8]
    }
  ]
  ```

### 4. 📚 심층 딕셔너리 (Dictionary) 구축 프롬프트 (단원별)
* **목적**: 대상 단원(`unit.title`, `p.start ~ p.end`)에 등장하는 핵심 수학 개념에 대한 심층 백과 온톨로지 사전 구축.
* **필드**: `chapter_title`, `term`, `english_term`, `definition`, `geometric_meaning`, `theorems`, `misconceptions`, `examples`, `prerequisites`, `subsequent_concepts`, `pages`
* **JSON 예시**:
  ```json
  [
    {
      "chapter_title": "지수",
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
      "pages": [8]
    }
  ]
  ```
