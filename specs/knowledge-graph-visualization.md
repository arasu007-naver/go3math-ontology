# Knowledge Graph DB 시각화 페이지 구현 스펙 (`knowledge-graph-visualization.md`)

- 버전: v1.0 (2026-11-08)
- 대상 실행자: 코딩 에이전트 (Claude / Antigravity)
- 상위·연관 스펙: `go3math-ontology-26-10-05.md`, `level-spec.md`, `DESIGN.md`, `specs/math_concepts2ontology.md`

---

## 0. 요약

`go3math-ontology` 프로젝트의 PostgreSQL Knowledge Graph DB(`kg` 스키마 전체)를 **Cytoscape.js**로 탐색·분석·검수하는 통합 시각화 페이지(`/graph`)를 구현한다.

기존 `/network` 페이지(`NetworkView.tsx`)는 `kg.nodes (type='level')`의 `HAS_CHILD`·`PREREQUISITE_OF`만 고정 격자 트리로 보여 주었다. 본 스펙에서 정의하는 `/graph` 페이지는 다음 **4개 지식 계층**을 단일 인터랙티브 캔버스와 다중 레이아웃 모드로 통합 시각화한다.

1. **교육과정·단원 계층 (`kg.nodes` — `type='level'`)**: Level 1(7대 영역) ~ Level 5(과목·대단원·소단원) 및 Level 4~9(등록된 교재 TOC 노드)
2. **수학 개념 계층 (`kg.math_concepts`, `kg.concept_unit_edges`, `kg.concept_prerequisites`, `kg.concept_achievements`)**: Legacy(`mathdb.math_concepts`)에서 이관·병합된 수학 개념 노드와 단원 매핑(주/부 단원, 신뢰도, 판정 모델), 개념 간 선수 관계, 성취기준
3. **도서·콘텐츠 계층 (`kg.nodes` — `book`, `toc`, `page`, `paragraph` 및 `kg.toc_unit_links`)**: 교재, 목차 트리, 페이지 이미지, 문단(정의·공식·성질·문제·해답) 및 문제↔해답 연결(`ANSWERS`)
4. **학습 사전·콘텐츠 계층 (`kg.dictionary`, `kg.flashcards`, `kg.quizzes`, `kg.book_index`)**: 도서·단원별 용어 사전, 플래시카드, 퀴즈 메타데이터 연계 조회

---

## 1. 목표 및 비목표

### 1.1 목표
1. **다중 차트/레이아웃 모드 지원**: 탐색 목적에 따라 **계층형 트리(Hierarchy Tree)**, **역학 네트워크(Force-Directed)**, **선수 학습 경로(Prerequisite DAG)**, **방사형 포커스(Concentric Ego-Network)** 4가지 뷰 모드를 즉시 전환한다.
2. **점진적 확장(Progressive Disclosure)**: 초기 로딩 시 `Level 1~3` 골격과 집계 배지(개념 수, TOC 수, 하위 단원 수)만 렌더링하여 Hairball(털뭉치) 현상을 방지하고, 노드 더블클릭 또는 우클릭/패널 액션으로 연결된 하위 단원·개념·교재·문단을 1-hop씩 동적 로드(Lazy Expand)한다.
3. **시각적 인코딩 표준화**: 노드 종류(`level`, `concept`, `book`, `toc`, `page`, `paragraph`)와 엣지 종류(`HAS_CHILD`, `PREREQUISITE_OF`, `CONCEPT_IN_UNIT`, `CONCEPT_PREREQ_OF`, `APPLIES_TO`, `DESCRIBES`, `MAPS_TO`, `ANSWERS`)를 모양·크기·색상·선 스타일·투명도로 명확히 구분한다.
4. **경로 추적 및 서브그래프 필터링**: 특정 단원이나 개념을 선택했을 때 **선수 학습 체인(Upstream Ancestors)**과 **후속 학습 체인(Downstream Descendants)**을 하이라이트하고 나머지 노드를 Dimming 처리한다.
5. **우측 인스펙터(Inspector) 및 수식 렌더링**: 선택된 노드/엣지의 상세 속성, KaTeX/MathJax 수식 본문(`MathView`), 연결된 `l2o` 투표/검수 이력, 교재 페이지 미리보기, 사전/퀴즈 탭을 한 화면에서 제공한다.

### 1.2 비목표
- 이 페이지에서 원본 MariaDB(`mathdb`)에 직접 접근하지 않는다(오직 PostgreSQL `kg`·`l2o` 스키마만 조회).
- 고정 노드(`Level 1·2`, `L3-STUDY-*`) 수정이나 DB 제약 조건을 우회하는 쓰기 기능은 넣지 않는다.
- 전체 문단(`paragraph`) 수만 건을 한 번에 캔버스에 띄우지 않는다(항상 선택된 단원/페이지 단위로 상한선을 두어 확장).

---

## 2. 데이터 소스 및 그래프 매핑 명세
ㄴ
PostgreSQL `kg` 스키마의 테이블들을 Cytoscape 엘리먼트(`NodeDefinition`, `EdgeDefinition`)로 변환하는 규칙이다.

### 2.1 노드(Node) 타입 매핑

