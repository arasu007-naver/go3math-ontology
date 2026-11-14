# exam_problems2concepts — 기출문제 → 단원(1개) → 개념 연동 구현 스펙 (v1.1)

> 대상: Claude(코딩 에이전트). 이 문서만으로 구현 가능하도록 작성. 비밀값은 코드·문서에 넣지 않고 환경변수 이름만 사용. **사용자 지시 없이 배포·push·운영 DB 반영 금지.**
> v1.1 변경: 결정 구조를 "세 모델 다수결 우선 → 다수결 없을 때만 Grok"의 4단계로 변경.

## 0. 요약
- 위치: `go3math-ontology` 프로젝트(Next.js App Router, `legacy2ontology`와 같은 프로젝트), 페이지 `/exam2concepts`, 작업 스키마 `e2c`(KG PostgreSQL).
- 소스: MariaDB 기출문제 약 **7,142문항**(문제 텍스트·해답 텍스트). **읽기 전용**.
- 대상: KG의 2022 개정 교육과정 단원·개념(660개 legacy 개념을 중복제거·이전한 대표 개념, 개념마다 소속 단원 정확히 1개).
- 결정 구조(0단계 전처리 후 4단계)
  1. **단원 추출**: JEV·Claude Sonnet·Gemini가 각각 관련 단원을 추출 → **코드**가 모델별로 `pickFinalUnit`(KG 과목·단원 선후상 가장 뒤 단원)을 적용해 모델당 단원 1표.
  2. **단원 채택**: 2표 이상 일치 → 그 단원 채택(Grok 호출 없음). 세 표가 모두 다르거나 다수결 불가 → **Grok이 단원 결정**.
  3. **개념 연동**: 채택 단원의 개념만 options로, 세 모델이 각각 주 개념 1개 + 보조 ≤3개. 주 개념 2표 이상 일치 → 채택. 보조 개념은 2개 이상 모델이 제안한 개념(§7.3 기본 규칙).
  4. **개념 결정**: 주 개념이 모두 다르면(또는 다수결 불가) **Grok이 주 1개 + 보조 ≤3개 결정**.
  - 규칙 검증 → `needs_review`(검토 필요) → 검토 UI에서 수동 수정(이력 보존, 재실행 시 덮어쓰지 않음).

### 0.1 흐름도
```
[0] 전처리(문제+해답, S번호, 메타, legacy 힌트)
      │
[1] 후보 단원 축소(코드) ──► JEV │ Claude │ Gemini  (병렬, 관련 단원 집합)
      │                         └─ 모델별 pickFinalUnit(코드) → 단원 표 3개
[2] 단원 표 집계
      ├─ 2표 이상 일치 ─────────────► 단원 채택 (decision_source=majority)
      └─ 모두 다름 / 다수결 불가 ─► Grok(합집합 안 관련 단원 집합) → pickFinalUnit → 채택 (decision_source=grok)
      │
[3] 채택 단원 개념 options(코드) ──► JEV │ Claude │ Gemini  (주1 + 보조≤3)
[4] 주 개념 집계
      ├─ 2표 이상 일치 ─► 주 개념 채택 + 보조 규칙(§7.3) (decision_source=majority)
      └─ 모두 다름 / 다수결 불가 ─► Grok(합집합 안 주1 + 보조≤3) (decision_source=grok)
      │
[검증] 사유 코드 → auto | needs_review → 검토 UI(수동 수정 = decision_source=manual)
```

## 1. 목표 / 비목표
**목표**
1. 문제마다 **단원 정확히 1개**(복수 단원 불허). 여러 단원에 걸치면 선후상 **최종 단원**이 문제의 단원(수능 대비 서비스 원칙).
2. 문제마다 최종 단원 안의 주 개념 1개, 보조 개념 0~3개.
3. 세 모델(JEV·Claude·Gemini) **다수결 우선**, 다수결이 없을 때만 Grok이 결정(호출·비용 최소화).
4. 모든 모델 호출의 원본 후보·확률·근거·버전을 기록(덮어쓰지 않음).
5. 멱등 재실행, 중단 후 재개, 수동 수정 보존.
6. 파일럿(사람 라벨 100~200문항)으로 정확도 측정 후 전체 실행.

**비목표**
- MariaDB 쓰기·스키마 변경, 문제/해답 본문 수정.
- `math_concepts2ontology.md` 변경, 개념 간 선후(prerequisite) 작업, 단원·과목 선후 편집.
- 앞선 단원 개념 연결(개념 선후 그래프가 담당).

## 2. 착수 전 스키마 조사 (필수, 결과를 `docs/e2c-schema.md`에 기록)
아래 placeholder는 실제 이름을 확인해 상수 파일 `lib/e2c/schema-names.ts` 한 곳에만 정의한다. 추측으로 채우지 말 것.

| Placeholder | 확인할 내용 |
|---|---|
| `<<PROBLEM_TABLE>>` | MariaDB 기출문제 테이블, PK, 문제 텍스트·해답 텍스트 컬럼 |
| `<<PROBLEM_META_COLS>>` | 출제연도, 시험(수능/모평/학평), 시행월, 과목, 문항번호, 배점, 사용 여부 컬럼 |
| `<<LEGACY_PROBLEM_CONCEPT_TABLE>>` | 기존 문제–legacy 개념 연결 테이블(없으면 힌트 생략) |
| `<<LEGACY_TO_REP_MAP>>` | legacy 개념 id → 대표 개념(`l2o.dedupe_member` → `dedupe_group` → `migration_result.kg_concept_id` 예상, 실제 확인) |
| `<<KG_SUBJECT>>`, `<<KG_UNIT>>` | KG 과목·단원 노드/테이블과 id·이름·교육과정 순서 컬럼 |
| `<<KG_UNIT_PRECEDES>>` | 과목·단원 선후 관계 이름·방향(A→B가 "A가 B보다 앞"인지 확인) |
| `<<KG_CONCEPT>>`, `<<KG_CONCEPT_UNIT_EDGE>>` | 개념 노드, 개념→단원 활성 엣지(`is_active`) |
| `<<KG_CONCEPT_DEFINITION>>` | 개념 한 줄 정의 필드(없으면 개념 설명 앞 1문장으로 생성해 `e2c.concept_option_text`에 캐시) |
| `<<KG_PROBLEM_LINK>>` | 최종 반영 대상(문제→단원, 문제→개념 관계). 없으면 반영 단계는 보류하고 Open Question으로 보고 |

