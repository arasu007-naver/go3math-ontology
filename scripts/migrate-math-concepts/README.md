# migrate-math-concepts

MariaDB `math_concepts`(약 660개)를 KG(PostgreSQL `kg` 스키마)의 2022 개정 수학 단원(level 노드 대단원·소단원)에 연결한다.
스펙: [`specs/math-concepts-to-kg-mapping-spec.md`](../../specs/math-concepts-to-kg-mapping-spec.md)

## 준비

```bash
npm install
cp .env.example .env   # 값 채우기 (.env 는 커밋 금지)
npm test               # DB·API 없이 도는 단위 테스트
```

- 원본 MariaDB 는 `MARIADB_DSN`(`mysql://user:pass@host:3306/mathdb`, 읽기 전용 계정). 스크립트도 세션을 `READ ONLY` 로 연다.
- KG 는 `KG_PG_DSN` 이 있으면 그것을, 없으면 `PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD` 를 쓴다.
- 산출물은 모두 `out/` 에 생긴다(커밋하지 않음). 비용은 `out/cost_ledger.json` 에 실행 간 누적되며 `BUDGET_USD`(기본 20)에 닿으면 멈춘다.

## 순서 (단계마다 보고·승인 후 다음으로)

| # | 명령 | 하는 일 | 산출물 |
|---|---|---|---|
| 0 | `npm run survey` | 사전 조사(원본 분포, math_chapters, KG 단원·성취기준, 수식 표기) | `survey_report.md`, `image_only_concepts.csv` |
| 1a | `npm run merge -- --detect-only` | 중복 후보 쌍 탐지(제목 정규화 일치, 임베딩 코사인 ≥ 0.92, 같은 분야 제목 편집거리) | `merge_candidates.csv` |
| 1b | `npm run merge` | Claude 로 same / different / parent_child 판정, 병합 그룹 | `merge_groups.csv`, `merge_pairs.csv`, `parent_child_candidates.csv` |
| — | **검수** | `merge_groups.csv` 의 `needs_review=Y` 행에 `approved` Y/N 기입 (Y 행만 병합) | |
| 2 | `npm run candidates` | 병합 적용 + 임베딩 후보 TOP_K | `concepts_merged.jsonl`, `units.json`, `candidates.jsonl` |
| 3 | `npm run judge -- --sample 30` | **파일럿**: Claude + Gemini 독립 판정, 확정 규칙 | `mapping_results.jsonl`, `review_queue.csv`, `cost_report.md` |
| 3 | `npm run judge` | 전량 (중단 후 재실행 시 이어서) | 같음 |
| 4 | `npm run review -- --approve-confirmed` → 검수 → `npm run review` | 자동 확정 일괄 승인, 검수 결과 검사 | `approved.jsonl` |
| 5 | `npm run write-kg` | DRY_RUN(기본): 트랜잭션 안에서 해 보고 ROLLBACK | `kg_write_plan.jsonl`, `edge_conflicts.csv` |
| 5 | `DRY_RUN=true` 를 false 로 바꿔 실행 | 실제 기록 (DDL 승인·적용 후) | |
| — | `sql/verify.sql` | 중복·primary 1개·이력 검증 | |

`--ids 12,345` 로 특정 항목만 다시 판정(3)하거나 기록(5)할 수 있다.

## review_queue.csv 작성법

| 열 | 내용 |
|---|---|
| `status` | `confirmed`(두 모델 primary 일치 & 둘 다 confidence ≥ CONF_THRESHOLD) / `review` / `error` |
| `final_primary_unit_id` | 확정 단원 id. 22개정 범위 밖이라 단원 없이 개념만 기록하려면 `NONE` |
| `final_secondary_unit_ids`, `final_achievement_codes`, `final_prerequisite_ids` | 공백 구분 목록 |
| `replace_existing` | KG 에 이미 다른 primary 엣지가 있을 때 `Y` 면 이력 보존 교체(기존 엣지 비활성화, 삭제 안 함) |
| `approved` | `Y` 승인 / `N` 거부 / 빈칸 미검수 |

다시 `judge` 를 돌려도 검수자가 적은 열은 유지된다.

## 설계 메모

- **KG 대상 테이블**: 현행 `kg.nodes` 는 type 이 CHECK 로 고정이고 `kg.edges` 에 속성 열이 없어, 개념·엣지를 전용 테이블로 둔다 → [`ddl/001-concept-tables.sql`](ddl/001-concept-tables.sql) (**초안, 승인 후 적용**). 단원은 기존 `kg.nodes.id` 를 참조.
- **기존 단원 힌트**: `math_concepts.chapter_id` 가 없으면 `math_concept_chapters`(N:M)에서 읽는다. 프롬프트에 "참고"로만 준다.
- **성취기준**: KG 노드 `props.achievementStandards` 가 있으면 쓰고, 없으면 `ACHIEVEMENT_FILE`(`{"<unit_id>": [{"code": "...", "text": "..."}]}`)에서 읽는다. 둘 다 없으면 성취기준 엣지는 비어 있다.
- **후보 수 (2026-10-20 결정)**: KG 단원이 86개(대단원만)라 `TOP_K=86` 으로 모든 단원을 후보로 준다. 후보 블록은 unit_id 순으로 system 에 들어가 항목마다 같으므로 prompt caching 이 된다. 성취기준은 KG 에 없어 이번에는 쓰지 않는다.
- **원본 데이터 특성**: 제목·본문의 HTML 태그는 판정·임베딩 전에 걷어낸다(백틱 안 수식은 그대로, KG 에는 raw 원문 기록). `school_type` 이 없는 일괄 등록 TERM 562개는 학년·분야가 기본값이라 필터에 쓰지 않고 프롬프트에도 "미상"으로 준다. 기존 단원 힌트는 `math_concept_chapters` 에서 읽는다(`chapter_id` 는 전부 NULL).
- **학년 필터**: 개념 `curriculum_type` ↔ 단원 학년 ±1. 고등 과목 학년은 [`subject-grades.json`](subject-grades.json). 필터 통과 후보가 TOP_K 미만이면 필터를 푼다.
- **모델**: 판정 `claude-sonnet-5-5`(effort `EFFORT`, 기본 medium, 구조화 출력), 교차검증 `gemini-2.5-pro`(thinking budget 2048), 임베딩 `gemini-embedding-001`(파일 캐시). API 키는 Anthropic·Gemini 둘만 쓴다(OpenAI 미사용). Batch API 대신 동시성 제한(`CONCURRENCY`) + 지수 백오프.
- **확장**: 판정 단위는 `item_id`/`item_type` 이라 문제 매핑도 같은 프롬프트·스키마로 붙일 수 있다(이번 범위 밖).
