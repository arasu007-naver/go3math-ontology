# 컴포넌트 용어집

## 사용법

프롬프트에서 컴포넌트 이름만 말하면(예: "GraphExplorer 고쳐줘") 아래 표에서 해당 파일을 바로 찾아 작업합니다.
항목 형식은 `- **이름**: \`상대경로\``이며, 경로는 저장소 루트 기준입니다. 이름은 export 이름이고, 문서는 파일 제목입니다.
새 컴포넌트·파일을 추가하거나 옮기거나 지우면 이 문서도 함께 고칩니다.

## 진입점

- **RootLayout**: `web/src/app/layout.tsx`
- **Home**: `web/src/app/page.tsx`
- **proxy**: `web/src/proxy.ts`
- **next.config**: `web/next.config.ts`

## 페이지

- **AgentPage**: `web/src/app/agent/page.tsx`
- **AsidePage**: `web/src/app/aside/page.tsx`
- **DictionaryPage**: `web/src/app/dictionary/page.tsx`
- **GraphPage**: `web/src/app/graph/page.tsx`
- **Legacy2OntologyPage**: `web/src/app/legacy2ontology/page.tsx`
- **LoginPage**: `web/src/app/login/page.tsx`
- **MdViewerPage**: `web/src/app/md-viewer/page.tsx`
- **NetworkPage**: `web/src/app/network/page.tsx`
- **NodePage**: `web/src/app/node/page.tsx`
- **QuizViewerPage**: `web/src/app/quiz-viewer/page.tsx`
- **TablesPage**: `web/src/app/tables/page.tsx`
- **UtilitiesPage**: `web/src/app/utilities/page.tsx`

## 공용 UI

- **AgentChat**: `web/src/components/AgentChat.tsx`
- **AppHeader**: `web/src/components/AppHeader.tsx`
- **BookBars**: `web/src/components/BookBars.tsx`
- **GraphForm**: `web/src/components/GraphForm.tsx`
- **MathView**: `web/src/components/MathView.tsx`
- **NetworkView**: `web/src/components/NetworkView.tsx`
- **NodeCard**: `web/src/components/NodeCard.tsx`
- **PreviewColumn**: `web/src/components/PreviewColumn.tsx`
- **SplitMdModal**: `web/src/components/SplitMdModal.tsx`
- **TableList**: `web/src/components/TableList.tsx`
- **TableRowModal**: `web/src/components/table-row-modal.tsx`
- **TocUnitForm**: `web/src/components/TocUnitForm.tsx`
- **Legacy2OntologyClient**: `web/src/components/l2o/Legacy2OntologyClient.tsx`
- **GroupEditDialog**: `web/src/components/l2o/GroupEditDialog.tsx`
- **HistoryDialog**: `web/src/components/l2o/HistoryDialog.tsx`
- **JobProgress**: `web/src/components/l2o/JobProgress.tsx`
- **MigrateAllDialog**: `web/src/components/l2o/MigrateAllDialog.tsx`
- **UnitDecisionDialog**: `web/src/components/l2o/UnitDecisionDialog.tsx`

## 시각화

- **GraphExplorer**: `web/src/components/graph/GraphExplorer.tsx`
- **GraphCanvas**: `web/src/components/graph/GraphCanvas.tsx`
- **GraphInspector**: `web/src/components/graph/GraphInspector.tsx`
- **GraphLeftSidebar**: `web/src/components/graph/GraphLeftSidebar.tsx`
- **GraphLegendBar**: `web/src/components/graph/GraphLegendBar.tsx`
- **GraphToolbar**: `web/src/components/graph/GraphToolbar.tsx`
- **GraphLayouts**: `web/src/components/graph/layouts.ts`
- **knowledge_graph_math_chapters.html**: `knowledge_graph_math_chapters.html`

## 데이터

- **schema.sql**: `web/db/schema.sql`
- **l2o-schema.sql**: `web/db/l2o-schema.sql`
- **curriculum-seed.json**: `web/db/curriculum-seed.json`
- **level-high.json**: `web/db/level-high.json`
- **level-middle.json**: `web/db/level-middle.json`
- **level-prereq.json**: `web/db/level-prereq.json`
- **viaedu-junghak1-to-giha.json**: `resources/viaedu-junghak1-to-giha.json`
- **subject-grades.json**: `scripts/migrate-math-concepts/subject-grades.json`
- **SampleQuiz**: `web/src/lib/sample-quiz.ts`
- **Types**: `web/src/lib/types.ts`
- **L2oTypes**: `web/src/lib/l2o/types.ts`