조사 결과에 과목 범위 매핑(시험 과목 → KG 과목 집합, 예: 2028 수능 공통/선택)도 기록한다.

## 3. 환경변수
| 이름 | 용도 |
|---|---|
| `LEGACY_MARIADB_URL` | 읽기 전용 계정 |
| `KG_DATABASE_URL` | KG PostgreSQL |
| `JEV_API_URL`, `JEV_API_KEY`, `JEV_MODEL` | JEV(typesafe.ai) |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | Claude Sonnet |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini |
| `XAI_API_KEY`, `GROK_MODEL`(기본 `grok-4.7`), `GROK_REASONING_EFFORT`(기본 `low`) | Grok 판정(다수결 없음 시에만) |
| `E2C_PILOT_SHADOW_GROK` | 파일럿에서 다수결 사례에도 Grok을 그림자 호출해 비교(기본 `true`, 본실행 `false`) |
| `EMBEDDING_MODEL` | 후보 축소용(기존 프로젝트 것 재사용) |
| `E2C_CONCURRENCY_{JEV,CLAUDE,GEMINI,GROK}` | 모델별 동시 호출 수(기본 4) |
| `E2C_MAX_CONCEPT_OPTIONS` | 단계 3 개념 options 상한(기본 20) |
| `E2C_BUDGET_USD` | 실행당 비용 상한, 초과 시 일시정지 |

## 4. 0단계 전처리
`buildProblemInput(problemId)` →
```ts
interface ProblemInput {
  problemId: number;
  meta: { year?: number; exam?: string; month?: number; subject?: string; number?: number; points?: number };
  problemText: string;   // 원문, AsciiMath backtick 유지
  solutionText: string;  // 원문
  keySteps: string[];    // 해답을 문장/줄 단위로 나눈 단계, 번호 S1..Sn (코드로 분할, 모델 요약 아님)
  legacyConceptHints: { repConceptId: string; name: string; unitId: string }[]; // 재매핑 실패 id는 버리고 count만 기록
  inputHash: string;     // sha256(problemText+solutionText+meta)
}
```
- HTML 태그 제거, 공백 정규화. backtick 수식은 **그대로**(내부 변환 금지).
- 이미지 전용 문제(텍스트 부족: 문제+해답 < 40자)는 `status='skipped_no_text'`로 기록하고 파이프라인 제외, 개수 보고.
- statement 길이 상한: 해답이 길면 `keySteps` 앞뒤 우선 유지, 총 6,000자 초과분은 중략 표시 후 잘라냄(`truncated=true` 기록).

## 5. 단계 1 — 모델별 단원 추출
### 5.1 후보 단원 축소(코드)
1. 메타데이터 과목 → KG 과목 집합(§2 매핑)의 단원만 남긴다.
2. legacy 힌트 개념의 단원은 반드시 포함.
3. 15개 초과면 임베딩 유사도(문제+해답 vs 단원명+설명) 상위 15개 + 힌트 단원.
4. 0개(메타 누락)면 고등 수학 전체 단원, `candidate_fallback=true`.
- options 형식: `{id: unitId, text: "수학Ⅱ > 미분 > 도함수의 활용 — 한 줄 설명"}`. 세 모델은 **같은 후보 목록**을 받는다.

### 5.2 모델별 관련 단원 추출(JEV·Claude·Gemini, 병렬)
- 각 모델은 풀이에 쓰인 **관련 단원 집합**(1~6개)을 확률/확신도·근거 단계와 함께 반환.
- JEV: 반환 확률 분포 전체 저장. 관련 단원 = 확률 ≥ `jev_unit_min_prob`(기본 0.10)인 단원, 없으면 최고 확률 단원 1개.
- Claude/Gemini: §10.1 스키마.

### 5.3 모델별 단원 표 산출(코드, 결정적)
`pickFinalUnit(unitIds, precedenceGraph) → { unitId, rule }`를 **모델마다** 적용해 모델당 단원 1표를 만든다.
1. 선후 그래프의 전이 폐쇄로 비교, 집합 안에서 **다른 어떤 단원보다도 앞서지 않는 단원**(최대 원소)을 찾는다. 과목 선후 포함(과목 A가 B보다 앞이면 A의 모든 단원 < B의 모든 단원).
2. 최대 원소 1개 → `rule='precedence'`.
3. 2개 이상(선후 미연결) → 교육과정 순서(과목 순서, 단원 번호)상 가장 뒤 단원, `rule='curriculum_order'`.
4. 그래프 사이클 → `error='precedence_cycle'`(해당 모델 표 무효), 실행 리포트에 사이클 단원 기록.
- 이 함수는 모델을 호출하지 않으며 단위 테스트로 고정한다. 단계 2의 Grok 결과에도 같은 함수를 쓴다.

