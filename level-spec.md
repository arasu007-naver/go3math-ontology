# Level 명세 (2026-10-06)

Go3 Math ontology의 knowledge graph에서 TOC 그물망의 계층은 "level"로 부른다. 이 문서는 Level 1부터 Level 5까지를 정의한다. Knowledge graph DB에 정리할 범위는 Level 5까지다.

상위 스펙: `go3math-ontology-26-10-05.md`
이 문서는 `spec-level-1.md`를 포함하고 대체한다. 두 문서가 다르면 이 문서를 따른다.

## 한눈에 보기

level은 나무에서의 깊이다. 노드가 무엇인지(과목, 대단원, 소단원)는 `category`로 따로 적는다.

| Level | 수학 영역 아래 | `L1-STUDY` 아래 |
| --- | --- | --- |
| 1 | 영역 (고정 7개 중 6개) | 수학 학습 (고정) |
| 2 | PREREQUISITE (고정, 영역마다 하나) = 중학 수학 1·2·3 | 없음 |
| 3 | 중등 대단원(`대단원`), 고등 과목(`과목`) | 수학 학습 과목 (고정 4개, `과목`) |
| 4 | 고등 과목의 대단원(`대단원`), 중등 대단원의 소단원(`소단원`) | 대단원 |
| 5 | 고등 대단원의 소단원(`소단원`) | 소단원 |

```
L1 함수 (L1-FUNC)
└─ L2 PREREQUISITE (L2-FUNC-PRE)          ← 중학 수학 1·2·3
   ├─ L3 일차함수와 그래프   [대단원, 중2]
   │  └─ L4 기울기          [소단원, 개념]
   ├─ L3 이차함수와 그래프   [대단원, 중3]
   ├─ L3 미적분Ⅰ           [과목, 고등]
   │  ├─ L4 함수의 극한      [대단원]
   │  │  └─ L5 극한의 성질   [소단원, 성질]
   │  └─ ...
   └─ ...

L1 수학 학습 (L1-STUDY)                    ← 독립. PREREQUISITE 없음
└─ L3 문제 해결 전략 [과목] ...
```

## Level 1 (고정, 7개)

| 순서 | 코드 | 이름 | 범위 |
| --- | --- | --- | --- |
| 1 | `L1-STUDY` | 수학 학습 | 문제 해결 전략, 교육과정, 학습법, 교습법 (수학 내용이 아닌 영역) |
| 2 | `L1-NUM` | 수와 연산 | 수 체계, 수의 연산 |
| 3 | `L1-EXPR` | 식과 계산 | 문자와 식, 다항식, 인수분해 등 |
| 4 | `L1-EQ` | 방정식과 부등식 | 방정식, 부등식, 연립 |
| 5 | `L1-FUNC` | 함수 | 함수와 그래프 |
| 6 | `L1-PROB` | 경우의 수·확률·통계 | 경우의 수, 확률, 자료와 통계 |
| 7 | `L1-GEO` | 도형 | 평면·입체 도형, 좌표·벡터 기하 |

- 이 일곱은 고정이다. 추가, 삭제, 이름·순서 변경은 이 문서를 고쳐야만 한다. 데이터 입력, API, UI로 바꿀 수 없다.
- 코드는 안정 식별자이고, 이름은 표시용이다.
- `L1-STUDY`는 수학 내용 영역이 아니고 독립적으로 둔다. Level 2(PREREQUISITE)를 두지 않고, 고정 과목 네 개를 Level 3으로 바로 둔다. 아래 "수학 학습 과목"을 따른다.

## Level 2: PREREQUISITE (고정, 6개)

`L1-STUDY`를 뺀 여섯 Level 1 아래에 각각 PREREQUISITE 노드가 정확히 하나 있다. PREREQUISITE 자체가 중학 과정(중학 수학 1, 2, 3)이다. 중학 과목을 따로 노드로 만들지 않는다.

