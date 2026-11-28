// e2c.config 기본값. 같은 key 가 e2c.config 테이블에 있으면 그 값이 덮어쓴다.
export type E2cConfig = {
  jev_unit_min_prob: number;
  jev_secondary_min_prob: number;
  unit_low_conf: number; // 채택 단원 지지 모델 평균 확신도가 이 값 미만이면 unit_low_conf
  concept_low_conf: number; // 채택 주 개념 지지 모델 평균 확신도가 이 값 미만이면 concept_low_conf
  max_unit_candidates: number;
  max_concept_options: number;
  max_secondary: number;
  subject_map: Record<string, string[]>;
  pricing: Record<string, Pricing>;
};
// USD / 1M 토큰
export type Pricing = { input: number; output: number; cachedInput: number; cacheWrite: number; batchDiscount: number };

export const DEFAULT_CONFIG: E2cConfig = {
  jev_unit_min_prob: 0.1,
  jev_secondary_min_prob: 0.15,
  unit_low_conf: 0.5,
  concept_low_conf: 0.6,
  max_unit_candidates: 15,
  max_concept_options: Number(process.env.E2C_MAX_CONCEPT_OPTIONS) || 40,
  max_secondary: 3,
  subject_map: {
    COMMON: ["L4-HALG", "L4-HCAL1"],
    CALCULUS: ["L4-HCAL2"],
    STATISTICS: ["L4-HPS"],
    GEOMETRY: ["L4-HGEO"],
  },
  // 공식 요금 기준 기본값(변동 가능 — e2c.config 'pricing' 으로 덮어쓴다). batchDiscount: Batch 요금 배율
  pricing: {
    claude: { input: 3, output: 15, cachedInput: 0.3, cacheWrite: 3.75, batchDiscount: 0.5 },
    gemini: { input: 1.25, output: 10, cachedInput: 0.31, cacheWrite: 0, batchDiscount: 0.5 },
    grok: { input: 3, output: 15, cachedInput: 0.75, cacheWrite: 0, batchDiscount: 0.5 },
    jev: { input: 0, output: 0, cachedInput: 0, cacheWrite: 0, batchDiscount: 1 },
  },
};

export const mergeConfig = (rows: Record<string, unknown>): E2cConfig => ({ ...DEFAULT_CONFIG, ...(rows as Partial<E2cConfig>) });

export const PROMPT_VERSIONS = {
  unit: "e2c-unit-v2",
  concept: "e2c-concept-v2",
  grok_unit: "e2c-grok-unit-v2",
  grok_concept: "e2c-grok-concept-v2",
} as const;