## 6. 단계 2 — 단원 채택(다수결 → 필요 시 Grok)
### 6.1 집계 규칙
| 성공 모델 수 | 표 상태 | 결과 | `unit_decision_source` |
|---|---|---|---|
| 3 | 3표 일치 | 채택 | `majority`(agree=3) |
| 3 | 2표 일치 | 채택 | `majority`(agree=2) |
| 3 | 모두 다름 | Grok 결정 | `grok` |
| 2 | 2표 일치 | 채택, `two_models_only` | `majority`(agree=2/2) |
| 2 | 불일치 | Grok 결정, `two_models_only` | `grok` |
| 1 | — | Grok 결정, `insufficient_models` | `grok` |
| 0 | — | `error`, 재실행 대상(Grok 호출 안 함) | — |
- "성공"은 호출 성공 + 후보 안 출력 + 유효한 표(사이클 아님). JEV 미설정(`not_configured`)도 실패와 동일하게 취급.

### 6.2 Grok 단원 결정
- 입력: 문제·해답(S번호), 각 모델의 관련 단원 집합·확률·근거와 모델별 표.
- 선택 범위: 성공 모델들의 **관련 단원 합집합**(성공 모델이 1개면 §5.1 후보 전체로 확장).
- 출력: 풀이에 쓰인 관련 단원 집합 `usedUnits`(§10.3) → 코드가 `pickFinalUnit` 적용 → 채택 단원. (Grok이 단원 하나를 직접 고르지 않게 해 "선후상 가장 뒤 단원" 규칙을 모델 경로와 동일하게 유지)
- 범위 밖 id → 1회 재요청 → 실패 시 `out_of_candidates`, 단원 미확정.

## 7. 단계 3·4 — 개념 연동(다수결 → 필요 시 Grok)
### 7.1 options(코드)
- 채택 단원 소속 개념(활성 엣지)만. `E2C_MAX_CONCEPT_OPTIONS`(기본 20) 초과 시 임베딩 상위 N개 + 그 단원 내 legacy 힌트 개념 강제 포함.
- 형식: `{id: conceptId, text: "개념명 — 한 줄 정의"}`. 정의는 `e2c.concept_option_text`에서 수동 수정 가능.
- 다른 단원 개념은 options에 넣지 않는다(앞선 단원 개념은 개념 선후 그래프가 담당).

### 7.2 모델별 개념 연동(JEV·Claude·Gemini, 병렬)
- 각 모델: 주 개념 정확히 1개 + 보조 0~3개, 개념별 근거 단계·확신도(§10.2).
- JEV: 최고 확률 = 주 개념, 다음 순위 중 확률 ≥ `jev_secondary_min_prob`(기본 0.15)인 것 최대 3개 = 보조.

### 7.3 집계 규칙(단계 3)
- **주 개념**: 성공 모델의 주 개념 중 2표 이상 일치하는 개념 → 채택(`concept_decision_source='majority'`).
- **보조 개념(기본 규칙, 사용자 확인 필요 → §21)**: 채택된 주 개념을 제외하고, **역할과 무관하게(주·보조 어느 쪽으로든) 2개 이상 모델이 제안한 개념**을 보조로 채택. 3개 초과 시 (제안 모델 수 desc, 평균 확신도 desc, conceptId asc) 순으로 상위 3개. 해당 개념이 없으면 보조 0개.
- 성공 모델 수별 처리는 §6.1과 동일: 2개 성공이면 주 개념 일치 시 채택(`two_models_only`, 보조는 두 모델 모두 제안한 개념), 불일치 시 Grok. 1개 성공이면 Grok(`insufficient_models`), 0개면 `error`.

### 7.4 Grok 개념 결정(단계 4)
- 조건: 주 개념이 모두 다름(3개 성공) 또는 2개 성공 불일치 또는 1개 성공.
- 선택 범위: 성공 모델이 제안한 모든 개념(주·보조)의 합집합(성공 모델 1개면 §7.1 options 전체). 모두 채택 단원 소속.
- 입력: 문제·해답, 합집합(option text), 모델별 주/보조·확신도·근거, 개념별 집계(주 표 수, 제안 모델 수).
- 출력: 주 1개 + 보조 0~3개(§10.4). 범위 밖·중복 id → 1회 재요청 → 실패 시 `out_of_candidates`.

## 8. 검증 규칙(`needs_review` 사유 코드, 복수 가능)
| 코드 | 조건 | 검토 필요 |
|---|---|---|
| `unit_grok` | 단원을 Grok이 결정 | Y |
| `concept_grok` | 주 개념을 Grok이 결정 | Y |
| `two_models_only` | 어느 단계든 성공 모델 2개(JEV 미설정 포함) | Y |
| `insufficient_models` | 성공 모델 1개 | Y |
| `unit_tie` | 채택 단원(모델 표 다수 또는 Grok 경로)이 `curriculum_order` 규칙으로 결정됨 | Y |
| `unit_low_conf` | majority: 채택 단원을 낸 모델들의 해당 단원 평균 확신도 < 0.5 / grok: confidence < 0.6 | Y |
| `concept_low_conf` | majority: 주 개념 평균 확신도 < 0.5 또는 JEV 주 개념 확률 < 0.3 / grok: confidence < 0.6 | Y |
| `unit_hint_conflict` | legacy 힌트 단원이 채택 단원보다 선후상 뒤 | Y |
| `out_of_candidates` | 재요청 후에도 범위 밖 출력(결과 미확정) | Y |
| `truncated` | 입력 잘림 | Y |
| `majority_2of3` | 2:1 다수결(정보용) | N |
| `candidate_fallback` | 후보 단원 축소 실패로 전체 확장(정보용) | N |
- 위 Y 사유가 하나도 없으면 `status='auto'`. 임계값은 `e2c.config`에 두고 파일럿 결과로 조정.