| 분류 | 그래프 `nodeType` | 그래프 ID 규칙 | 원본 테이블 / 조건 | 표시 라벨 (`label`) | 주요 `data` 속성 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **영역/단원** | `level` | `L1-...` ~ `L5-...` (원본 `id`) | `kg.nodes` (`type='level'`, `category <> 'TOC'`) | `props.name` (+ 중등은 `· 중{grade}`) | `level` (1~5), `category` (`과목`/`대단원`/`소단원`), `kind`, `areaId` (소속 L1), `conceptCount`, `tocCount`, `childCount` |
| **단원 TOC** | `level_toc` | `L4-T...` ~ `L9-T...` (원본 `id`) | `kg.nodes` (`type='level'`, `category='TOC'`) + `kg.toc_unit_links` | `props.name` | `level` (4~9), `bookStem`, `bookTitle`, `tocPage`, `page`, `pageKind`, `rootUnitId` |
| **수학 개념** | `concept` | `concept:{id}` | `kg.math_concepts` (`source_id > 0`) | `title` | `conceptId` (`id`), `sourceId` (`source_id`), `mergedCount` (`cardinality(merged_source_ids)`), `conceptType`, `mathField`, `schoolType`, `difficultyLevel`, `areaId` |
| **성취기준** | `achievement` | `ach:{code}` | `kg.concept_achievements` | `achievement_code` | `code`, `conceptCount` |
| **도서** | `book` | `book:{stem}` | `kg.nodes` (`type='book'`) | `props.title` | `stem`, `documentId`, `tocCount` |
| **도서 TOC** | `toc` | `toc:{stem}:{key}` | `kg.nodes` (`type='toc'`) | `props.label` | `key`, `tocLevel`, `page`, `bookStem` |
| **페이지** | `page` | `page:{stem}:{kind}:{page}` | `kg.nodes` (`type='page'`) | `{page}p ({kind})` | `page`, `kind` (`main`/`commentary`), `imageUrl`, `paragraphCount` |
| **문단** | `paragraph` | `para:{stem}:{kind}:{page}:{idx}` | `kg.nodes` (`type='paragraph'`) | `{kind} #{idx+1}` | `kind` (`정의`/`공식`/`성질`/`문제`/`해답`), `category`, `snippet` (앞 80자) |

### 2.2 엣지(Edge) 타입 매핑

| 그래프 `edgeType` | ID 규칙 | 시작(`source`) → 끝(`target`) | 원본 테이블 / 조건 | 의미 |
| :--- | :--- | :--- | :--- | :--- |
| `HAS_CHILD` | `HAS_CHILD\|{src}\|{dst}` | `level` → `level` / `level_toc` | `kg.edges` (`type='HAS_CHILD'`) | 단원 및 TOC 상하 계층 |
| `BELONGS_TO_AREA` | `BELONGS_TO_AREA\|{src}\|{dst}` | `level`(L3·L4) → `level`(L1) | `kg.edges` (`type='BELONGS_TO_AREA'`) | 복수 영역 소속 (보조 소속선) |
| `PREREQUISITE_OF` | `PREREQUISITE_OF\|{src}\|{dst}` | `level` → `level` | `kg.edges` (`type='PREREQUISITE_OF'`) | 과목·대단원·소단원 간 선수 학습 관계 |
| `APPLIES_TO` | `APPLIES_TO\|{src}\|{dst}` | `level`(`L1-STUDY` 하위) → `level`(수학) | `kg.edges` (`type='APPLIES_TO'`) | 문제 해결 전략·학습법이 적용되는 수학 단원 |
| `DESCRIBES` | `DESCRIBES\|{src}\|{dst}` | `level`(`L3-STUDY-CURR` 하위) → `level`(`과목`) | `kg.edges` (`type='DESCRIBES'`) | 교육과정 설명 연결 |
| `CONCEPT_IN_UNIT` | `CONCEPT_UNIT\|{conceptId}\|{unitId}` | `concept:{id}` → `level`(`unit_id`) | `kg.concept_unit_edges` (`is_active = true`) | 개념→단원 매핑 (`isPrimary`, `confidence`, `judgedBy`, `rationale`) |
| `CONCEPT_PREREQ_OF` | `CONCEPT_PREREQ\|{src}\|{dst}` | `concept:{src}` → `concept:{dst}` | `kg.concept_prerequisites` | 개념 간 선수 학습 관계 |
| `HAS_ACHIEVEMENT` | `ACH\|{conceptId}\|{code}` | `concept:{id}` → `ach:{code}` | `kg.concept_achievements` | 개념→성취기준 연결 |
| `MAPS_TO` | `MAPS_TO\|{src}\|{dst}` | `toc` / `paragraph` → `level` | `kg.edges` (`type='MAPS_TO'`) | 교재 목차·문단 ↔ 교육과정 단원 대응 |
| `HAS_TOC` | `HAS_TOC\|{src}\|{dst}` | `book` → `toc` | `kg.edges` (`type='HAS_TOC'`) | 도서 → 최상위 목차 |
| `POINTS_TO` | `POINTS_TO\|{src}\|{dst}` | `toc` → `page` | `kg.edges` (`type='POINTS_TO'`) | 목차 → 페이지 |
| `HAS_PARAGRAPH` | `HAS_PARAGRAPH\|{src}\|{dst}` | `page` → `paragraph` | `kg.edges` (`type='HAS_PARAGRAPH'`) | 페이지 → 문단 |
| `ANSWERS` | `ANSWERS\|{src}\|{dst}` | `paragraph`(해답) → `paragraph`(문제) | `kg.edges` (`type='ANSWERS'`) | 해답 문단 → 문제 문단 |

---

## 3. Cytoscape.js 차트(레이아웃) 모드 및 시각적 인코딩

### 3.1 4대 레이아웃(차트) 모드

상단 툴바의 **뷰 모드 스위처(View Mode Switcher)**로 다음 4가지 차트 모드를 전환한다.

1. **`tree` — 계층형 분류 트리 (Hierarchy Tree View, 기본값)**
   - **목적**: Level 1(7대 영역)부터 Level 5(소단원), 등록된 TOC, 매핑된 개념까지의 전체 분류 체계(Taxonomy) 파악.
   - **알고리즘**: 커스텀 좌→우(`LR`) 트리 배치 함수(`treePositions` 확장판). 열(`x` 좌표)은 `level * 260px`로 정렬하고, `concept` 노드는 소속 `unit_id`의 우측 열(`(unit.level) * 260 + 180px`)에 클러스터 배치한다.
   - **표시 엣지**: `HAS_CHILD`는 수평 직교선(`curve-style: taxi`, `taxi-direction: horizontal`), `PREREQUISITE_OF`·`APPLIES_TO`는 반투명 곡선(`unbundled-bezier`, 기본 `opacity: 0.25`, 노드 선택 시 `1.0`).

