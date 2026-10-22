# 스펙: MariaDB `math_concepts` → Knowledge Graph DB(22 개정 수학 단원) 연동

버전 1.3 · 2026-10-20 · 대상 실행자: Claude (코드 작성/실행 에이전트)

## 1. 목표
기존 MariaDB `math_concepts` 테이블의 수학 개념(약 660개)을 Knowledge Graph DB의 2022 개정 교육과정 수학 단원·성취기준 노드에 정확하게 연결한다. 최우선 기준은 정확도이며, 예상 비용은 약 $5~10이다.

**범위 제외:** 문제(약 7,142개)는 이번 작업에서 다루지 않는다. 단, 이후 문제 매핑에 재사용할 수 있도록 파이프라인을 `item_type` 확장 가능하게 설계한다.

## 2. 입력 파라미터
| 이름 | 필수 | 설명 |
|---|---|---|
| MARIADB_DSN | Y | 원본 DB 접속 정보(환경변수). 읽기 전용 계정 사용 |
| KG_PG_DSN | Y | Knowledge Graph DB(현행 PostgreSQL) 접속 정보(환경변수) |
| ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY | Y | 판정·교차검증·임베딩용 키(환경변수) |
| CONCEPT_TABLE | N | 원본 테이블명, 기본 `mathdb.math_concepts` |
| TOP_K | N | 후보 수, 기본 10 |
| CONF_THRESHOLD | N | 자동 확정 최소 신뢰도, 기본 0.8 |
| DRY_RUN | N | true면 KG에 쓰지 않고 결과 파일만 생성, 기본 true |

비밀값은 코드·로그·커밋에 절대 남기지 않는다.

## 2-1. 원본 스키마 (`mathdb.math_concepts`, MariaDB)
| 컬럼 | 용도 |
|---|---|
| id | 원본 PK → KG `source_id` |
| chapter_id | `math_chapters.id` FK. 기존 단원(구 교육과정일 수 있음) → 후보 추출 힌트로만 사용, 정답으로 간주 금지 |
| math_field | NUMBERS/ALGEBRA/GEOMETRY/COMBINATORICS/CALCULUS/VECTORS/STATISTICS → 후보 필터 힌트 |
| concept_type | PRINCIPLE/TARGET/SITUATION/DEFINITION/THEOREM/PROOFS/TERM/DETAIL/APPLY → KG 개념 유형 속성 |
| curriculum_type, school_type | 학년·학교급 → 후보 단원 학년 필터(±1학년 허용) |
| curriculum_year | 2015/2022 등. 2015 개념도 22개정 단원에 매핑 대상 |
| difficulty_level | 속성으로 보존 |
| raw_title / html_title | 개념명. 판정에는 raw_title 사용 |
| raw_statement / html_statement | 개념 본문(수식 포함). 판정에는 raw_statement 사용, 수식 표기 변환 금지 |
| img_path | 이미지 디렉토리. 본문이 비고 이미지만 있는 개념은 별도 목록으로 보고(OCR 범위 외) |
| is_on | 0이면 이식 대상에서 완전히 제외(병합 후보·매핑·KG 기록 모두 제외, 건수만 보고) |
| written_by, written_at, updated_at | 출처 속성으로 보존 |

원본 MariaDB는 읽기 전용. 어떤 UPDATE/DELETE도 하지 않는다.

## 2-2. 대상 (Knowledge Graph DB = 현행 PostgreSQL)
- 기존 KG 스키마(노드/엣지 테이블, 22개정 단원·성취기준 테이블)를 먼저 조사해 그 구조를 따른다. 신규 테이블이 필요하면 DDL 초안을 보고하고 승인 후 생성.
- 필요한 기록 내용:
  - 개념 노드: `source_id`(원본 id, 병합 시 대표 id), `merged_source_ids int[]`, 제목, 본문, concept_type, math_field, difficulty_level, 출처 속성
  - 개념→단원 엣지: primary 여부, confidence, 판정 모델, 근거
  - 개념→성취기준 엣지
  - 선수 개념 엣지(선택)