## 9. 어댑터 인터페이스
```ts
// lib/e2c/adapters/types.ts
export type Proposer = 'jev'|'claude'|'gemini';
export interface Option { id: string; text: string }
export interface ScoredPick { id: string; prob: number; evidenceSteps: string[]; reason?: string }

export interface UnitProposeInput { problem: ProblemInput; options: Option[]; promptVersion: string }
export interface UnitProposeOutput extends CallMeta { relatedUnits: ScoredPick[]; distribution?: Record<string, number> }

export interface ConceptProposeInput { problem: ProblemInput; unit: Option; options: Option[]; promptVersion: string }
export interface ConceptProposeOutput extends CallMeta { primary: ScoredPick | null; secondary: ScoredPick[]; distribution?: Record<string, number> }

export interface CallMeta { raw: unknown; model: string; modelVersion?: string; latencyMs: number; error?: string;
  usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number; costUsd?: number } }

export interface ProposerAdapter {
  name: Proposer;
  proposeUnits(i: UnitProposeInput, signal?: AbortSignal): Promise<UnitProposeOutput>;
  proposeConcepts(i: ConceptProposeInput, signal?: AbortSignal): Promise<ConceptProposeOutput>;
}

// 다수결 집계(순수 함수, lib/e2c/vote.ts)
export function tallyUnits(votes: Partial<Record<Proposer, { unitId: string; rule: 'precedence'|'curriculum_order' }>>):
  { kind: 'majority'; unitId: string; agree: number; available: number } | { kind: 'no_majority'; available: number };
export function tallyConcepts(props: Partial<Record<Proposer, ConceptProposeOutput>>, maxSecondary = 3):
  { kind: 'majority'; primaryId: string; secondaryIds: string[]; agree: number; available: number } | { kind: 'no_majority'; available: number };

export interface GrokJudge {
  decideUnits(i: { problem: ProblemInput; union: Option[]; proposals: Partial<Record<Proposer, UnitProposeOutput>>; promptVersion: string }): Promise<GrokUnitDecision & CallMeta>;
  decideConcepts(i: { problem: ProblemInput; unit: Option; union: Option[]; proposals: Partial<Record<Proposer, ConceptProposeOutput>>; promptVersion: string }): Promise<GrokConceptDecision & CallMeta>;
}
```
- **JEV** `lib/e2c/adapters/jev.ts`: typesafe.ai 공식 문서를 먼저 읽고 엔드포인트·요청/응답·인증·모델 id·options 개수 상한·요금/한도를 `docs/jev-api.md`에 기록한 뒤 구현. **문서에 없는 엔드포인트를 만들지 말 것.** 미확인 상태에서는 `JEV_API_URL` 미설정 → `error='not_configured'`, 파이프라인은 2개 모델로 계속(§6.1 규칙, `two_models_only`).
- **Claude**: Messages API, temperature 0, tool/JSON schema 강제, max_tokens 800.
- **Gemini**: `responseMimeType: application/json` + `responseSchema`, temperature 0.
- **Grok**: xAI API(`https://api.x.ai/v1`), `response_format: {type:"json_schema"}`, `reasoning_effort=GROK_REASONING_EFFORT`. 응답 `usage.cost_in_usd_ticks`(1e-10 USD)를 비용으로 기록. **다수결이 없는 문제에만 호출**(파일럿 그림자 호출 제외).
- 공통: JSON 파싱/스키마 검증 실패 1회 재요청, 429·5xx는 지수 백오프(1s→2s→4s→8s, 최대 5회, `Retry-After` 우선), 타임아웃 60s(Grok 120s), AbortSignal로 일시정지/취소.

## 10. JSON 스키마
`enum`은 요청마다 후보 id로 주입(빈 enum은 400이므로 후보 0개는 호출 전 차단). 중복 id, 주·보조 겹침, 범위 밖 id는 코드에서 한 번 더 검증.
### 10.1 단원 추출(Claude/Gemini)
```json
{
  "type": "object",
  "required": ["relatedUnits"],
  "properties": {
    "relatedUnits": {
      "type": "array", "minItems": 1, "maxItems": 6,
      "items": {
        "type": "object",
        "required": ["id", "prob", "evidenceSteps"],
        "properties": {
          "id": {"type": "string", "enum": ["<후보 단원 id 주입>"]},
          "prob": {"type": "number", "minimum": 0, "maximum": 1},
          "evidenceSteps": {"type": "array", "items": {"type": "string", "pattern": "^S\\d+$"}},
          "reason": {"type": "string", "maxLength": 300}
        }
      }
    }
  }
}
```
### 10.2 개념 연동(Claude/Gemini)
```json
{
  "type": "object",
  "required": ["primary", "secondary"],
  "$defs": {
    "pick": {
      "type": "object",
      "required": ["id", "prob", "evidenceSteps"],
      "properties": {
        "id": {"type": "string", "enum": ["<채택 단원 개념 id 주입>"]},
        "prob": {"type": "number", "minimum": 0, "maximum": 1},
        "evidenceSteps": {"type": "array", "items": {"type": "string", "pattern": "^S\\d+$"}},
        "reason": {"type": "string", "maxLength": 300}
      }
    }
  },
  "properties": {
    "primary": {"$ref": "#/$defs/pick"},
    "secondary": {"type": "array", "maxItems": 3, "items": {"$ref": "#/$defs/pick"}}
  }
}
```
### 10.3 Grok 단원 결정
```json
{
  "type": "object",
  "required": ["usedUnits", "confidence", "reason"],
  "properties": {
    "usedUnits": {
      "type": "array", "minItems": 1, "maxItems": 6,
      "items": {
        "type": "object",
        "required": ["id", "evidenceSteps"],
        "properties": {
          "id": {"type": "string", "enum": ["<합집합 단원 id 주입>"]},
          "evidenceSteps": {"type": "array", "items": {"type": "string", "pattern": "^S\\d+$"}}
        }
      }
    },
    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    "reason": {"type": "string", "maxLength": 500}
  }
}
```
### 10.4 Grok 개념 결정
```json
{
  "type": "object",
  "required": ["primary", "secondary", "confidence", "reason"],
  "$defs": {
    "pick": {
      "type": "object",
      "required": ["id", "evidenceSteps"],
      "properties": {
        "id": {"type": "string", "enum": ["<합집합 개념 id 주입>"]},
        "evidenceSteps": {"type": "array", "items": {"type": "string", "pattern": "^S\\d+$"}}
      }
    }
  },
  "properties": {
    "primary": {"$ref": "#/$defs/pick"},
    "secondary": {"type": "array", "maxItems": 3, "items": {"$ref": "#/$defs/pick"}},
    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    "reason": {"type": "string", "maxLength": 500}
  }
}
```