## 상태

해당 없음 (전역 상태 관리 라이브러리·Context를 쓰지 않음)

## API

- **api**: `web/src/lib/api.ts`
- **ocrApi**: `web/src/lib/ocrApi.ts`
- **officeManager**: `web/src/lib/server/officeManager.ts`
- **mathpix**: `web/src/lib/server/mathpix.ts`
- **s3**: `web/src/lib/server/s3.ts`
- **embedding**: `web/src/lib/server/embedding.ts`
- **localLlm**: `web/src/lib/server/localLlm.ts`
- **jev**: `web/src/lib/server/jev.ts`
- **claudeSelector**: `web/src/lib/server/selectors/claude.ts`
- **geminiSelector**: `web/src/lib/server/selectors/gemini.ts`
- **jevSelector**: `web/src/lib/server/selectors/jev.ts`
- **selectorCommon**: `web/src/lib/server/selectors/common.ts`
- **graphDb**: `web/src/lib/graphDb.ts`
- **dictionaryDb**: `web/src/lib/dictionaryDb.ts`
- **legacyDb**: `web/src/lib/server/legacyDb.ts`
- **kgGraphQueries**: `web/src/lib/server/kgGraphQueries.ts`
- **l2oDb**: `web/src/lib/server/l2oDb.ts`
- **l2oPool**: `web/src/lib/server/l2oPool.ts`
- **l2oDedupe**: `web/src/lib/server/l2oDedupe.ts`
- **l2oJobs**: `web/src/lib/server/l2oJobs.ts`
- **l2oKg**: `web/src/lib/server/l2oKg.ts`
- **l2oOverride**: `web/src/lib/server/l2oOverride.ts`
- **l2oSelect**: `web/src/lib/server/l2oSelect.ts`
- **l2oUnits**: `web/src/lib/server/l2oUnits.ts`
- **agentPrompt**: `web/src/lib/server/agentPrompt.ts`
- **agentQuery**: `web/src/lib/server/agentQuery.ts`
- **agentTemplates**: `web/src/lib/server/agentTemplates.ts`
- **dictionaryPipeline**: `web/src/lib/server/dictionaryPipeline.ts`
- **serverConceptOrder**: `web/src/lib/server/conceptOrder.ts`
- **auth**: `web/src/lib/server/auth.ts`
- **session**: `web/src/lib/server/session.ts`
- **API 라우트 루트**: `web/src/app/api`

## 유틸

- **bookIndices**: `web/src/lib/bookIndices.ts`
- **conceptOrder**: `web/src/lib/conceptOrder.ts`
- **format**: `web/src/lib/format.ts`
- **toc**: `web/src/lib/toc.ts`
- **l2oDedupeUtil**: `web/src/lib/l2o/dedupe.ts`
- **l2oUnitsUtil**: `web/src/lib/l2o/units.ts`

## 문서

- **Go3 Math Ontology Design Spec**: `DESIGN.md`
- **조회 에이전트 명세: Neo4j**: `agent-spec.md`
- **Level 명세**: `level-spec.md`
- **Level 1 명세**: `spec-level-1.md`
- **Go3 Math Ontology**: `go3math-ontology-26-10-05.md`
- **exam_problems2concepts**: `specs/exam_problems2concepts.md`
- **실행 가이드: NotebookLM 단원 콘텐츠 자동화**: `specs/execution-spec.md`
- **Knowledge Graph DB 시각화 페이지 스펙**: `specs/knowledge-graph-visualization.md`
- **math-concepts-to-kg-mapping-spec**: `specs/math-concepts-to-kg-mapping-spec.md`
- **math_concepts2ontology**: `specs/math_concepts2ontology.md`
- **notebooklm-chapter-content-automation-spec**: `specs/notebooklm-chapter-content-automation-spec.md`
- **색인통합프롬프트**: `specs/색인통합프롬프트.md`
- **수학내적프롬프트**: `specs/수학내적프롬프트.md`
- **수학외적프롬프트**: `specs/수학외적프롬프트.md`
- **NotebookLM & 온톨로지 딕셔너리 구축 가이드**: `web/notebooklm.md`
- **go3math-ontology web**: `web/README.md`