| 코드 | 상위 | 이름 |
| --- | --- | --- |
| `L2-NUM-PRE` | `L1-NUM` | PREREQUISITE |
| `L2-EXPR-PRE` | `L1-EXPR` | PREREQUISITE |
| `L2-EQ-PRE` | `L1-EQ` | PREREQUISITE |
| `L2-FUNC-PRE` | `L1-FUNC` | PREREQUISITE |
| `L2-PROB-PRE` | `L1-PROB` | PREREQUISITE |
| `L2-GEO-PRE` | `L1-GEO` | PREREQUISITE |

- Level 1처럼 시드로 넣고 고정한다.
- PREREQUISITE 아래(Level 3)에는 중등 대단원과 고등 과목을 나란히 둔다.

## Level 3

### 중등 대단원 (`category: 대단원`)

중학 1~3학년 교과서의 대단원이다.

- 내용에 맞는 영역의 PREREQUISITE 하나 아래에 둔다.
- `grade`(1~3)로 학년을 적는다.
- 아래 Level 4는 소단원이다.

### 고등 과목 (`category: 과목`)

고등(대입 대비) 수학 학과목이다. 예: 공통 수학1, 공통 수학2, 대수, 미적분Ⅰ, 확률과 통계, 미적분Ⅱ, 기하.

- 내용이 속하는 영역들의 PREREQUISITE 아래에 둔다. 한 과목이 여러 영역에 걸치면 노드는 하나만 만들고 PREREQUISITE 여러 개 아래에 둔다(상위 여러 개).
- 과목 사이의 선수 관계는 이 단계에서 잇는다. 예: 공통 수학1 → 대수.
- 아래 Level 4는 그 과목의 대단원이다.

### 수학 학습 과목 (고정, 4개, `category: 과목`)

`L1-STUDY` 바로 아래에 다음 네 과목을 Level 3으로 둔다. Level 1처럼 시드로 넣고 고정한다.

| 순서 | 코드 | 이름 | 범위 |
| --- | --- | --- | --- |
| 1 | `L3-STUDY-PSS` | 문제 해결 전략 | 불변성의 원리, 게임 이론, 비둘기집 원리 같은 영역을 가로지르는 풀이 전략. 수학 독본, PSS(Problem Solving Strategies) 등 |
| 2 | `L3-STUDY-CURR` | 교육과정 | 대한민국 수학 교육과정 정보, 과목 구성과 과목 사이 연계(선수 관계) 설명 |
| 3 | `L3-STUDY-LEARN` | 학습법 | 학생의 수학 공부 방법 |
| 4 | `L3-STUDY-TEACH` | 교습법 | 가르치는 방법 |

- 이 네 과목 아래에도 Level 4(대단원), Level 5(소단원)를 둔다. 실제 목록은 교재 TOC(수학 독본, PSS 등)나 자료에서 입력하고, 구현 중 지어내지 않는다.
- 이 과목과 그 하위 노드는 `BELONGS_TO_AREA`로 `L1-STUDY`에만 속한다. 수학 영역(`L1-NUM` 등)에 소속시키지 않는다.
- 전략이 실제로 쓰이는 수학 단원과는 `APPLIES_TO`로 잇는다. 예: 문제 해결 전략 / 불변성의 원리 → 경우의 수 대단원, 정수 성질 소단원.
- 교육과정 아래 노드는 `DESCRIBES`로 수학 과목과 선수 관계를 설명할 수 있다.

## Level 4

- 고등 과목(또는 수학 학습 과목) 아래면 대단원(`category: 대단원`)이다. 정확히 하나의 과목에 속한다.
- 중등 대단원 아래면 소단원(`category: 소단원`)이다. 정확히 하나의 대단원에 속한다.
- 대단원은 소속 Level 1을 따로 가질 수 있다. 과목이 여러 영역에 걸치면 대단원 단위로 어느 Level 1인지 정한다. 예: 공통 수학1의 "행렬" 대단원은 `L1-NUM`.

## Level 5: 소단원

고등 대단원(또는 수학 학습 대단원) 아래의 소단원(`category: 소단원`)이다. 정확히 하나의 Level 4 대단원에 속한다.

## 대단원과 소단원