## 11. 프롬프트(버전: `e2c-unit-v2`, `e2c-concept-v2`, `e2c-grok-unit-v2`, `e2c-grok-concept-v2`)
### 11.1 JEV statement 템플릿
```
[시험] {year} {exam} {month}월 {subject} {number}번
[문제] {problemText}
[풀이 핵심] S1: … / S2: … / …
[질문] 이 문제의 풀이에 사용된 {단원|개념}은?
```
options = 후보 단원 text(단계 1) / 채택 단원 개념 text(단계 3).
### 11.2 Claude/Gemini 단원 추출
System:
```
당신은 한국 2022 개정 교육과정 고등 수학 분류기입니다. 문제와 해답을 읽고 풀이에 실제로 사용된
단원을 후보 목록에서만 모두 고르세요(1~6개). 후보에 없는 id를 만들지 마세요.
최종 단원 하나를 고르지 마세요(코드가 교육과정 선후관계로 결정합니다).
각 단원마다 해답의 어느 단계(S번호)에서 쓰였는지와 0~1 확신도를 주세요. JSON만 출력합니다.
```
User: 메타·문제·번호 붙은 풀이 단계·후보 목록(`id | text`).
### 11.3 Claude/Gemini 개념 연동
```
이 문제의 단원은 {unitName}으로 확정되었습니다. 아래 이 단원의 개념 후보에서만 고르세요.
주 개념(primary) 정확히 1개: 정답 도출에 결정적인 단계의 개념.
보조 개념(secondary) 0~3개: 풀이에 필요하지만 부차적인 개념. 주 개념과 중복 금지.
각 개념에 근거 단계(S번호)와 0~1 확신도를 주세요. JSON만 출력합니다.
```
### 11.4 Grok 단원 결정(다수결 없음)
```
당신은 최종 판정자입니다. 세 분류기의 단원 판단이 일치하지 않았습니다. 각 분류기의 관련 단원과 근거를
검토해, 이 문제의 풀이에 실제로 사용된 단원 집합을 주어진 합집합 후보 안에서만 확정하세요.
최종 단원 하나를 고르지 마세요(코드가 선후관계로 가장 뒤 단원을 정합니다).
해답 단계에 근거가 없는 단원은 넣지 마세요. 판단 이유와 0~1 확신도를 주세요. JSON만 출력합니다.
```
### 11.5 Grok 개념 결정(다수결 없음)
```
단원 {unitName}에서 세 분류기의 주 개념이 서로 다릅니다. 각 분류기의 제안과 근거를 검토해,
합집합 후보 안에서만 주 개념 1개와 보조 개념 0~3개를 정하세요.
주 개념: 정답 도출에 결정적인 단계의 개념. 보조 개념: 풀이에 필요하지만 부차적인 개념.
판단 이유와 0~1 확신도를 주세요. JSON만 출력합니다.
```

