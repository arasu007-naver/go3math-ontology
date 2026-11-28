# JEV API (TypeSafe System One) — e2c 용 명세

e2c 는 legacy2ontology 의 JEV 선택기(`web/src/lib/server/selectors/jev.ts`)가 쓰는 API 를 그대로 쓴다. 다른 엔드포인트는 만들지 않는다. 어댑터는 `web/src/lib/e2c/adapters/jev.ts`.

## 호출

- `POST {JEV_API_URL}` (기본 `https://api.typesafe.ai/v1/systemone`)
- 인증: `Authorization: Bearer <JEV_API_KEY>` (없으면 `JEV_KEY`). 키가 없으면 호출하지 않고 `error='not_configured'` (성공 모델로 세지 않는다).
- 요청: `{ model: "jev-latest", state, questions: { q: { type: "choice", instructions, criteria: { <id>: <text> } } } }`
  - `state`: 고정 system 문구 + 문항(메타, 문제, S번호 해답)
  - `criteria`: 후보 단원 또는 후보 개념의 `id → option text`
- 응답: `answers.q.{ choice, confidence, probabilities }` (`probabilities` 는 id → 확률)

## 해석 (임계값은 `e2c.config`)

- 단원 단계: 확률 ≥ `jev_unit_min_prob`(0.10) 인 단원이 관련 단원 집합. 하나도 없으면 최고 확률 1개. 확신도 = 최고 확률.
- 개념 단계: 최고 확률 개념이 주 개념. 보조 개념은 그 다음 순위 중 확률 ≥ `jev_secondary_min_prob`(0.15) 인 것 최대 3개.
- `choice` 가 후보 밖이면 `error='out_of_candidates'`.
- 429/5xx/timeout 은 `web/src/lib/e2c/retry.ts` 로 재시도한다(1s→2s→4s→8s, 최대 5회, `Retry-After` 우선).
- JEV 는 Batch API 가 없어 batch 모드에서도 realtime 으로 호출한다. 토큰 사용량·비용은 기록하지 않는다(0).