- 대단원 사이, 소단원 사이의 선수 관계를 둘 수 있다. 다른 과목의 대단원, 중등과 고등 대단원 사이도 이을 수 있다.
- 소단원은 개념, 정리, 성질, 공식 등 가장 작은 지식 단위다. 종류(`kind`)를 반드시 가진다.
  - 수학 영역 아래: `concept`(개념), `theorem`(정리), `property`(성질), `formula`(공식), `definition`(정의)
  - `L1-STUDY` 아래: `strategy`(문제 해결 전략), `method`(학습법·교습법), `info`(교육과정 정보)
  - 이 외의 값은 이 문서를 고쳐야만 추가한다.
- 교재 TOC 항목과 문단(unlimited-ocr JSON)은 소단원(필요하면 대단원)에 대응 관계로 붙인다. 교재 노드는 level 계층이 아니다.

## 관계

| 관계 | 시작 | 끝 | 설명 |
| --- | --- | --- | --- |
| `HAS_CHILD` | 상위 level 노드 | 하위 level 노드 | 계층. L1→L2, L1-STUDY→L3, L2→L3, L3→L4, L4→L5 |
| `BELONGS_TO_AREA` | L3, L4 | L1 | 과목·대단원의 영역 소속. 여러 개 가능 |
| `PREREQUISITE_OF` | 과목·대단원·소단원 | 같은 또는 상위 category 노드 | 선수 관계. A가 B의 선수. category 순서: 소단원 < 대단원 < 과목 |
| `MAPS_TO` | 교재 TOC 항목, 문단 | 대단원, 소단원 | 교재 내용 대응 |
| `APPLIES_TO` | `L1-STUDY` 아래 L4, L5 | 수학 영역의 L3, L4, L5 | 전략·방법이 쓰이는 단원 |
| `DESCRIBES` | `L3-STUDY-CURR` 아래 노드 | 수학 과목·선수 관계 | 교육과정 설명 |

규칙:

- Level 1 노드 사이, Level 2 노드 사이에는 `PREREQUISITE_OF`를 두지 않는다.
- `PREREQUISITE_OF`에 순환이 있으면 안 된다. 입력 시 검사해 거부한다.
- `HAS_CHILD`는 level이 정확히 한 단계(L1-STUDY→L3 수학 학습 과목은 예외) 내려가야 한다.

## 노드 필드

모든 level 노드는 다음을 가진다.

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| `id` | 예 | 안정 식별자. L1, L2, 수학 학습 과목은 위 고정 코드. 나머지는 `L3-`, `L4-`, `L5-` 접두사 + 고유값 |
| `level` | 예 | 1~5 (나무에서의 깊이) |
| `name` | 예 | 표시 이름 |
| `order` | 예 | 같은 부모 아래 표시 순서 |
| `category` | L3 이하 | `과목`, `대단원`, `소단원`. L3은 과목·대단원, L4는 대단원·소단원, L5는 소단원 |
| `kind` | 소단원만 | 위 "대단원과 소단원"에 정한 값 중 하나 |
| `grade` | 중등 대단원(L3 대단원)만 | 학년 1~3 |
| `school` | 고등 과목만 | `high` |
| `curriculum` | 고등 과목만 | 교육과정 판(예: 2022 개정) |
| `educationalStep` | 고등 과목만 | 교육과정 연도(정수, 예: 2022). 과목이 어느 교육과정 기준인지 기록한다 |

수학 학습 고정 과목(`L3-STUDY-*`)은 `school`, `curriculum`, `educationalStep`을 갖지 않는다.

## 시드 데이터

서비스 시작 시 Level 1 일곱 개, Level 2 여섯 개, 수학 학습 과목 네 개를 넣는다. 없으면 만들고, 있으면 그대로 둔다.