## 12. 저장 테이블 초안(KG PostgreSQL, 스키마 `e2c`)
```sql
create schema if not exists e2c;
create table e2c.job_run (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('pilot','run_all','run_ids','rerun_review')),
  mode text not null default 'realtime' check (mode in ('realtime','batch')),
  scope jsonb not null, dry_run boolean not null default true, shadow_grok boolean not null default false,
  status text not null default 'queued' check (status in ('queued','running','paused','done','failed','cancelled')),
  total int default 0, processed int default 0, needs_review int default 0, failed int default 0,
  grok_unit_calls int default 0, grok_concept_calls int default 0,
  cost_usd numeric(12,4) default 0, cursor_problem_id bigint, xai_batch_ids text[] default '{}',
  prompt_versions jsonb not null, error text, created_by text,
  started_at timestamptz, finished_at timestamptz, created_at timestamptz default now()
);
create table e2c.model_call (                 -- 모든 호출 기록, 덮어쓰지 않음
  id bigserial primary key, job_run_id uuid references e2c.job_run(id),
  problem_id bigint not null, stage text not null check (stage in ('unit','concept')),
  role text not null check (role in ('proposer','judge','shadow_judge')),
  model_name text not null check (model_name in ('jev','claude','gemini','grok')),
  model text, model_version text, prompt_version text not null,
  options jsonb not null,                     -- 넘긴 후보 id·text
  output jsonb,                               -- 정규화된 relatedUnits | primary/secondary | Grok 결정
  vote_unit_id text, vote_rule text,          -- 단원 단계: 이 모델 출력에 pickFinalUnit 적용한 표
  distribution jsonb, raw_response jsonb,
  input_tokens int, output_tokens int, reasoning_tokens int, cost_usd numeric(10,6),
  latency_ms int, attempt int default 1, error text,
  input_hash text not null,                   -- problem.inputHash+stage+options+prompt_version+model
  created_at timestamptz default now()
);
create index on e2c.model_call (problem_id, stage, model_name, created_at desc);
create unique index on e2c.model_call (input_hash) where error is null;   -- 멱등: 같은 입력 재호출 안 함
create table e2c.problem_result (             -- 문제당 1행, 현재 상태
  problem_id bigint primary key,
  status text not null check (status in ('pending','auto','needs_review','overridden','confirmed','applied','skipped_no_text','error')),
  unit_votes jsonb,                           -- {jev:{unitId,rule}, claude:{...}, gemini:{...}}
  unit_models_available int, unit_agree_count int,
  unit_decision_source text check (unit_decision_source in ('majority','grok','manual')),
  grok_used_unit_ids text[], final_unit_id text,
  final_unit_rule text check (final_unit_rule in ('precedence','curriculum_order','manual')),
  concept_models_available int, primary_agree_count int,
  concept_decision_source text check (concept_decision_source in ('majority','grok','manual')),
  primary_concept_id text, secondary_concept_ids text[] default '{}',
  unit_confidence real, concept_confidence real,
  review_reasons text[] default '{}', truncated boolean default false, candidate_fallback boolean default false,
  last_job_run_id uuid, input_hash text, updated_at timestamptz default now(),
  check (coalesce(array_length(secondary_concept_ids,1),0) <= 3)
);
create table e2c.manual_override (            -- 수동 수정 이력
  id bigserial primary key, problem_id bigint not null,
  before jsonb, after jsonb not null, reason text, actor text not null,
  created_at timestamptz default now()
);
create table e2c.pilot_label (                -- 사람 정답
  problem_id bigint primary key, unit_id text not null,
  primary_concept_id text not null, secondary_concept_ids text[] default '{}',
  labeled_by text not null, created_at timestamptz default now()
);
create table e2c.concept_option_text (concept_id text primary key, text text not null, source text not null, updated_at timestamptz default now());
create table e2c.config (key text primary key, value jsonb not null);   -- 임계값·보조 규칙 파라미터
```
- **덮어쓰기 금지**: `status in ('overridden','confirmed','applied')` 행은 재실행에서 건너뛴다(`rerun_review`에서도 결과는 `model_call`에만 남기고 `problem_result`는 바꾸지 않음). 수동 수정 시 해당 단계 `*_decision_source='manual'`.
- 단원이 수동으로 바뀌면 개념 단계(3·4)는 새 단원으로 재실행 대상 표시(기존 개념 결과는 이력으로 보존).
- 멱등: 같은 `input_hash`의 성공 호출은 재사용. 프롬프트·모델 버전이 바뀌면 해시가 달라져 재호출. 다수결·Grok 필요 여부는 저장된 호출로 재계산 가능해야 한다.
- 문제→개념 연결의 단원 일치(주·보조 모두 `final_unit_id` 소속)는 저장 전 코드 검증 + 검증 쿼리로 확인.
- KG 반영(`applied`)은 `<<KG_PROBLEM_LINK>>` 확인 후 별도 버튼·트랜잭션. 기존 연결은 DELETE하지 않고 비활성화 후 새 연결 생성(legacy2ontology §4.6과 동일). 기본 `dry_run=true`.

## 13. 실행·Batch
- 문제 1건 파이프라인: 전처리 → 후보 단원 → 단원 추출 3개 병렬 → 모델별 `pickFinalUnit` → 집계 → (다수결 없음 시) Grok 단원 → 개념 options → 개념 연동 3개 병렬 → 집계 → (다수결 없음 시) Grok 개념 → 검증 → 저장.
- **realtime 모드**: 파일럿·소량·재처리용. 모델별 세마포어(§3), 진행률·Grok 호출 수·비용 실시간 표시.
- **batch 모드**(전체 실행, 단계 의존 때문에 4개 웨이브)
  - W1 단원 추출: JEV(그 API 방식), Claude·Gemini(각 사 batch 기능 사용 여부는 문서 확인 후 선택) → 완료분부터 표 집계.
  - W2 Grok 단원: **다수결 없는 문제만** xAI Batch API로 제출(`batch_request_id = problemId:unit:promptVersion`).
  - W3 개념 연동: 단원이 확정된 문제(W1 다수결 + W2 완료분).
  - W4 Grok 개념: **주 개념 다수결 없는 문제만** xAI Batch 제출.
  - 각 웨이브는 부분 결과를 즉시 저장, 실패 건은 다음 웨이브 전 realtime 재시도(§16), 그래도 실패하면 성공 모델 수에 따라 §6.1 규칙 적용.
- `E2C_BUDGET_USD` 초과 예상 시 시작 전 경고, 실행 중 초과 시 `paused`.
- 공통 system prompt는 고정 접두부로 두어 프롬프트 캐시가 잡히게 한다.

## 14. 검토 UI (`/exam2concepts`, legacy2ontology와 같은 좌우 행 정렬)
- 상단: 실행 버튼(`파일럿 실행`, `선택 문항 실행`, `전체 실행(batch)`, `검토 필요 재실행`), dry-run·그림자 Grok 토글, 진행 바, 누적 비용·Grok 호출 수, 필터(상태·사유 코드·결정 경로 majority/grok/manual·과목·연도).
- **좌측**: 메타, 문제 텍스트, 해답(S번호, 근거 단계 클릭 시 하이라이트), MathJax 렌더(기존 컴포넌트 재사용).
- **우측**
  1. 단원: 모델별 관련 단원·확률과 그 모델의 표(`pickFinalUnit` 결과·규칙), 집계(3/3·2/3·2/2·불일치), Grok 결과(호출 시), 채택 단원·결정 경로 배지.
  2. 개념: 개념별 모델 표(주/보조·확신도), 주 개념 집계, 보조 규칙 적용 결과, Grok 결과(호출 시), 사유 코드 배지.
  3. 수동 수정: 단원 선택(변경 시 개념 단계 재실행 버튼), 주 1개·보조 ≤3 선택(채택 단원 개념만 선택 가능), 사유 입력 → `manual_override`, `status='overridden'`. `확인` → `confirmed`.