2. **`force` — 역학 기반 네트워크 (Force-Directed Network View)**
   - **목적**: 단원 간 교차 연결, 복수 단원에 걸친 개념(`is_primary=false` 부단원 연결 포함), 문제 해결 전략(`APPLIES_TO`), 도서-단원 매핑 클러스터 탐색.
   - **알고리즘**: Cytoscape 내장 `cose` 레이아웃 (또는 `fcose` 설치 시 `fcose`, 기본 내장 `cose`로 외부 의존성 없이 즉시 동작 보장).
   - **옵션**:
     ```ts
     {
       name: "cose",
       animate: true,
       animationDuration: 450,
       nodeRepulsion: () => 8000,
       idealEdgeLength: (edge) => (edge.data("edgeType") === "HAS_CHILD" ? 80 : 140),
       edgeElasticity: () => 100,
       gravity: 0.25,
       numIter: 1000,
       padding: 40,
     }
     ```

3. **`prereq` — 선수 학습 경로 DAG (Prerequisite Flow View)**
   - **목적**: `HAS_CHILD`(단순 포함 관계)를 숨기거나 최소화하고, 오직 **선수 관계(`PREREQUISITE_OF`, `CONCEPT_PREREQ_OF`)**만 방향성 비순환 그래프(DAG)로 시각화하여 학습 선후 관계를 검증.
   - **알고리즘**: 위상 정렬(Topological Rank) 기반 좌→우 계층 배치 (`dagre` 알고리즘과 동일한 Longest-path Layering 내장 구현: 진입 차수 0인 기초 단원/개념을 좌측 `rank 0`에 두고 `rank * 220px`로 배치).
   - **특징**: 고립 노드(선수·후속 간선이 없는 노드) 숨김 토글(`선수 관계 있는 노드만 보기`, 기본 ON) 제공.

4. **`ego` — 방사형 포커스 네트워크 (Concentric Ego-Network View)**
   - **목적**: 선택한 중심 노드(단원, 개념, 또는 도서)를 화면 정중앙에 두고 1-hop, 2-hop 이웃 노드를 동심원(`concentric`)으로 배치하여 국소 관계망 집중 분석.
   - **알고리즘**: Cytoscape 내장 `concentric` 레이아웃.
   - **옵션**:
     ```ts
     {
       name: "concentric",
       fit: true,
       padding: 50,
       minNodeSpacing: 36,
       concentric: (node) => (node.id() === focusNodeId ? 3 : node.data("hop") === 1 ? 2 : 1),
       levelWidth: () => 1,
     }
     ```

---

### 3.2 색상 팔레트 및 노드/엣지 스타일 (`DESIGN.md` 준수)

#### 영역(Level 1) 고정 컬러 토큰
하위 단원(`L2~L9`)과 매핑된 수학 개념(`concept`)은 주 소속 영역(`L1`)의 색상을 상속한다.

| 코드 | 영역명 | Hex 컬러 | 보조 배지 배경 |
| :--- | :--- | :--- | :--- |
| `L1-STUDY` | 수학 학습 | `#9ca3af` (Gray-400) | `rgba(156, 163, 175, 0.15)` |
| `L1-NUM` | 수와 연산 | `#3987e5` (Blue) | `rgba(57, 135, 229, 0.15)` |
| `L1-EXPR` | 식과 계산 | `#d95926` (Orange-Red) | `rgba(217, 89, 38, 0.15)` |
| `L1-EQ` | 방정식과 부등식 | `#199e70` (Emerald) | `rgba(25, 158, 112, 0.15)` |
| `L1-FUNC` | 함수 | `#c98500` (Amber) | `rgba(201, 133, 0, 0.15)` |
| `L1-PROB` | 경우의 수·확률·통계 | `#d55181` (Pink-Rose) | `rgba(213, 81, 129, 0.15)` |
| `L1-GEO` | 도형 | `#008300` (Green) | `rgba(0, 131, 0, 0.15)` |

#### 노드(Node) 시각적 인코딩 규칙

