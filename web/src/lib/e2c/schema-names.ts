// 기출문제 원본(MariaDB) 이름 상수. e2c 코드에서 기출 테이블·컬럼 이름 문자열은 이 파일에만 둔다. docs/e2c-schema.md 참고.
export const PROBLEM_TABLE = "mathdb.question_units";
export const PROBLEM_COLS = {
  id: "id",
  statement: "raw_statement", // 문제
  note: "raw_note_statement", // 해답
  year: "release_year",
  month: "release_month",
  subscriber: "subscriber",
  subject: "apply_type",
  number: "q_order",
  points: "q_point",
  curriculumType: "curriculum_type",
  difficulty: "difficulty_level",
  classification: "classification_type",
  originDate: "origin_date",
  imgPath: "img_path",
  answer: "answer",
} as const;

// legacy 문제–개념 연결 테이블은 확인되지 않았다(힌트 경로 비활성). docs/e2c-schema.md Open Question.
export const LEGACY_PROBLEM_CONCEPT_TABLE: string | null = null;

// KG(Postgres) 이름
export const KG = {
  unitLevelPrefix: "L4-H",
  unitPrecedes: "PREREQUISITE_OF", // 단원 src → dst : src 가 앞
  subjectPrecedes: "PREREQ_OF", // 과목 src → dst : src 가 앞
  concepts: "kg.math_concepts",
  conceptUnitEdges: "kg.concept_unit_edges",
} as const;