- 키보드: J/K 이동, Enter 확인.

## 15. 비용·한도 (Grok, 2026-11-14 xAI 공식 요금 기준)
- 출처: https://docs.x.ai/docs/models , https://docs.x.ai/docs/models/grok-4.7 , https://docs.x.ai/docs/models/grok-4.3 , https://docs.x.ai/developers/pricing
- `grok-4.7`(공식 권장): 입력 $2.00 / 캐시 입력 $0.50 / 출력 $6.00 per 1M(프롬프트 200k 미만). Batch 지원, 20% 할인. 150 RPS, 50M TPM.
- `grok-4.3`(저가): 입력 $1.25 / 캐시 $0.20 / 출력 $2.50. Batch 지원, 20% 할인. 37 RPS, 10M TPM.
- 추론 토큰은 출력 요금으로 과금 → `GROK_REASONING_EFFORT=low` 기본(grok-4.7 기본값은 `high`).
- **Grok은 다수결이 없는 문제에만 호출**. 호출 1건 가정: 단원 결정 입력 3,600·출력 1,300(JSON 300 + 추론 1,000), 개념 결정 입력 4,200·출력 1,900(JSON 400 + 추론 1,500). 한국어+수식 1자≈1토큰(보수적), 캐시 할인 미반영.
- 호출당 비용(표준): grok-4.7 low 단원 $0.0150 / 개념 $0.0198, grok-4.7 high $0.0270 / $0.0348, grok-4.3 low $0.0077 / $0.0100. Batch는 ×0.8.
- 아래 표: 7,142문항, 단원 결정(단계 2)·개념 결정(단계 4)의 Grok 호출률을 같은 값으로 가정, 본실행 batch + 파일럿 그림자 호출(200문항×3회=600문항, 두 단계 모두 표준 요금) + 재실행 여유 20%. 환율 1 USD = 1,336.18원(2026-11-14 기준).

| Grok 호출률(단원·개념 결정 각각) | grok-4.7 low, batch(권장) | grok-4.7 low, 표준 | grok-4.7 high, batch | grok-4.3 low, batch |
|---|---|---|---|---|
| 10% | $49 (약 6.5만 원) | $55 | $87 | $25 |
| 20% | $73 (약 9.7만 원) | $85 | $129 | $37 |
| 30% | $97 (약 12.9만 원) | $115 | $172 | $49 |
| 50% | $144 (약 19.3만 원) | $174 | $256 | $74 |
- 파일럿 그림자 호출 몫(grok-4.7 low 약 $21, 여유분 전)이 낮은 호출률에서는 비중이 크다. 그림자 호출을 끄면 각 칸에서 약 $25(grok-4.7 low)가 줄어든다.
- 단계별 호출률이 다르면: 본실행 batch 비용 ≈ 7,142 × (r1×$0.0120 + r2×$0.0158) (grok-4.7 low).
- **JEV·Claude·Gemini 비용은 제외**(모든 문제에서 두 단계 모두 호출되므로 실제로는 이쪽이 더 클 수 있음, 각 사 요금 확인 후 리포트에 추가).
- 실제 비용은 `cost_in_usd_ticks`로 집계해 파일럿 후 재추정.

## 16. 오류·재시도
| 상황 | 처리 |
|---|---|
| 429/5xx/timeout | 지수 백오프 최대 5회 → 실패 시 `model_call.error`, 그 모델은 "실패"로 집계 |
| 스키마 불일치·범위 밖 id | 1회 재요청(오류 내용 포함) → 실패 시 그 모델 실패(제안 모델) / `out_of_candidates`(Grok) |
| JEV 미설정 | `not_configured`, 실패와 동일 → 2개 모델 규칙(§6.1) |
| 제안 모델 1~2개 실패 | §6.1·§7.3 성공 모델 수별 규칙 |
| 제안 모델 3개 실패 | 문제 `error`, 재실행 대상(Grok 호출 안 함) |
| Grok 실패 | 문제 `error`, 단원/개념 미확정, 재실행 대상 |
| 선후 사이클 | 해당 모델 표 무효 + 리포트 기록, Grok 경로면 문제 `error` |
| 서버 재시작 | `job_run.cursor_problem_id`·batch id로 재개 |

## 17. 파일럿
1. 과목·연도·난이도를 고르게 100~200문항 추출, `pilot_label`에 사람 정답 입력(검토 UI 라벨 모드).
2. 그림자 Grok(`E2C_PILOT_SHADOW_GROK=true`): 다수결 사례에도 Grok을 호출해 `role='shadow_judge'`로 저장(결정에는 쓰지 않음).
3. 측정 지표(리포트 `reports/e2c-pilot-<date>.md`)
   - **다수결률**: 단원·주 개념 각각 3/3 일치율, 2/3 일치율, 불일치율.
   - **Grok 호출률**: 단원 결정(단계 2), 개념 결정(단계 4) 각각(본실행 비용 추정에 사용, §15 표의 해당 행 선택).
   - **경로별 정확도**: 단원·주 개념 각각 majority 3/3, majority 2/3, majority 2/2, grok 경로별 정확도와 건수.
   - 모델별 정확도: 모델별 단원 표(pickFinalUnit 적용 후) 정확도, 관련 단원 top-3 포함률, 주 개념 top-1 정확도.
   - 보조 개념: 기본 규칙(§7.3)의 precision/recall, 대안(2표 이상 + 단일 모델 고확신 포함 등)과 비교.
   - 그림자 Grok vs 다수결: 다수결 사례에서 Grok이 다른 답을 낸 비율과 그때 어느 쪽이 맞았는지.
   - `needs_review` 비율과 그중 실제 오류 비율, 문항당 비용·지연.
