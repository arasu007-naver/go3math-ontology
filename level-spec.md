# Level 명세 (2026-10-05)

Go3 Math ontology의 knowledge graph에서 TOC 그물망의 계층은 "level"로 부른다. 이 문서는 Level 1부터 Level 5까지를 정의한다. Knowledge graph DB에 정리할 범위는 Level 5까지다.

상위 스펙: `go3math-ontology-26-10-05.md`
이 문서는 `spec-level-1.md`를 포함하고 대체한다. 두 문서가 다르면 이 문서를 따른다.

## 한눈에 보기

| Level | 이름 | 설명 | 예 |
| --- | --- | --- | --- |
| 1 | 영역 | 고정 7개 | 함수 |
| 2 | PREREQUISITE | 중등 수학까지의 선수 내용. `L1-STUDY`를 뺀 각 Level 1 아래 하나씩 | 함수 / PREREQUISITE |
| 3 | 과목 | 실제 중·고등 수학 학과목 | 중학 수학 2, 수학 I |
| 4 | 대단원 | 과목의 대단원 | 일차함수 |
| 5 | 소단원 | 개념, 정리, 성질, 공식 등 | 일차함수의 기울기 |

```
L1 함수 (L1-FUNC)
└─ L2 PREREQUISITE (L2-FUNC-PRE)        ← 중등까지
   ├─ L3 중학 수학 2
   │  └─ L4 일차함수
   │     └─ L5 기울기 (개념)
   └─ ...
└─ L3 수학 I (고등 과목)
   └─ L4 지수함수와 로그함수
      └─ L5 로그의 성질 (성질)
```

## Level 1 (고정, 7개)

| 순서 | 코드 | 이름 | 범위 |
| --- | --- | --- | --- |
| 1 | `L1-STUDY` | 수학 학습 | 교습법, 학습법, 교육과정 정보, 과목 연계(선수 관계) 등 수학 외적 메타 |
| 2 | `L1-NUM` | 수와 연산 | 수 체계, 수의 연산 |
| 3 | `L1-EXPR` | 식과 계산 | 문자와 식, 다항식, 인수분해 등 |
| 4 | `L1-EQ` | 방정식과 부등식 | 방정식, 부등식, 연립 |
| 5 | `L1-FUNC` | 함수 | 함수와 그래프 |
| 6 | `L1-PROB` | 경우의 수·확률·통계 | 경우의 수, 확률, 자료와 통계 |
| 7 | `L1-GEO` | 도형 | 평면·입체 도형, 좌표·벡터 기하 |

- 이 일곱은 고정이다. 추가, 삭제, 이름·순서 변경은 이 문서를 고쳐야만 한다. 데이터 입력, API, UI로 바꿀 수 없다.
- 코드는 안정 식별자이고, 이름은 표시용이다.
- `L1-STUDY`는 수학 내용이 아닌 메타 영역이다. Level 2~5 수학 계층을 두지 않는다. 교습법, 학습법, 교육과정 정보, 과목 선수 관계 설명 문서 노드만 붙인다.

## Level 2: PREREQUISITE (고정, 6개)

`L1-STUDY`를 뺀 여섯 Level 1 아래에 각각 PREREQUISITE 노드가 정확히 하나 있다. 중등 수학까지의 선수 내용을 묶는다.

| 코드 | 상위 | 이름 |
| --- | --- | --- |
| `L2-NUM-PRE` | `L1-NUM` | PREREQUISITE |
| `L2-EXPR-PRE` | `L1-EXPR` | PREREQUISITE |
| `L2-EQ-PRE` | `L1-EQ` | PREREQUISITE |
| `L2-FUNC-PRE` | `L1-FUNC` | PREREQUISITE |
| `L2-PROB-PRE` | `L1-PROB` | PREREQUISITE |
| `L2-GEO-PRE` | `L1-GEO` | PREREQUISITE |

- Level 1처럼 시드로 넣고 고정한다.
- PREREQUISITE 아래 Level 3에는 중등까지의 과목(중학 수학 1, 2, 3 등)만 둔다.

## Level 3: 과목

실제 중·고등 수학 학과목이다.