| 선택자 (`selector`) | 모양 (`shape`) | 크기 (`width` × `height`) | 색상 / 테두리 | 라벨 표시 규칙 |
| :--- | :--- | :--- | :--- | :--- |
| `node[nodeType = "level"][level = 1]` | `round-rectangle` | `140px × 28px` | 영역 색상 채움, 글자 `#ffffff` 12px Bold | 정중앙 표시 |
| `node[nodeType = "level"][level = 2]` | `round-rectangle` | `110px × 20px` | 영역 색상 (`background-opacity: 0.55`), 글자 10px | `PREREQUISITE` 중앙 표시 |
| `node[category = "과목"]` | `ellipse` | `20px × 20px` | 영역 색상, 흰색 테두리 `2px` | 우측 12px Bold, 매핑 수 배지 |
| `node[category = "대단원"]` | `ellipse` | `14px × 14px` | 영역 색상 | 우측 11px (`#e5e7eb`) |
| `node[category = "소단원"]` | `ellipse` | `10px × 10px` | 영역 색상 | 우측 10px (`#d1d5db`) |
| `node[nodeType = "level_toc"]` | `diamond` | `11px × 11px` | 영역 색상, 테두리 `#fbbf24` `1px` | 우측 10px (`[TOC] {name}`) |
| `node[nodeType = "concept"]` | `round-tag` (또는 `hexagon`) | `12px × 12px` | 영역 색상 (`background-opacity: 0.85`), 테두리 `#38bdf8` `1.5px` | 우측 10px (`#bae6fd`) |
| `node[nodeType = "book"]` | `barrel` (또는 `round-rectangle`) | `22px × 26px` | `#f97316` (Orange-500) | 우측 11px Bold (`#fdba74`) |
| `node[nodeType = "toc"]` | `diamond` | `10px × 10px` | `#fb923c` (Orange-400) | 우측 10px |
| `node[nodeType = "page"]` | `rectangle` | `12px × 14px` | `#60a5fa` (Blue-400) | 우측 10px (`{page}p`) |
| `node[nodeType = "paragraph"]` | `round-rectangle` | `10px × 10px` | `문제`: `#f43f5e`, `해답`: `#10b981`, 기타: `#a78bfa` | 우측 10px |
| `node[hasHidden > 0]` | (공통 추가 스타일) | — | `border-width: 2.5px`, `border-style: double`, `border-color: #fde68a` | 펼칠 수 있는 하위/연결 노드 존재 표시 |
| `node:selected` | (공통 추가 스타일) | — | `border-width: 3.5px`, `border-color: #f97316`, `underlay-color: #f97316`, `underlay-opacity: 0.25`, `underlay-padding: 6px` | 선택 강조 |
| `node.dimmed` | (비활성 강조 해제) | — | `opacity: 0.15`, `text-opacity: 0.1` | 경로/이웃 하이라이트 시 배경 노드 감쇠 |

#### 엣지(Edge) 시각적 인코딩 규칙

| `edgeType` | 선 스타일 (`line-style`) | 곡선 (`curve-style`) | 색상 (`line-color`) | 화살표 (`target-arrow-shape`) | 굵기 / 투명도 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `HAS_CHILD` (주 계층) | `solid` | `taxi` (`tree` 모드) / `bezier` | `#4b5563` | `none` | `1.2px`, `opacity: 0.75` |
| `HAS_CHILD` (다중 상위 보조) | `dashed` | `bezier` | `#4b5563` | `none` | `1px`, `opacity: 0.35` |
| `BELONGS_TO_AREA` | `dotted` | `bezier` | `#6b7280` | `none` | `1px`, `opacity: 0.3` |
| `PREREQUISITE_OF` | `solid` | `unbundled-bezier` | `#f3f4f6` (강조 시 `#fde68a`) | `triangle` | `1.5px`, 기본 `0.4` / 선택 시 `1.0` |
| `APPLIES_TO` | `dashed` (`[6, 3]`) | `unbundled-bezier` | `#38bdf8` (Sky-400) | `vee` | `1.5px`, `opacity: 0.65` |
| `DESCRIBES` | `dotted` | `bezier` | `#a78bfa` (Violet-400) | `tee` | `1.2px`, `opacity: 0.6` |
| `CONCEPT_IN_UNIT` (`isPrimary=true`) | `solid` | `bezier` | `#38bdf8` | `triangle-backcurve` | `confidence` 비례 (`1.0px ~ 2.2px`), `0.75` |
| `CONCEPT_IN_UNIT` (`isPrimary=false`) | `dashed` | `bezier` | `#0284c7` | `triangle-backcurve` | `1px`, `opacity: 0.4` |
| `CONCEPT_PREREQ_OF` | `solid` | `unbundled-bezier` | `#fbbf24` (Amber-400) | `triangle` | `1.5px`, `opacity: 0.7` |
| `MAPS_TO` / `HAS_TOC` / `POINTS_TO` | `solid` | `bezier` | `#fb923c` (Orange-400) | `triangle` | `1.2px`, `opacity: 0.6` |
| `ANSWERS` | `dashed` | `bezier` | `#10b981` (Emerald-500) | `triangle` | `1.5px`, `opacity: 0.8` |

---

## 4. 페이지 아키텍처 및 UI 레이아웃 (`/graph`)

`DESIGN.md`의 다크 글래스모피즘(`#0b0f19` 배경, `glass` 패널, `#f97316` 포인트)을 따른다.