4. **options 개수 비교(JEV 중점)**: 개념 options ① 600여 개 전체 ② 채택 단원 전체 ③ 임베딩 상위 20개 → JEV 주 개념 top-1/top-4 비교, `E2C_MAX_CONCEPT_OPTIONS` 확정.
5. 목표(초기값, 사용자 확인): 최종 단원 ≥95%, 주 개념 ≥85%, needs_review ≤20%. 미달 시 프롬프트·임계값 조정 후 재측정, 통과 후 전체 batch 실행.

## 18. 테스트
- 단위: `pickFinalUnit`(단일 최대·동률·과목 간 선후·사이클), `tallyUnits`(3/3, 2/3, 모두 다름, 2개 성공 일치/불일치, 1개·0개 성공), `tallyConcepts`(주 다수결, 보조 규칙: 역할 무관 2표·주 개념 제외·3개 초과 정렬·2개 성공 시), 검증 사유 코드, 해시 멱등, 덮어쓰기 금지.
- 어댑터: msw로 JEV/Claude/Gemini/xAI 모킹(정상·429·스키마 위반·범위 밖 id·JEV 미설정).
- 통합: 테스트 Postgres + MariaDB 픽스처 30문항으로 다수결 경로·Grok 경로 모두 포함한 파일럿 → 중단 → 재개 → override → 재실행 시 override 유지, Grok이 다수결 문제에 호출되지 않음(그림자 off) 확인.
- E2E(Playwright): 좌우 행 정렬, 근거 하이라이트, 결정 경로 배지, 수동 수정 제약(단원 밖 개념 선택 불가).

## 19. 구현 순서
1. §2 스키마 조사·기록 2. `e2c` 마이그레이션 3. 전처리·후보 축소 4. 어댑터(Claude·Gemini·Grok, JEV는 문서 확인 후) 5. `pickFinalUnit`·`tallyUnits`·`tallyConcepts` 6. 파이프라인·job 러너 7. 검토 UI 8. 파일럿 리포트 9. batch 모드 10. KG 반영(사용자 승인 후).

## 20. 완료 체크리스트
- [ ] `docs/e2c-schema.md`, `docs/jev-api.md` 작성, placeholder 전부 실제 이름으로 치환
- [ ] MariaDB 쓰기 경로 없음(SELECT 래퍼만)
- [ ] 비밀값 하드코딩 없음, `.env.example`에 변수명만
- [ ] 단원: 모델별 `pickFinalUnit` 표 → 2표 이상 일치 시 채택, Grok은 다수결 없을 때만 호출
- [ ] 개념: 주 개념 2표 이상 일치 시 채택, 보조는 §7.3 기본 규칙, 주 개념 모두 다를 때만 Grok
- [ ] 성공 모델 2개·1개·0개 및 JEV 미설정 경로 동작 확인
- [ ] 문제당 단원 정확히 1개, 주 개념 1개, 보조 ≤3, 모두 채택 단원 소속(검증 쿼리)
- [ ] `unit_decision_source`·`concept_decision_source`(majority|grok|manual) 기록
- [ ] 모든 호출이 `model_call`에 기록(모델·프롬프트 버전·토큰·비용)
- [ ] 재실행 시 override/confirmed 불변, 같은 입력 재호출 없음
- [ ] 파일럿 리포트(다수결률·Grok 호출률·경로별 정확도) 작성, 목표 수치·보조 규칙 사용자 확인
- [ ] lint/typecheck/test 통과
- [ ] 배포·push·KG 반영은 사용자 지시 후에만

## 21. 리포트 형식(실행마다 `reports/e2c-<kind>-<date>.md`)
```
실행 id / 모드 / 범위 / 프롬프트·모델 버전 / 그림자 Grok 여부
처리 N / auto N / needs_review N(사유 코드별) / error N / skipped_no_text N
단원: 3/3 N, 2/3 N, 2/2 N, Grok N(호출률 %) / 규칙 precedence N, curriculum_order N
주 개념: 3/3 N, 2/3 N, 2/2 N, Grok N(호출률 %) / 보조 개념 평균 개수
모델별 오류율·평균 지연, 성공 모델 수 분포(3/2/1/0)
비용: 모델별 토큰·USD(Grok은 cost_in_usd_ticks 합)
(파일럿) §17 지표 표
```

## 22. Open Questions
1. **보조 개념 채택 규칙(사용자 확인 필요)**: 현재 기본값은 "주 개념 제외, 역할 무관 2개 이상 모델이 제안한 개념, 최대 3개". 대안: 보조 역할로 2표 이상만 인정 / 다수결 주 개념을 낸 모델들의 보조만 사용 등.
2. 성공 모델이 2개일 때 일치하면 채택하되 `needs_review`로 둘지(현재 Y), 자동 확정할지.
3. Grok 결정 사례를 모두 `needs_review`로 둘지(현재 Y), Grok 확신도가 높으면 자동 확정할지.
4. JEV API 상세(엔드포인트, options 상한, 요금·한도, 데이터 처리 정책)와 JEV 관련 단원/보조 개념 확률 임계값(0.10/0.15).
5. `CLAUDE_MODEL`, `GEMINI_MODEL` 기본값과 각 사 batch 사용 여부.
6. §2 placeholder 실제 이름, 특히 선후 관계 방향과 문제→개념 반영 위치.
7. 시험 과목 → KG 과목 범위 매핑(교육과정·선택과목 연도별 차이).
8. 이미지 의존 문제 처리(현재 제외), 파일럿 목표 수치와 확신도 임계값.