- `source_id` 유니크 제약 + `INSERT ... ON CONFLICT DO UPDATE`로 멱등 처리. 전체 쓰기는 트랜잭션 단위(배치 100건)로.

## 3. 사전 조사 (코딩 전 필수)
1. 원본 집계: 전체 행 수, is_on=0 수, curriculum_year·school_type·math_field 분포, `math_chapters` 구조(단원명 계층)를 보고서로 정리.
2. KG 스키마 조사: 22개정 단원 노드 라벨, 계층(과목 > 대단원 > 중단원 > 소단원), 성취기준 코드·원문 보유 여부.
3. 수식 표기 확인: Qoolla 표준은 백틱(`) AsciiMath. `$` LaTeX 혼재 여부를 샘플로 확인하고, 프롬프트에는 원문 그대로 전달한다(변환 금지).
4. 중복 개념 탐지(4장 단계 0) 결과를 보고.
조사 결과를 사용자에게 보고하고 확인받은 뒤 다음 단계로 진행한다.

## 4. 파이프라인
### 단계 0. 중복 개념 병합 (매핑 전에 수행)
1. 후보 탐지: (a) raw_title 정규화(공백·괄호·기호 제거, 소문자) 일치, (b) 제목+본문 임베딩 코사인 ≥ 0.92, (c) 동일 math_field 내 제목 유사도(편집거리) 높은 쌍.
2. 판정: Claude Sonnet에 쌍(또는 클러스터)의 제목·본문·concept_type·학년을 주고 `same | different | parent_child` 판정. same만 병합. parent_child는 병합하지 않고 관계 후보로 기록.
3. 대표 선정: is_on=1 > curriculum_year 2022 > 본문(raw_statement) 길이가 긴 것 > 최신 updated_at 순.
4. 병합 방법: KG에는 대표 1개 노드만 생성, 나머지 id는 `merged_source_ids`에 보관. 본문은 대표 것을 쓰되, 다른 개념에만 있는 정보(추가 수식·성질)는 `merge_notes`에 원문 그대로 보존(요약·재작성 금지).
5. 산출: `merge_groups.csv`(그룹 id, 대표 id, 병합 id들, 판정 근거). 학년이 2단계 이상 차이나는 병합, concept_type이 다른 병합은 사용자 검수 대상으로 표시.
6. 원본 MariaDB는 수정하지 않는다.

### 단계 1. 후보 추출 (임베딩)
- 모델: OpenAI `text-embedding-3-large`.
- 대상: 단원·성취기준 텍스트(경로 + 성취기준 원문), 병합 후 대표 개념(raw_title + raw_statement). 후보 계산 시 curriculum_type/school_type(±1학년), math_field를 필터 힌트로 사용하되, 필터로 후보가 TOP_K 미만이면 필터 해제.
- 코사인 유사도로 항목당 상위 TOP_K 후보 단원 선정. 정답 누락 방지를 위해 넉넉하게 유지.
- 임베딩은 로컬 캐시(파일 또는 pgvector)에 저장해 재실행 시 재사용.

### 단계 2. 1차 판정 (Claude Sonnet)
- 입력: 항목 본문 + 후보 TOP_K(단원 경로, 성취기준 코드·원문).
- 공통 지침·성취기준 블록은 prompt caching 적용.
- 출력(JSON만, 스키마 검증 필수):
```json
{
  "item_id": "string",
  "item_type": "concept",
  "primary_unit_id": "string",
  "secondary_unit_ids": ["string"],
  "achievement_codes": ["string"],
  "prerequisite_concept_ids": ["string"],
  "rationale": "string (한국어, 2문장 이내)",
  "confidence": 0.0
}
```
- 후보 밖 단원은 선택 금지. 적합한 후보가 없으면 `primary_unit_id: null`, confidence 0.

### 단계 3. 교차검증 (Gemini 2.5 Pro)
- 단계 2와 동일 입력·동일 스키마로 독립 판정(단계 2 결과는 보여주지 않음).

### 단계 4. 확정 규칙
| 조건 | 처리 |
|---|---|
| 두 모델 primary 일치 & 둘 다 confidence ≥ CONF_THRESHOLD | 자동 확정 |
| primary 불일치, 또는 어느 한쪽 confidence 미달, 또는 null | 검수 대기열 |
| 모든 개념 | 자동 확정 건도 사용자 최종 검수(일치 건은 일괄 승인 가능) |

### 단계 5. 선수 개념 (선택)
- 판정 시 동일·하위 학년 단원의 개념 목록을 제공해 `prerequisite_concept_ids` 후보를 받는다. 이것도 검수 대상이며, 확정 후 `(Concept)-[:PREREQUISITE_OF]->(Concept)`로 기록한다.

### 단계 6. KG 기록 (DRY_RUN=false일 때만)
- 2-2절 구조에 따라 PostgreSQL에 기록. 원본 id는 `source_id`, 병합된 id는 `merged_source_ids`로 보존.
- 멱등 처리(ON CONFLICT), 재실행 시 중복 생성 금지.
- 기존 단원 엣지 처리(이력 보존 교체):
  1. 기존 활성 엣지와 새 판정이 같으면 confidence·근거·판정 모델만 갱신.
  2. 다르면 검수 대기열에 올리고, 승인 시 기존 엣지를 `is_active=false`, `superseded_at`, `superseded_by`(새 엣지 id)로 비활성화한 뒤 새 엣지를 활성화. 기존 엣지 삭제 금지.
  3. 개념당 primary 활성 엣지는 정확히 1개(부분 유니크 인덱스: `(concept_id) WHERE primary AND is_active`). 보조 단원은 `primary=false`로 여러 개 허용.
  4. 엣지 테이블에 `is_active`, `superseded_at`, `superseded_by` 컬럼이 없으면 추가 DDL 초안을 보고하고 승인 후 적용.

## 5. 검수 대기열
- 출력: `review_queue.csv`(또는 office-manager 검수 화면용 JSON) — item_id, 본문 요약, 두 모델 결과, 근거, confidence.
- 검수 결과 입력 후 단계 6을 해당 항목에 대해 재실행할 수 있어야 한다.

## 6. 운영 규칙
- 배치 처리: 가능하면 Anthropic/Gemini Batch API 사용, 아니면 동시성 제한(레이트리밋 준수) + 지수 백오프 재시도.
- 진행 로그: 항목별 상태(pending/judged/confirmed/review/error)를 체크포인트 파일에 기록, 중단 후 재개 가능.
- 비용 로그: 모델별 입력/출력/캐시 토큰과 누적 비용을 기록, 예산 $20 초과 예상 시 중단하고 보고.
- 먼저 병합 탐지를 전체에 돌려 보고하고 승인받은 뒤, 대표 개념 30개 샘플로 파일럿 실행 → 일치율·비용·오류를 보고하고 승인받은 뒤 전량 실행.

## 7. 산출물
1. 사전 조사 보고서
2. 매핑 스크립트(재실행 가능, README 포함)
3. 결과 파일: `merge_groups.csv`, `mapping_results.jsonl`, `review_queue.csv`, `cost_report.md`
4. 최종 보고: 자동 확정 수/검수 수/오류 수, 모델 간 일치율, 실제 비용

## 8. 완료 기준
- is_on=1인 전 행(is_on=0은 제외)이 대표 개념으로 KG에 존재하거나 `merged_source_ids`에 포함(누락 0).
- 대표 개념 전량 confirmed, 사용자 검수 완료.
- KG에 중복 노드·관계 없음(source_id·merged_source_ids 기준 검증 SQL 결과 첨부).

## 9. 확정 사항
- KG DB: 현행 PostgreSQL
- 중복 개념: 병합(단계 0)
- 기존 단원 연결: 이력 보존 교체
- is_on=0: 제외