### 4.1 전체 화면 구성

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ AppHeader (NAV에 `{ href: "/graph", label: "KG 그래프" }` 추가)                            │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ 상단 컨트롤 바 (GraphToolbar)                                                             │
│ [뷰 모드: 계층트리 | 네트워크 | 선수DAG | 포커스] [깊이: L1..L5..L9]                       │
│ [레이어 토글: ☑단원 ☐개념(660) ☐교재TOC ☐도서/문단] [엣지: ☑선수 ☑전략적용 ☐보조영역]       │
│ [검색창: 단원·개념·도서 검색 (⌘K)] [영역 필터: 전체 | 수와연산 | 함수 ...] [초기화] [맞춤] │
├──────────────────┬───────────────────────────────────────────────────┬───────────────────┤
│ 좌측 탐색 트리   │ 중앙 Cytoscape 캔버스 영역 (`#0d1117`)             │ 우측 인스펙터 패널│
│ (접기/펼치기 가능│ ┌───────────────────────────────────────────────┐ │ (380px~420px)     │
│  260px)          │ │ 상단 브레드크럼: 함수 > 미적분Ⅰ > 함수의 극한  │ │                   │
│                  │ └───────────────────────────────────────────────┘ │ [탭1: 상세·관계]  │
│ • DB 요약 통계   │                                                   │ [탭2: 수학 개념]  │
│   노드 / 엣지 수 │               (Cytoscape.js 캔버스)               │ [탭3: 교재·사전]  │
│ • 7대 영역 아코디│                                                   │                   │
│   언 목차 트리   │                                                   │ • 노드 메타데이터 │
│ • 도서 목록      │ ┌─────────────────────────┐ ┌───────────────────┐ │ • 수식 본문 뷰어  │
│ • 검색 결과 리스트│ │ 하단 플로팅 범례/미니바 │ │ [선수추적][1-hop+]│ │ • 선수 추가/삭제  │
│                  │ └─────────────────────────┘ └───────────────────┘ │ • 연결 노드 이동  │
└──────────────────┴───────────────────────────────────────────────────┴───────────────────┘
```

### 4.2 주요 인터랙션 규칙

1. **노드 단일 클릭 (`tap`)**:
   - 해당 노드를 `selected` 상태로 만들고 우측 인스펙터 패널에 상세 정보를 로드한다.
   - 연결된 1-hop 이웃과 간선(`PREREQUISITE_OF`, `CONCEPT_IN_UNIT`, `APPLIES_TO` 등)을 밝게(`hl` 클래스) 표시한다.
   - `tree` 모드에서 이미 선택된 `level` 노드를 다시 클릭하면 하위 `HAS_CHILD` 노드를 펼치거나 접는다(기존 `/network` 호환 동작 유지 + 클릭한 노드의 화면 좌표 앵커 고정).

2. **노드 더블클릭 또는 플로팅 액션 `[+ 연결 펼치기]`**:
   - 해당 노드에 연결된 미로드 서브그래프(매핑된 `math_concepts`, `toc_unit_links`, `paragraph` 등)를 `/api/graph/subgraph?nodeId=...`로 가져와 현재 캔버스에 증분 병합(`cy.add(...)`)하고 레이아웃을 국소 갱신한다.

3. **선수·후속 경로 추적 모드 (`Path Trace`)**:
   - 노드 선택 시 플로팅 바 또는 우측 패널의 **`[선수/후속 경로 추적]`** 토글을 켜면:
     - 선택 노드로부터 역방향(`PREREQUISITE_OF`, `CONCEPT_PREREQ_OF`)으로 도달 가능한 모든 **선수 노드(Ancestors)**를 파란색 테두리(`#38bdf8`)로 강조.
     - 정방향으로 도달 가능한 모든 **후속 노드(Descendants)**를 주황색 테두리(`#f97316`)로 강조.
     - 경로에 속하지 않는 나머지 노드·엣지에 `.dimmed` 클래스를 부여해 복잡도를 즉시 제거한다.

4. **검색 및 포커스 점프**:
   - 검색창에 키워드(예: `"평균값 정리"`, `"미적분"`, `"불변성의 원리"`) 입력 시 디바운스(200ms)로 단원·개념·도서·용어사전을 검색한다.
   - 검색 결과 클릭 시 해당 노드가 현재 캔버스에 없으면 상위 경로와 함께 캔버스에 추가한 뒤 `cy.animate({ center: { eles: target }, zoom: 1.4 }, { duration: 350 })`로 부드럽게 포커스 이동한다.

5. **캔버스 유틸리티 컨트롤 (우측 하단 플로팅 버튼 그룹)**:
   - 확대(`+`), 축소(`-`), 화면 맞춤(`Fit`), 선택 노드 중앙 정렬(`Center`), 전체 접기(`Reset to L3`), 현재 그래프 이미지 저장(`PNG 내보내기`: `cy.png({ bg: '#0d1117', full: true, scale: 2 })`).

---

## 5. 우측 인스펙터 패널(Inspector Panel) 상세 명세

선택된 노드 종류(`nodeType`)에 따라 우측 패널은 다음 3개 탭과 전용 카드를 제공한다.

### 5.1 탭 1: 상세 및 관계 (`Overview & Edges`)
- **공통 헤더**: 노드 타입 배지, 영역 컬러 인디케이터, 이름/제목, 고유 ID(복사 버튼), `/node?id=...` 새 창 링크(해당 시).
- **`level` 노드 선택 시**:
  - Level, Category(`과목`/`대단원`/`소단원`), 학년/학교급/개정교육과정(2022), 소단원 `kind` 표시.
  - 소속 영역(`BELONGS_TO_AREA`), 상위 단원, 하위 단원 수, 매핑된 개념 수(`kg.concept_unit_edges`), 연결된 교재 TOC 수(`kg.toc_unit_links`).
  - **선수 단원 편집기**: 현재 단원의 선수(`PREREQUISITE_OF`) 목록 칩(삭제 `×` 버튼 포함) 및 후보 단원 드롭다운 + `[선수 추가]` 버튼(기존 `/api/graph/levels` POST 연동, 순환 발생 시 에러 메시지 표시).
  - **전략 적용(`APPLIES_TO`) / 교육과정 설명(`DESCRIBES`)** 연결 목록(클릭 시 해당 노드로 포커스 이동).
