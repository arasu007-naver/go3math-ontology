# e2c 스키마 조사 결과 (exam2concepts)

기출문제 → 단원 1개 → 개념 연동(e2c)이 읽고 쓰는 이름의 확정판이다. 구현은 DB 에 접속해 다시 조사하지 않으며, 이름 상수는 `web/src/lib/e2c/schema-names.ts` 한 곳에만 둔다. 상세 규칙은 `docs/specs/196.md`.

## 기출문제 원본 (MariaDB, 읽기 전용)

- 테이블: `mathdb.question_units` (약 7,142문항). PK `id`(int)
- 문제: `raw_statement`(text) / 해답: `raw_note_statement`(text). HTML 은 `stripHtml` 로 걷고 backtick 수식은 그대로 둔다.
- 대상 필터: `subject_type='MATH' AND is_on=1` (대상 건수는 리포트에 기록)
- 접속: `MARIADB_DSN`. 연결마다 `SET SESSION TRANSACTION READ ONLY`, SELECT 만 (`web/src/lib/server/e2cLegacyDb.ts`)

### 메타 컬럼

| ProblemInput.meta | 컬럼 | 해석 |
|---|---|---|
| year | `release_year` | 그대로 |
| month | `release_month` | 그대로 |
| exam | `subscriber` + `release_month` | "평가원"이 들어 있고 11월이면 `수능`, 평가원의 다른 달은 `모평`, "교육청"이 들어 있으면 `학평`, 그 외에는 원문 |
| subject | `apply_type` | enum 원문 (COMMON, CALCULUS, STATISTICS, GEOMETRY, GA_TYPE, NA_TYPE, A_TYPE, B_TYPE) |
| number | `q_order` | 그대로 |
| points | `q_point` | 그대로 |
| 표시용 | `curriculum_type`, `difficulty_level`, `classification_type`, `origin_date`, `img_path`, `answer` | 화면 표시에만 쓰고 판단 입력에는 넣지 않는다 |

## 시험 과목 → KG 과목 (`web/src/lib/e2c/subjectMap.ts`, `e2c.config` key `subject_map` 으로 덮어쓰기)

| apply_type | KG 과목 id 접두 |
|---|---|
| COMMON | `L4-HALG`, `L4-HCAL1` |
| CALCULUS | `L4-HCAL2` |
| STATISTICS | `L4-HPS` |
| GEOMETRY | `L4-HGEO` |
| GA_TYPE, NA_TYPE, A_TYPE, B_TYPE, null | 매핑 없음 → 고등 전체 단원, `candidate_fallback=true` |

매핑된 접두에 해당하는 단원이 KG 에 없을 때도 고등 전체로 넓히고 `candidate_fallback=true`.

## KG (Postgres)

- 단원: `kg.nodes` level 노드 `L4-H*`(category=대단원), `web/src/lib/server/l2oUnits.ts` 의 `listUnits`. 과목은 부모(HAS_CHILD) 노드(`L3-HIGH-*`, category=과목). 교육과정 순서는 노드 `props.order`, 없으면 id 끝 번호. 과목 순서는 과목 노드 `props.order`, 없으면 공통수학1·2 → 대수 → 미적분Ⅰ → 확률과 통계 → 미적분Ⅱ → 기하.
- 선후 방향 (둘 다 **src 가 앞**):
  - `kg.edges` type `PREREQUISITE_OF`: 단원 src → dst 이면 src 가 dst 의 선수 (`level-spec.md`, `web/db/level-prereq.json`)
  - `kg.edges` type `PREREQ_OF`: 과목 src → dst 이면 src 가 앞 (`web/src/lib/graphDb.ts`). 과목 A 가 B 보다 앞이면 A 의 모든 단원이 B 의 모든 단원보다 앞이다.
- 개념: `kg.math_concepts`, 개념→단원: `kg.concept_unit_edges`(`is_active=true`)
- 개념 한 줄 정의: 별도 필드가 없어 설명 첫 문장으로 만들어 `e2c.concept_option_text` 에 캐시한다(source `auto`, 수동 수정 `manual`).
- legacy 개념 → 대표 개념 경로(`l2o.dedupe_member` → `l2o.dedupe_group` → `l2o.migration_result.kg_concept_id`)는 힌트 경로를 켤 때만 쓰며 지금은 호출하지 않는다.

## e2c 스키마 (Postgres, `web/db/e2c-schema.sql`, `npm run db:e2c`)

`e2c.job_run`, `e2c.model_call`, `e2c.problem_result`, `e2c.manual_override`, `e2c.pilot_label`, `e2c.concept_option_text`, `e2c.config`, `e2c.embedding_cache`. `problem_id` 는 `question_units.id`.

## 모델 호출·캐시·Batch

- 프롬프트 접두 순서: 고정 system → 후보 options 블록(id 정렬) → 문제 가변부. Claude 는 options 블록 끝에 `cache_control: ephemeral`, Gemini·xAI 는 같은 순서로 implicit 캐시.
- Batch 요청 id: `problemId:stage:model:promptVersion`. Anthropic Message Batches 의 `custom_id` 는 `[A-Za-z0-9_-]{1,64}` 만 허용해서 ':' 등을 '_' 로 바꿔 제출하고 결과는 원래 id 로 되돌린다. Gemini Batch 는 inline requests 의 `metadata.key`, xAI Batch 는 `batch_request_id`.
- xAI Batch 엔드포인트(`/v1/batches`, `/v1/batches/{id}/requests`, `/v1/batches/{id}/results`)와 Gemini `batchGenerateContent` 의 응답 형태는 공식 문서 기준으로 작성했고 스텁 테스트만 거쳤다. 첫 유료 실행(파일럿) 전에 한 번 확인한다.
- `dry_run` 은 job 에 기록되는 표시이고, e2c 는 KG 에 쓰지 않는다(반영은 별도 카드).

## Open Question

1. legacy 문제–개념 연결 테이블: 카드와 코드에서 확인되지 않았다. 힌트 경로(`legacyConceptHints`)는 빈 배열로 두고 `unit_hint_conflict` 계산 함수·테스트만 둔다. 테이블이 확인되면 `LEGACY_PROBLEM_CONCEPT_TABLE`(schema-names) 을 채워 켠다.
2. 문제 → 단원·개념 관계를 KG 에 쓰는 노드·엣지(KG 반영, `applied`): 미정. 사용자 승인 후 별도 카드에서 정한다. 이 카드는 `applied` 상태 값과 잠금 규칙(재실행으로 바꾸지 않음)만 갖는다.
3. 보조 개념 규칙, needs_review 기준, 확신도 임계값(0.5 / 0.6): 원문 기본값으로 구현했고 `e2c.config` 에서 바꿀 수 있다.
4. `unit_tie` 는 채택 단원을 지지한 모델의 표가 선후 미연결 동률(`curriculum_order`)로 정해진 경우로 구현했다.