- 중등 과목은 해당 Level 1의 PREREQUISITE(Level 2) 아래에 둔다.
- 고등(대입 대비) 과목은 Level 1 바로 아래, PREREQUISITE와 같은 단계 옆에 Level 3으로 둔다. 고등 과목에는 Level 2 중간 노드를 만들지 않는다.
- 한 과목은 여러 Level 1에 걸칠 수 있다. 예를 들어 중학 수학 2는 `L2-EXPR-PRE`, `L2-EQ-PRE`, `L2-FUNC-PRE`, `L2-GEO-PRE` 아래 모두에 속할 수 있다. 과목 노드는 하나만 만들고 소속 관계를 여러 개 둔다.
- 과목 사이의 선수 관계는 이 레벨에서 잇는다. 예: 중학 수학 3 → 수학(고1) → 수학 I.

## Level 4: 대단원

각 과목의 대단원이다.

- 정확히 하나의 Level 3 과목에 속한다.
- 대단원은 소속 Level 1을 따로 가질 수 있다. 과목이 여러 영역에 걸치면 대단원 단위로 어느 Level 1인지 정한다. 예: 중학 수학 2의 "일차함수" 대단원은 `L1-FUNC`.
- 대단원 사이의 선수 관계를 둘 수 있다. 다른 과목의 대단원과도 이을 수 있다.

## Level 5: 소단원

개념, 정리, 성질, 공식 등 가장 작은 지식 단위다.

- 정확히 하나의 Level 4 대단원에 속한다.
- 종류(`kind`)를 반드시 가진다: `concept`(개념), `theorem`(정리), `property`(성질), `formula`(공식), `definition`(정의). 이 다섯 외의 값은 이 문서를 고쳐야만 추가한다.
- 소단원 사이의 선수 관계를 둘 수 있다.
- 교재 TOC 항목과 문단(unlimited-ocr JSON)은 Level 5(필요하면 Level 4)에 대응 관계로 붙인다. 교재 노드는 level 계층이 아니다.

## 관계

| 관계 | 시작 | 끝 | 설명 |
| --- | --- | --- | --- |
| `HAS_CHILD` | 상위 level 노드 | 하위 level 노드 | 계층. L1→L2, L1→L3(고등), L2→L3(중등), L3→L4, L4→L5 |
| `BELONGS_TO_AREA` | L3, L4 | L1 | 과목·대단원의 영역 소속. 여러 개 가능 |
| `PREREQUISITE_OF` | L3/L4/L5 | 같은 또는 상위 단계 노드 | 선수 관계. A가 B의 선수 |
| `MAPS_TO` | 교재 TOC 항목, 문단 | L4, L5 | 교재 내용 대응 |
| `DESCRIBES` | `L1-STUDY` 아래 문서 노드 | 과목·선수 관계 | 메타 설명 |

규칙:

- Level 1 노드 사이, Level 2 노드 사이에는 `PREREQUISITE_OF`를 두지 않는다.
- `PREREQUISITE_OF`에 순환이 있으면 안 된다. 입력 시 검사해 거부한다.
- `HAS_CHILD`는 level이 정확히 한 단계(L1→L3 고등 과목은 예외) 내려가야 한다.

## 노드 필드

모든 level 노드는 다음을 가진다.

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| `id` | 예 | 안정 식별자. L1, L2는 위 고정 코드. L3 이하는 `L3-`, `L4-`, `L5-` 접두사 + 고유값 |
| `level` | 예 | 1~5 |
| `name` | 예 | 표시 이름 |
| `order` | 예 | 같은 부모 아래 표시 순서 |
| `kind` | L5만 | 위 다섯 값 중 하나 |
| `school` | L3만 | `middle` 또는 `high` |
| `curriculum` | L3만 | 교육과정 판(예: 2022 개정) |

## 시드 데이터

서비스 시작 시 Level 1 일곱 개와 Level 2 여섯 개를 넣는다. 없으면 만들고, 있으면 그대로 둔다.

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
  {"id": "L2-GEO-PRE",  "level": 2, "order": 1, "name": "PREREQUISITE", "parent": "L1-GEO"}
]
```

Level 3 이하의 실제 과목·단원 목록은 이 문서에서 만들지 않는다. 교육과정 자료나 교재 TOC에서 입력한다. 구현 중 임의로 지어내지 않는다.

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
- `L1-STUDY` 아래에는 Level 2~5 수학 노드가 없다
- Level 1, 2를 바꾸는 입력·API가 없다
- 모든 L3는 L2(중등) 또는 L1(고등) 아래에, 모든 L4는 하나의 L3 아래에, 모든 L5는 하나의 L4 아래에 있다
- 모든 L5에 허용된 `kind`가 있다
- `PREREQUISITE_OF`에 순환이 없고, 순환을 만드는 입력은 거부된다
- 시각화에서 일곱 영역이 항상 보이고, 색과 선수 화살표가 위 규칙대로 나온다