- **`concept` 노드(`kg.math_concepts`) 선택 시**:
  - 원본 `source_id`, 병합된 원본 ID 목록(`merged_source_ids`), `concept_type` 배지, `math_field`, `school_type`, `difficulty_level`.
  - **개념 본문 뷰어**: `MathView` 컴포넌트로 `statement`(또는 `html_statement`)의 LaTeX / 백틱(`` ` ``) AsciiMath 수식을 렌더링하여 표시. 이미지(`img_path`)가 있으면 썸네일 함께 표시.
  - **단원 매핑 정보 (`kg.concept_unit_edges`)**:
    - 주 단원(`is_primary=true`) 및 부 단원(`is_primary=false`) 경로, 판정 모델(`judged_by`), 신뢰도(`confidence` %), 판정 근거(`rationale`).
    - `[Legacy→KG 페이지에서 보기]` 링크(`/legacy2ontology?q={source_id}`).
  - **성취기준 (`kg.concept_achievements`)** 및 **선수 개념 (`kg.concept_prerequisites`)** 목록.
- **`level_toc` / `book` / `toc` / `page` / `paragraph` 선택 시**:
  - 도서 제목(`bookTitle`), 목차 경로(`tocKey`, `tocLabel`), 페이지 번호(`page`, `pageKind`).
  - `page` 노드는 스캔 이미지(`imageUrl`) 미리보기 표시, `paragraph` 노드는 `formatItemBodyForPreview` 수식 렌더링 본문 및 연결된 문제/해답(`ANSWERS`) 이동 링크 제공.

### 5.2 탭 2: 소속 수학 개념 (`Mapped Concepts`) — 단원(`level`) 선택 시 활성
- 선택한 단원(및 하위 단원 포함 토글)에 `kg.concept_unit_edges (is_active=true)`로 연결된 수학 개념 목록을 카드 리스트로 표시.
- 각 개념 카드에 `[캔버스에 펼치기]` 버튼과 제목·유형·신뢰도 배지 표시.
- 상단에 **`[이 단원의 개념 전체 캔버스에 표시 (N개)]`** 버튼 제공.

### 5.3 탭 3: 교재·사전·퀴즈 (`Books & Dictionary`) — 단원(`level`) 또는 도서(`book`) 선택 시 활성
- `kg.toc_unit_links`로 연결된 도서 목차 목록 표시.
- 해당 도서/단원과 연결된 `kg.dictionary`(개념 사전 용어·정의·공식), `kg.flashcards`(플래시카드 N개), `kg.quizzes`(객관식 퀴즈 N개) 요약 및 아코디언 열람 제공.

---

## 6. 백엔드 API 명세 (Next.js App Router)

모든 조회 API는 `withReadOnly` (`BEGIN READ ONLY`, `statement_timeout = '5s'`) 트랜잭션으로 실행하며, 인증 미들웨어를 통과한 세션만 접근할 수 있다.

### 6.1 `GET /api/graph/overview`
초기 그래프 로드 및 필터용 전체 골격 데이터를 반환한다.

- **Query Params**:
  - `includeConcepts` (`0` | `1`, 기본 `0`): `1`이면 활성 매핑된 `kg.math_concepts` 노드와 `CONCEPT_IN_UNIT`, `CONCEPT_PREREQ_OF` 엣지를 함께 반환(단, `areaId` 또는 `unitId` 필터 지정 시 권장, 전체 시 최대 1,000개 제한).
  - `includeBooks` (`0` | `1`, 기본 `0`): `1`이면 `book` 노드와 `kg.toc_unit_links` 요약 엣지 포함.
  - `areaId` (선택, 예: `L1-FUNC`): 특정 영역과 연관된 서브그래프로 필터링.
- **Response (`200 OK`)**:
  ```ts
  export type GraphOverviewResponse = {
    stats: {
      levelCount: number;
      tocUnitCount: number;
      conceptCount: number;
      activeConceptEdgeCount: number;
      prereqEdgeCount: number;
      bookCount: number;
      dictionaryCount: number;
      quizCount: number;
    };
    nodes: GraphNodeDTO[];
    edges: GraphEdgeDTO[];
  };

  export type GraphNodeDTO = {
    id: string;
    nodeType: "level" | "level_toc" | "concept" | "achievement" | "book" | "toc" | "page" | "paragraph";
    label: string;
    level?: number;
    order?: number;
    category?: string | null;
    kind?: string | null;
    grade?: number | null;
    school?: string | null;
    revisedCurriculum?: number | null;
    areas?: string[];
    // 집계 배지용 카운트
    childCount?: number;
    conceptCount?: number;
    tocCount?: number;
    mapCount?: number;
    // concept 전용
    conceptId?: number;
    sourceId?: number;
    conceptType?: string | null;
    mathField?: string | null;
    difficultyLevel?: number | null;
    // book / toc / page 전용
    bookStem?: string;
    bookTitle?: string;
    page?: number | null;
  };

  export type GraphEdgeDTO = {
    id: string;
    src: string;
    dst: string;
    edgeType:
      | "HAS_CHILD"
      | "BELONGS_TO_AREA"
      | "PREREQUISITE_OF"
      | "APPLIES_TO"
      | "DESCRIBES"
      | "CONCEPT_IN_UNIT"
      | "CONCEPT_PREREQ_OF"
      | "HAS_ACHIEVEMENT"
      | "MAPS_TO"
      | "HAS_TOC"
      | "POINTS_TO"
      | "HAS_PARAGRAPH"
      | "ANSWERS";
    isPrimary?: boolean;
    confidence?: number | null;
    judgedBy?: string | null;
  };
  ```
- **핵심 SQL (`level` 노드별 개념 수·TOC 수 집계)**:
  ```sql
  SELECT n.id,
         (n.props->>'level')::int AS level,
         n.props->>'name' AS name,
         (n.props->>'order')::int AS "order",
         n.props->>'category' AS category,
         (n.props->>'grade')::int AS grade,
         n.props->>'school' AS school,
         (n.props->>'revisedCurriculum')::int AS "revisedCurriculum",
         n.props->>'kind' AS kind,
         ARRAY(
           SELECT a.dst FROM kg.edges a JOIN kg.nodes l ON l.id = a.dst
           WHERE a.src = n.id AND a.type = 'BELONGS_TO_AREA'
           ORDER BY (l.props->>'order')::int
         ) AS areas,
         (SELECT COUNT(*)::int FROM kg.edges c WHERE c.src = n.id AND c.type = 'HAS_CHILD') AS "childCount",
         (SELECT COUNT(*)::int FROM kg.concept_unit_edges ce WHERE ce.unit_id = n.id AND ce.is_active = true) AS "conceptCount",
         (SELECT COUNT(*)::int FROM kg.toc_unit_links tl WHERE tl.unit_id = n.id) AS "tocCount",
         (SELECT COUNT(*)::int FROM kg.edges m WHERE m.dst = n.id AND m.type = 'MAPS_TO') AS "mapCount"
  FROM kg.nodes n
  WHERE n.type = 'level'
  ORDER BY level, n.props->>'category' = '과목', "order", n.id;
  ```

### 6.2 `GET /api/graph/subgraph`
특정 노드를 기준으로 1-hop(또는 2-hop) 연결된 하위/주변 노드(개념, 교재 TOC, 페이지, 문단, 전략 적용 등)를 동적으로 불러온다.

- **Query Params**:
  - `nodeId` (필수): 기준 노드 ID (예: `L4-HIGH-...`, `concept:123`, `book:...`, `page:...`)
  - `types` (선택, 콤마 구분): 확장할 대상 종류 (`concepts`, `children`, `prereqs`, `books`, `pages`, `paragraphs`, 기본값은 전체)
  - `limit` (기본 `100`, 최대 `300`): 한 번에 가져올 최대 노드 수
- **동작**:
  - `nodeId`가 `L1~L5` 단원이면: 직계 하위 `level`/`level_toc` 노드 + `kg.concept_unit_edges (is_active=true)`로 연결된 `concept` 노드 + `APPLIES_TO`/`DESCRIBES`/`MAPS_TO` 연결 노드를 반환.
  - `nodeId`가 `concept:{id}`이면: 연결된 모든 활성 단원(`unit_id`), 선수/후속 개념(`kg.concept_prerequisites`), 성취기준(`kg.concept_achievements`) 반환.
  - `nodeId`가 `level_toc` 또는 `toc`이면: 연결된 `book`, 하위 `toc`, `POINTS_TO` 페이지(`page`) 반환.
  - `nodeId`가 `page`이면: 소속 `HAS_PARAGRAPH` 문단(`paragraph`)들과 `ANSWERS` 엣지 반환.

### 6.3 `GET /api/graph/node-detail`
우측 인스펙터 패널에 표시할 단일 노드의 상세 정보(수식 본문, 매핑 근거, 연결된 사전·퀴즈 요약 포함)를 반환한다.

- **Query Params**: `id` (필수)
- **Response (`200 OK`)**:
  - `level` 노드: 기본 속성 + 연결된 `concepts` 목록(최대 100건, `id, sourceId, title, conceptType, isPrimary, confidence, judgedBy, rationale`) + 연결된 `tocLinks` (`kg.toc_unit_links`) + 관련 `dictionary` / `quiz` 개수.
  - `concept:{id}` 노드: `kg.math_concepts` 전체 컬럼(`title`, `statement`, `htmlTitle`, `htmlStatement`, `mergeNotes`, `mergedSourceIds` 등) + 활성/비활성 `concept_unit_edges` 이력 + `concept_achievements` + 선수/후속 개념.
  - `book:` / `toc:` / `page:` / `paragraph:` 노드: 기존 `getNodeView(id)` 호환 데이터 + 도서 내 사전(`kg.dictionary`)·플래시카드(`kg.flashcards`)·퀴즈(`kg.quizzes`) 매칭 항목.

### 6.4 `GET /api/graph/search`
단원, 수학 개념, 도서/목차, 개념 사전을 통합 검색한다.

- **Query Params**: `q` (필수, 1자 이상), `limit` (기본 `30`)
- **동작**:
  - `kg.nodes` (`name`, `label`, `title` ILIKE `%q%`)
  - `kg.math_concepts` (`title` ILIKE `%q%` OR `source_id::text = q`)
  - `kg.dictionary` (`term` ILIKE `%q%` OR `english_term` ILIKE `%q%`)
- **Response**: `{ items: { id: string; nodeType: string; title: string; subtitle: string; areaId?: string; unitId?: string }[] }`

---

## 7. 컴포넌트 구조 및 파일 배치

```
web/src/
├── app/
│   ├── graph/
│   │   └── page.tsx                    # /graph 페이지 엔트리 (AppHeader + GraphExplorer)
│   └── api/
│       └── graph/
│           ├── overview/route.ts       # GET 전체 골격 + 통계 + 레이어별 노드/엣지
│           ├── subgraph/route.ts       # GET 특정 노드 기준 1-hop 동적 확장
│           ├── node-detail/route.ts    # GET 우측 인스펙터용 상세 정보 (개념 본문/사전 포함)
│           └── search/route.ts         # GET 통합 자동완성 검색
├── components/
│   ├── AppHeader.tsx                   # NAV 배열에 { href: "/graph", label: "KG 그래프" } 추가
│   └── graph/
│       ├── GraphExplorer.tsx           # 메인 컨테이너 (상태 관리: viewMode, filters, elements, selectedId, traceMode)
│       ├── GraphToolbar.tsx            # 뷰 모드 스위처, 깊이(L1~L9) 버튼, 레이어 토글, 영역 필터, 검색창
│       ├── GraphLeftSidebar.tsx        # DB 통계 카드, 7대 영역 트리 네비게이터, 도서 목록
│       ├── GraphCanvas.tsx             # Cytoscape.js 인스턴스 래퍼, 레이아웃 전환, 이벤트 핸들러, PNG 내보내기
│       ├── GraphLegendBar.tsx          # 하단 플로팅 범례 및 줌/맞춤/경로추적 빠른 버튼
│       ├── GraphInspector.tsx          # 우측 상세 패널 (탭 1: 상세·관계, 탭 2: 개념 목록, 탭 3: 교재·사전)
│       └── layouts.ts                  # treePositions(계층 트리), prereqDagPositions(선수 위상정렬), cose/concentric 설정
└── lib/
    └── server/
        └── kgGraphQueries.ts           # overview, subgraph, node-detail, search 전용 읽기 쿼리 모듈
```

---

## 8. Cytoscape.js 렌더링 및 성능 최적화 규칙

1. **대량 노드 렌더링 가드레일**:
   - 초기 로드 시에는 `level <= 3` 노드(약 50~80개)만 캔버스에 렌더링한다.
   - 사용자가 상단바에서 `[☑ 개념 노드]`를 체크할 때:
     - 현재 화면에 펼쳐진 단원(`shownUnitIds`)에 속한 `concept` 노드만 우선 렌더링한다.
     - 만약 펼쳐진 개념 노드가 300개를 초과하면 토스트 알림(`"성능을 위해 현재 펼쳐진 단원의 주 개념(Primary) 상위 300개만 표시합니다"`)을 띄우고 필터링한다.
2. **레이아웃 전환 시 앵커 보존**:
   - 노드 펼치기/접기 시 기존 `NetworkView.tsx`의 `anchor` 패턴(`renderedPosition` 및 `zoom` 기억 후 `panBy` 보정)을 그대로 계승하여 화면이 갑자기 튀지 않게 한다.
   - 뷰 모드(`tree` ↔ `force` ↔ `prereq` ↔ `ego`) 전환 시에는 `cy.layout(...).run()`을 호출해 자연스럽게 재배치한다.
3. **수식 렌더링 분리**:
   - Cytoscape 캔버스 내부 라벨(`data(label)`)은 순수 텍스트(수식 기호 유니코드 치환 또는 제목 텍스트)만 사용하여 WebGL/Canvas 60fps 프레임을 유지한다.
   - 복잡한 LaTeX / AsciiMath 수식(`statement`, `formula`, `definition`)은 우측 `GraphInspector` 패널에서 기존 `MathView` 컴포넌트로 렌더링한다.
4. **메모리 정리**:
   - 컴포넌트 언마운트 시 `cy.current?.destroy()`를 반드시 호출하고, 증분 데이터 병합 시 전체 인스턴스를 재생성(`new cytoscape`)하는 대신 `cy.batch(() => { ... })`로 엘리먼트 추가/삭제 및 클래스 토글을 수행한다.

---

## 9. 구현 순서 (Step-by-Step)

1. **서버 쿼리 모듈 작성 (`web/src/lib/server/kgGraphQueries.ts`)**:
   - `getGraphOverview`, `getNodeSubgraph`, `getGraphNodeDetail`, `searchGraphNodes` 구현.
   - `kg.math_concepts` 테이블이 아직 생성되지 않은 환경에서도 에러 없이 빈 개념 목록(`conceptCount = 0`)으로 폴백되도록 `to_regclass('kg.math_concepts')` 체크 포함.
2. **API 라우트 생성 (`web/src/app/api/graph/{overview,subgraph,node-detail,search}/route.ts`)**:
   - 입력 파라미터 검증(`zod`) 및 `withReadOnly` 연동.
3. **레이아웃 및 스타일 모듈 작성 (`web/src/components/graph/layouts.ts`)**:
   - `treePositions` (단원 + 개념/TOC 열 배치), `prereqDagPositions` (위상 정렬 DAG 배치), `cose` 및 `concentric` 옵션, Cytoscape 스타일시트 정의.
4. **프론트엔드 컴포넌트 구현 (`web/src/components/graph/*.tsx`)**:
   - `GraphCanvas`, `GraphToolbar`, `GraphLeftSidebar`, `GraphInspector`, `GraphExplorer` 작성.
5. **라우트 등록 및 네비게이션 연결**:
   - `web/src/app/graph/page.tsx` 생성 및 `web/src/components/AppHeader.tsx`의 `NAV`에 `/graph` 추가.
6. **검증 및 빌드 테스트**:
   - `npm --prefix web run lint` 및 `npm --prefix web run build`로 타입·빌드 오류 0건 확인.

---

## 10. 완료 및 수용 기준 (Acceptance Criteria)

- [ ] 상단 네비게이션 바(`AppHeader`)에서 **`KG 그래프`**(`/graph`)로 이동할 수 있다(비로그인 시 `/login`으로 리다이렉트).
- [ ] 초기 진입 시 Level 1(7대 영역, 고정 색상) ~ Level 3 노드가 계층 트리로 표시되고, 상단/좌측에 DB 전체 노드·엣지·개념·도서 통계가 정확히 표시된다.
- [ ] 상단 툴바에서 **4가지 뷰 모드(`계층 트리`, `역학 네트워크`, `선수 DAG`, `포커스`)**를 전환하면 오류 없이 해당 레이아웃으로 즉시 재배치된다.
- [ ] 단원 노드를 클릭하거나 `[+ 연결 펼치기]`를 실행하면 해당 단원에 속한 하위 단원, `kg.math_concepts` 개념 노드, `kg.toc_unit_links` TOC 노드가 동적으로 캔버스에 펼쳐진다.
- [ ] **`[선수/후속 경로 추적]`** 활성화 시 선택된 단원/개념의 선수(Upstream)와 후속(Downstream) 체인이 강조되고 무관한 노드는 흐리게(`dimmed`) 처리된다.
- [ ] `concept` 노드를 클릭하면 우측 인스펙터에서 개념 제목, 수식 본문(`MathView`), 매핑된 단원(`is_primary`, `confidence`, `judged_by`, `rationale`), 성취기준, 병합 원본 ID(`merged_source_ids`)를 볼 수 있다.
- [ ] 단원 또는 도서 노드를 클릭하면 우측 인스펙터의 `교재·사전` 탭에서 연결된 교재 목차와 `kg.dictionary` / `kg.quizzes` / `kg.flashcards` 항목을 조회할 수 있다.
- [ ] 검색창에서 단원명·개념명·용어를 검색해 클릭하면 해당 노드로 캔버스가 자동 확대·이동(`center & zoom`)한다.
- [ ] 모든 조회 API는 읽기 전용(`BEGIN READ ONLY`)으로 동작하며, 기존 선수 관계 추가/삭제(`POST /api/graph/levels`)만 DB 트리거 검증 하에 쓰기를 수행한다.