```json
[
  {"id": "L1-STUDY", "level": 1, "order": 1, "name": "수학 학습"},
  {"id": "L1-NUM",   "level": 1, "order": 2, "name": "수와 연산"},
  {"id": "L1-EXPR",  "level": 1, "order": 3, "name": "식과 계산"},
  {"id": "L1-EQ",    "level": 1, "order": 4, "name": "방정식과 부등식"},
  {"id": "L1-FUNC",  "level": 1, "order": 5, "name": "함수"},
  {"id": "L1-PROB",  "level": 1, "order": 6, "name": "경우의 수·확률·통계"},
  {"id": "L1-GEO",   "level": 1, "order": 7, "name": "도형"},
  {"id": "L2-NUM-PRE",  "level": 2, "order": 1, "name": "PREREQUISITE", "parent": "L1-NUM"},
  {"id": "L2-EXPR-PRE", "level": 2, "order": 1, "name": "PREREQUISITE", "parent": "L1-EXPR"},
  {"id": "L2-EQ-PRE",   "level": 2, "order": 1, "name": "PREREQUISITE", "parent": "L1-EQ"},
  {"id": "L2-FUNC-PRE", "level": 2, "order": 1, "name": "PREREQUISITE", "parent": "L1-FUNC"},
  {"id": "L2-PROB-PRE", "level": 2, "order": 1, "name": "PREREQUISITE", "parent": "L1-PROB"},
  {"id": "L2-GEO-PRE",  "level": 2, "order": 1, "name": "PREREQUISITE", "parent": "L1-GEO"},
  {"id": "L3-STUDY-PSS",   "level": 3, "order": 1, "name": "문제 해결 전략", "category": "과목", "parent": "L1-STUDY"},
  {"id": "L3-STUDY-CURR",  "level": 3, "order": 2, "name": "교육과정",       "category": "과목", "parent": "L1-STUDY"},
  {"id": "L3-STUDY-LEARN", "level": 3, "order": 3, "name": "학습법",         "category": "과목", "parent": "L1-STUDY"},
  {"id": "L3-STUDY-TEACH", "level": 3, "order": 4, "name": "교습법",         "category": "과목", "parent": "L1-STUDY"}
]
```

위 시드 외의 Level 3 이하 과목·단원 목록은 이 문서에서 만들지 않는다. 교육과정 자료나 교재 TOC에서 입력한다. 구현 중 임의로 지어내지 않는다.

## 시각화

- 네트워크 그래프에서 Level 1 일곱 노드는 항상 보인다.
- 일곱 영역은 서로 다른 색이다. 하위 노드는 소속 Level 1 색을 따르고, 여러 영역에 속하면 첫 소속 색을 쓴다.
- level별로 펼치고 접을 수 있다. 기본은 Level 3까지 보인다.
- `PREREQUISITE_OF`는 방향 있는 선으로 그린다.

## 이 문서에서 하지 않는 것

- 교재 내용 적재(상위 스펙의 시작 교재 순서를 따른다)
- 모의고사 기출 연결
- GUIDE, Plan 등 학습 진행 기능

## 완료 기준

- 그래프에 Level 1이 정확히 7개, Level 2 PREREQUISITE가 정확히 6개, 위 코드와 이름대로 있다
- 그래프에 수학 학습 고정 과목 4개가 위 코드와 이름대로 `L1-STUDY` 바로 아래에 있다
- `L1-STUDY` 아래에는 Level 2가 없고, Level 3은 고정 4과목(문제 해결 전략, 교육과정, 학습법, 교습법)뿐이다
- `L1-STUDY` 아래 소단원의 `kind`는 `strategy`, `method`, `info` 중 하나이고, 수학 영역에는 `BELONGS_TO_AREA`로 속하지 않는다
- Level 1, 2와 수학 학습 고정 과목을 바꾸는 입력·API가 없다
- 수학 영역의 모든 L3(중등 대단원, 고등 과목)는 PREREQUISITE(L2) 아래에 있고, 중등 대단원은 PREREQUISITE 하나 아래에만 있다
- 모든 L4는 하나의 L3 아래에, 모든 L5는 하나의 L4 대단원 아래에 있고, category가 위 표대로다
- 모든 소단원에 허용된 `kind`가 있다
- `PREREQUISITE_OF`에 순환이 없고, 순환을 만드는 입력은 거부된다
- 시각화에서 일곱 영역이 항상 보이고, 색과 선수 화살표가 위 규칙대로 나온다
