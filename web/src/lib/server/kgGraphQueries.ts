import { withReadOnly } from "@/lib/graphDb";
import { stripHtml } from "@/lib/server/legacyDb";

const IMG_BASE = "https://qoolla1storage1account.blob.core.windows.net/qoollastoragecontainer/math-files/images";

export type GraphNodeType =
  | "level"
  | "level_toc"
  | "concept"
  | "achievement"
  | "book"
  | "toc"
  | "page"
  | "paragraph";

export type GraphEdgeType =
  | "HAS_CHILD"
  | "BELONGS_TO_AREA"
  | "PREREQUISITE_OF"
  | "APPLIES_TO"
  | "DESCRIBES"
  | "CONCEPT_IN_UNIT"
  | "CONCEPT_PREREQ_OF"
  | "HAS_ACHIEVEMENT"
  | "MAPS_TO"
  | "HAS_TOC"
  | "POINTS_TO"
  | "HAS_PARAGRAPH"
  | "ANSWERS";

export type GraphNodeDTO = {
  id: string;
  nodeType: GraphNodeType;
  label: string;
  level?: number;
  order?: number;
  category?: string | null;
  kind?: string | null;
  grade?: number | null;
  school?: string | null;
  revisedCurriculum?: number | null;
  areas?: string[];
  areaId?: string | null;
  childCount?: number;
  conceptCount?: number;
  tocCount?: number;
  mapCount?: number;
  // concept 전용
  conceptId?: number;
  sourceId?: number;
  mergedCount?: number;
  conceptType?: string | null;
  mathField?: string | null;
  difficultyLevel?: number | null;
  unitId?: string | null;
  // book / toc / page / paragraph 전용
  bookStem?: string;
  bookTitle?: string;
  tocPage?: number | null;
  page?: number | null;
  pageKind?: string | null;
  rootUnitId?: string | null;
  snippet?: string | null;
};

export type GraphEdgeDTO = {
  id: string;
  src: string;
  dst: string;
  edgeType: GraphEdgeType;
  isPrimary?: boolean;
  confidence?: number | null;
  judgedBy?: string | null;
};

export type BookSummaryItem = {
  id: string;
  stem: string;
  title: string;
  tocUnitCount: number;
  dictCount: number;
  quizCount: number;
  flashcardCount: number;
};

export type GraphOverviewResponse = {
  stats: {
    levelCount: number;
    tocUnitCount: number;
    conceptCount: number;
    activeConceptEdgeCount: number;
    prereqEdgeCount: number;
    bookCount: number;
    dictionaryCount: number;
    quizCount: number;
  };
  books: BookSummaryItem[];
  nodes: GraphNodeDTO[];
  edges: GraphEdgeDTO[];
};

function extractImages(html: string | null, imgPath: string | null): string[] {
  if (!html || !imgPath) return [];
  const ids = [...html.matchAll(/hwp-img-id=\\?"([^"\\]+)/g)].map((m) => m[1]);
  return [...new Set(ids)].map((id) => `${IMG_BASE}/${imgPath}/${id}.jpg`);
}

export async function getGraphOverview(opts: {
  includeConcepts?: boolean;
  includeBooks?: boolean;
  areaId?: string;
}): Promise<GraphOverviewResponse> {
  return withReadOnly(async (c) => {
    const reg = (
      await c.query<{
        mc: boolean;
        cue: boolean;
        cp: boolean;
        ca: boolean;
      }>(`
        SELECT to_regclass('kg.math_concepts') IS NOT NULL AS mc,
               to_regclass('kg.concept_unit_edges') IS NOT NULL AS cue,
               to_regclass('kg.concept_prerequisites') IS NOT NULL AS cp,
               to_regclass('kg.concept_achievements') IS NOT NULL AS ca
      `)
    ).rows[0];

    // 1. 통계 집계
    const baseStats = (
      await c.query<{
        level_count: number;
        toc_unit_count: number;
        prereq_edge_count: number;
        dict_count: number;
        quiz_count: number;
      }>(`
        SELECT
          (SELECT COUNT(*)::int FROM kg.nodes WHERE type = 'level' AND COALESCE(props->>'category', '') <> 'TOC') AS level_count,
          (SELECT COUNT(*)::int FROM kg.nodes WHERE type = 'level' AND props->>'category' = 'TOC') AS toc_unit_count,
          (SELECT COUNT(*)::int FROM kg.edges WHERE type = 'PREREQUISITE_OF') AS prereq_edge_count,
          (SELECT COUNT(*)::int FROM kg.dictionary) AS dict_count,
          (SELECT COUNT(*)::int FROM kg.quizzes) AS quiz_count
      `)
    ).rows[0];

    let conceptCount = 0;
    let activeConceptEdgeCount = 0;
    let conceptPrereqCount = 0;
    if (reg.mc) {
      conceptCount = (await c.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM kg.math_concepts WHERE source_id > 0`)).rows[0].n;
    }
    if (reg.cue) {
      activeConceptEdgeCount = (await c.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM kg.concept_unit_edges WHERE is_active = true`)).rows[0].n;
    }
    if (reg.cp) {
      conceptPrereqCount = (await c.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM kg.concept_prerequisites`)).rows[0].n;
    }

    // 도서 목록 요약 (kg.nodes book + toc_unit_links + dictionary/quizzes/flashcards)
    const bookRows = (
      await c.query<{
        stem: string;
        title: string;
        toc_unit_count: number;
        dict_count: number;
        quiz_count: number;
        fc_count: number;
      }>(`
        WITH all_stems AS (
          SELECT COALESCE(props->>'stem', regexp_replace(id, '^book:', '')) AS stem,
                 COALESCE(props->>'title', regexp_replace(id, '^book:', '')) AS title
            FROM kg.nodes WHERE type = 'book'
          UNION
          SELECT book_stem AS stem, MAX(book_title) AS title FROM kg.toc_unit_links GROUP BY book_stem
          UNION
          SELECT book_stem AS stem, COALESCE(MAX(book_title), book_stem) AS title FROM kg.dictionary GROUP BY book_stem
          UNION
          SELECT book_stem AS stem, COALESCE(MAX(book_title), book_stem) AS title FROM kg.quizzes GROUP BY book_stem
        ),
        dedup AS (
          SELECT stem, MAX(title) AS title FROM all_stems WHERE stem IS NOT NULL AND length(btrim(stem)) > 0 GROUP BY stem
        )
        SELECT d.stem,
               d.title,
               (SELECT COUNT(*)::int FROM kg.toc_unit_links tl WHERE tl.book_stem = d.stem) AS toc_unit_count,
               (SELECT COUNT(*)::int FROM kg.dictionary dc WHERE dc.book_stem = d.stem) AS dict_count,
               (SELECT COUNT(*)::int FROM kg.quizzes qz WHERE qz.book_stem = d.stem) AS quiz_count,
               (SELECT COUNT(*)::int FROM kg.flashcards fc WHERE fc.book_stem = d.stem) AS fc_count
          FROM dedup d
         ORDER BY toc_unit_count DESC, dict_count DESC, d.title
      `)
    ).rows;

    const books: BookSummaryItem[] = bookRows.map((b) => ({
      id: `book:${b.stem}`,
      stem: b.stem,
      title: b.title || b.stem,
      tocUnitCount: b.toc_unit_count,
      dictCount: b.dict_count,
      quizCount: b.quiz_count,
      flashcardCount: b.fc_count,
    }));

    // 2. Level 노드 (단원 + 단원 TOC)
    const conceptCountExpr = reg.cue
      ? `(SELECT COUNT(*)::int FROM kg.concept_unit_edges ce WHERE ce.unit_id = n.id AND ce.is_active = true)`
      : `0`;

    const levelRows = (
      await c.query<{
        id: string;
        level: number;
        name: string;
        order: number;
        category: string | null;
        grade: number | null;
        school: string | null;
        revisedCurriculum: number | null;
        kind: string | null;
        areas: string[];
        childCount: number;
        conceptCount: number;
        tocCount: number;
        mapCount: number;
        bookStem: string | null;
        bookTitle: string | null;
        tocPage: number | null;
        page: number | null;
        pageKind: string | null;
        rootUnitId: string | null;
      }>(`
        SELECT n.id,
               (n.props->>'level')::int AS level,
               n.props->>'name' AS name,
               COALESCE((n.props->>'order')::int, 0) AS "order",
               n.props->>'category' AS category,
               (n.props->>'grade')::int AS grade,
               n.props->>'school' AS school,
               (n.props->>'revisedCurriculum')::int AS "revisedCurriculum",
               n.props->>'kind' AS kind,
               ARRAY(
                 SELECT a.dst FROM kg.edges a JOIN kg.nodes l ON l.id = a.dst
                 WHERE a.src = n.id AND a.type = 'BELONGS_TO_AREA'
                 ORDER BY (l.props->>'order')::int
               ) AS areas,
               (SELECT COUNT(*)::int FROM kg.edges c WHERE c.src = n.id AND c.type = 'HAS_CHILD') AS "childCount",
               ${conceptCountExpr} AS "conceptCount",
               (SELECT COUNT(*)::int FROM kg.toc_unit_links tl WHERE tl.unit_id = n.id) AS "tocCount",
               (SELECT COUNT(*)::int FROM kg.edges m WHERE m.dst = n.id AND m.type = 'MAPS_TO') AS "mapCount",
               tl.book_stem AS "bookStem",
               tl.book_title AS "bookTitle",
               tl.toc_page AS "tocPage",
               tl.page AS page,
               tl.page_kind AS "pageKind",
               tl.root_unit_id AS "rootUnitId"
          FROM kg.nodes n
          LEFT JOIN kg.toc_unit_links tl ON tl.node_id = n.id
         WHERE n.type = 'level'
         ORDER BY level, n.props->>'category' = '과목', "order", n.id
      `)
    ).rows;

    const nodes: GraphNodeDTO[] = levelRows.map((r) => {
      const isToc = r.category === "TOC";
      return {
        id: r.id,
        nodeType: isToc ? "level_toc" : "level",
        label: r.name,
        level: r.level,
        order: r.order,
        category: r.category,
        kind: r.kind,
        grade: r.grade,
        school: r.school,
        revisedCurriculum: r.revisedCurriculum,
        areas: r.areas ?? [],
        childCount: r.childCount,
        conceptCount: r.conceptCount,
        tocCount: r.tocCount,
        mapCount: r.mapCount,
        bookStem: r.bookStem ?? undefined,
        bookTitle: r.bookTitle ?? undefined,
        tocPage: r.tocPage,
        page: r.page,
        pageKind: r.pageKind,
        rootUnitId: r.rootUnitId,
      };
    });

    // 3. Level 간선
    const edgeRows = (
      await c.query<{ src: string; dst: string; type: GraphEdgeType }>(`
        SELECT src, dst, type
          FROM kg.edges
         WHERE type IN ('HAS_CHILD', 'BELONGS_TO_AREA', 'PREREQUISITE_OF', 'APPLIES_TO', 'DESCRIBES')
           AND src ~ '^L[1-9]-' AND dst ~ '^L[1-9]-'
      `)
    ).rows;

    const edges: GraphEdgeDTO[] = edgeRows.map((e) => ({
      id: `${e.type}|${e.src}|${e.dst}`,
      src: e.src,
      dst: e.dst,
      edgeType: e.type,
    }));

    // 4. 선택적 개념 노드 포함
    if (opts.includeConcepts && reg.mc && reg.cue) {
      const cRows = (
        await c.query<{
          id: number;
          source_id: number;
          merged_count: number;
          title: string;
          concept_type: string | null;
          math_field: string | null;
          school_type: string | null;
          difficulty_level: number | null;
          unit_id: string;
          is_primary: boolean;
          confidence: string | null;
          judged_by: string | null;
        }>(`
          SELECT mc.id::int,
                 mc.source_id,
                 cardinality(mc.merged_source_ids)::int AS merged_count,
                 mc.title,
                 mc.concept_type,
                 mc.math_field,
                 mc.school_type,
                 mc.difficulty_level,
                 ce.unit_id,
                 ce.is_primary,
                 ce.confidence::text,
                 ce.judged_by
            FROM kg.concept_unit_edges ce
            JOIN kg.math_concepts mc ON mc.id = ce.concept_id
           WHERE ce.is_active = true AND mc.source_id > 0
           ORDER BY ce.is_primary DESC, mc.id ASC
           LIMIT 600
        `)
      ).rows;

      const seenConcepts = new Set<number>();
      for (const r of cRows) {
        const cid = `concept:${r.id}`;
        if (!seenConcepts.has(r.id)) {
          seenConcepts.add(r.id);
          nodes.push({
            id: cid,
            nodeType: "concept",
            label: stripHtml(r.title) || `개념 #${r.source_id}`,
            conceptId: r.id,
            sourceId: r.source_id,
            mergedCount: r.merged_count,
            conceptType: r.concept_type,
            mathField: r.math_field,
            school: r.school_type,
            difficultyLevel: r.difficulty_level,
            unitId: r.unit_id,
          });
        }
        edges.push({
          id: `CONCEPT_UNIT|${r.id}|${r.unit_id}`,
          src: cid,
          dst: r.unit_id,
          edgeType: "CONCEPT_IN_UNIT",
          isPrimary: r.is_primary,
          confidence: r.confidence != null ? Number(r.confidence) : null,
          judgedBy: r.judged_by,
        });
      }

      if (reg.cp && seenConcepts.size > 0) {
        const cIds = [...seenConcepts];
        const cpRows = (
          await c.query<{ src: number; dst: number; judged_by: string }>(`
            SELECT src_concept_id::int AS src, dst_concept_id::int AS dst, judged_by
              FROM kg.concept_prerequisites
             WHERE src_concept_id = ANY($1::int[]) AND dst_concept_id = ANY($1::int[])
          `, [cIds])
        ).rows;
        for (const cp of cpRows) {
          edges.push({
            id: `CONCEPT_PREREQ|${cp.src}|${cp.dst}`,
            src: `concept:${cp.src}`,
            dst: `concept:${cp.dst}`,
            edgeType: "CONCEPT_PREREQ_OF",
            judgedBy: cp.judged_by,
          });
        }
      }
    }

    // 5. 선택적 도서 노드 포함
    if (opts.includeBooks) {
      for (const b of books) {
        nodes.push({
          id: b.id,
          nodeType: "book",
          label: b.title,
          bookStem: b.stem,
          bookTitle: b.title,
          tocCount: b.tocUnitCount,
        });
      }
      const bookUnitLinks = (
        await c.query<{ book_stem: string; root_unit_id: string }>(`
          SELECT DISTINCT book_stem, root_unit_id FROM kg.toc_unit_links WHERE root_unit_id IS NOT NULL
        `)
      ).rows;
      for (const l of bookUnitLinks) {
        const bid = `book:${l.book_stem}`;
        edges.push({
          id: `MAPS_TO|${bid}|${l.root_unit_id}`,
          src: bid,
          dst: l.root_unit_id,
          edgeType: "MAPS_TO",
        });
      }
    }

    return {
      stats: {
        levelCount: baseStats.level_count,
        tocUnitCount: baseStats.toc_unit_count,
        conceptCount,
        activeConceptEdgeCount,
        prereqEdgeCount: baseStats.prereq_edge_count + conceptPrereqCount,
        bookCount: books.length,
        dictionaryCount: baseStats.dict_count,
        quizCount: baseStats.quiz_count,
      },
      books,
      nodes,
      edges,
    };
  });
}

export async function getNodeSubgraph(opts: {
  nodeId: string;
  types?: string[];
  limit?: number;
}): Promise<{ nodes: GraphNodeDTO[]; edges: GraphEdgeDTO[]; truncated: boolean }> {
  const { nodeId, limit = 150 } = opts;
  const want = new Set(opts.types?.length ? opts.types : ["concepts", "children", "prereqs", "books", "pages", "paragraphs"]);

  return withReadOnly(async (c) => {
    const reg = (
      await c.query<{ mc: boolean; cue: boolean; cp: boolean; ca: boolean }>(`
        SELECT to_regclass('kg.math_concepts') IS NOT NULL AS mc,
               to_regclass('kg.concept_unit_edges') IS NOT NULL AS cue,
               to_regclass('kg.concept_prerequisites') IS NOT NULL AS cp,
               to_regclass('kg.concept_achievements') IS NOT NULL AS ca
      `)
    ).rows[0];

    const nodes = new Map<string, GraphNodeDTO>();
    const edges = new Map<string, GraphEdgeDTO>();
    let truncated = false;

    const addNode = (n: GraphNodeDTO) => {
      if (nodes.size >= limit && !nodes.has(n.id)) {
        truncated = true;
        return false;
      }
      nodes.set(n.id, n);
      return true;
    };
    const addEdge = (e: GraphEdgeDTO) => {
      edges.set(e.id, e);
    };

    // Case 1: Level 또는 Level TOC 노드 (L1-~L9-)
    if (/^L[1-9]-/.test(nodeId)) {
      // 직계 하위 또는 상위/연결 level 노드
      if (want.has("children") || want.has("prereqs")) {
        const lRows = (
          await c.query<{
            id: string;
            level: number;
            name: string;
            order: number;
            category: string | null;
            grade: number | null;
            school: string | null;
            kind: string | null;
            edge_type: GraphEdgeType;
            dir: "out" | "in";
          }>(`
            SELECT n.id,
                   (n.props->>'level')::int AS level,
                   n.props->>'name' AS name,
                   COALESCE((n.props->>'order')::int, 0) AS "order",
                   n.props->>'category' AS category,
                   (n.props->>'grade')::int AS grade,
                   n.props->>'school' AS school,
                   n.props->>'kind' AS kind,
                   e.type AS edge_type,
                   CASE WHEN e.src = $1 THEN 'out' ELSE 'in' END AS dir
              FROM kg.edges e
              JOIN kg.nodes n ON n.id = CASE WHEN e.src = $1 THEN e.dst ELSE e.src END
             WHERE (e.src = $1 OR e.dst = $1)
               AND n.type = 'level'
               AND e.type IN ('HAS_CHILD', 'PREREQUISITE_OF', 'APPLIES_TO', 'DESCRIBES')
             LIMIT $2
          `, [nodeId, limit])
        ).rows;

        for (const r of lRows) {
          addNode({
            id: r.id,
            nodeType: r.category === "TOC" ? "level_toc" : "level",
            label: r.name,
            level: r.level,
            order: r.order,
            category: r.category,
            grade: r.grade,
            school: r.school,
            kind: r.kind,
          });
          const src = r.dir === "out" ? nodeId : r.id;
          const dst = r.dir === "out" ? r.id : nodeId;
          addEdge({
            id: `${r.edge_type}|${src}|${dst}`,
            src,
            dst,
            edgeType: r.edge_type,
          });
        }
      }

      // 이 단원(또는 과목/영역이면 직계 하위 대단원 포함)에 매핑된 수학 개념
      if (want.has("concepts") && reg.mc && reg.cue) {
        const cRows = (
          await c.query<{
            id: number;
            source_id: number;
            merged_count: number;
            title: string;
            concept_type: string | null;
            math_field: string | null;
            school_type: string | null;
            difficulty_level: number | null;
            unit_id: string;
            is_primary: boolean;
            confidence: string | null;
            judged_by: string | null;
          }>(`
            WITH target_units AS (
              SELECT $1::text AS uid
              UNION
              SELECT e.dst FROM kg.edges e WHERE e.src = $1 AND e.type = 'HAS_CHILD'
            )
            SELECT mc.id::int,
                   mc.source_id,
                   cardinality(mc.merged_source_ids)::int AS merged_count,
                   mc.title,
                   mc.concept_type,
                   mc.math_field,
                   mc.school_type,
                   mc.difficulty_level,
                   ce.unit_id,
                   ce.is_primary,
                   ce.confidence::text,
                   ce.judged_by
              FROM kg.concept_unit_edges ce
              JOIN kg.math_concepts mc ON mc.id = ce.concept_id
             WHERE ce.is_active = true
               AND mc.source_id > 0
               AND ce.unit_id IN (SELECT uid FROM target_units)
             ORDER BY (ce.unit_id = $1) DESC, ce.is_primary DESC, mc.id ASC
             LIMIT $2
          `, [nodeId, limit])
        ).rows;

        const cIds: number[] = [];
        for (const r of cRows) {
          const cid = `concept:${r.id}`;
          if (
            addNode({
              id: cid,
              nodeType: "concept",
              label: stripHtml(r.title) || `개념 #${r.source_id}`,
              conceptId: r.id,
              sourceId: r.source_id,
              mergedCount: r.merged_count,
              conceptType: r.concept_type,
              mathField: r.math_field,
              school: r.school_type,
              difficultyLevel: r.difficulty_level,
              unitId: r.unit_id,
            })
          ) {
            cIds.push(r.id);
            addEdge({
              id: `CONCEPT_UNIT|${r.id}|${r.unit_id}`,
              src: cid,
              dst: r.unit_id,
              edgeType: "CONCEPT_IN_UNIT",
              isPrimary: r.is_primary,
              confidence: r.confidence != null ? Number(r.confidence) : null,
              judgedBy: r.judged_by,
            });
          }
        }

        if (reg.cp && cIds.length > 0) {
          const cpRows = (
            await c.query<{ src: number; dst: number; judged_by: string }>(`
              SELECT src_concept_id::int AS src, dst_concept_id::int AS dst, judged_by
                FROM kg.concept_prerequisites
               WHERE src_concept_id = ANY($1::int[]) OR dst_concept_id = ANY($1::int[])
               LIMIT 100
            `, [cIds])
          ).rows;
          for (const cp of cpRows) {
            addEdge({
              id: `CONCEPT_PREREQ|${cp.src}|${cp.dst}`,
              src: `concept:${cp.src}`,
              dst: `concept:${cp.dst}`,
              edgeType: "CONCEPT_PREREQ_OF",
              judgedBy: cp.judged_by,
            });
          }
        }
      }

      // 연결된 도서
      if (want.has("books")) {
        const bRows = (
          await c.query<{ book_stem: string; book_title: string; unit_id: string }>(`
            SELECT DISTINCT book_stem, book_title, unit_id
              FROM kg.toc_unit_links
             WHERE unit_id = $1 OR root_unit_id = $1 OR node_id = $1
             LIMIT 30
          `, [nodeId])
        ).rows;
        for (const b of bRows) {
          const bid = `book:${b.book_stem}`;
          addNode({
            id: bid,
            nodeType: "book",
            label: b.book_title || b.book_stem,
            bookStem: b.book_stem,
            bookTitle: b.book_title,
          });
          addEdge({
            id: `MAPS_TO|${bid}|${nodeId}`,
            src: bid,
            dst: nodeId,
            edgeType: "MAPS_TO",
          });
        }
      }
    }

    // Case 2: 수학 개념 노드 (concept:{id})
    else if (nodeId.startsWith("concept:") && reg.mc) {
      const cidNum = Number.parseInt(nodeId.replace("concept:", ""), 10);
      if (Number.isFinite(cidNum)) {
        if (reg.cue) {
          const uRows = (
            await c.query<{
              unit_id: string;
              is_primary: boolean;
              confidence: string | null;
              judged_by: string | null;
              level: number;
              name: string;
              category: string | null;
            }>(`
              SELECT ce.unit_id, ce.is_primary, ce.confidence::text, ce.judged_by,
                     (n.props->>'level')::int AS level, n.props->>'name' AS name, n.props->>'category' AS category
                FROM kg.concept_unit_edges ce
                JOIN kg.nodes n ON n.id = ce.unit_id
               WHERE ce.concept_id = $1 AND ce.is_active = true
            `, [cidNum])
          ).rows;
          for (const u of uRows) {
            addNode({
              id: u.unit_id,
              nodeType: u.category === "TOC" ? "level_toc" : "level",
              label: u.name,
              level: u.level,
              category: u.category,
            });
            addEdge({
              id: `CONCEPT_UNIT|${cidNum}|${u.unit_id}`,
              src: nodeId,
              dst: u.unit_id,
              edgeType: "CONCEPT_IN_UNIT",
              isPrimary: u.is_primary,
              confidence: u.confidence != null ? Number(u.confidence) : null,
              judgedBy: u.judged_by,
            });
          }
        }

        if (reg.cp) {
          const cpRows = (
            await c.query<{
              other_id: number;
              source_id: number;
              title: string;
              concept_type: string | null;
              dir: "prereq" | "next";
              judged_by: string;
            }>(`
              SELECT mc.id::int AS other_id, mc.source_id, mc.title, mc.concept_type,
                     CASE WHEN cp.dst_concept_id = $1 THEN 'prereq' ELSE 'next' END AS dir,
                     cp.judged_by
                FROM kg.concept_prerequisites cp
                JOIN kg.math_concepts mc ON mc.id = CASE WHEN cp.dst_concept_id = $1 THEN cp.src_concept_id ELSE cp.dst_concept_id END
               WHERE cp.src_concept_id = $1 OR cp.dst_concept_id = $1
            `, [cidNum])
          ).rows;
          for (const r of cpRows) {
            const oid = `concept:${r.other_id}`;
            addNode({
              id: oid,
              nodeType: "concept",
              label: stripHtml(r.title) || `개념 #${r.source_id}`,
              conceptId: r.other_id,
              sourceId: r.source_id,
              conceptType: r.concept_type,
            });
            const src = r.dir === "prereq" ? oid : nodeId;
            const dst = r.dir === "prereq" ? nodeId : oid;
            addEdge({
              id: `CONCEPT_PREREQ|${src.replace("concept:", "")}|${dst.replace("concept:", "")}`,
              src,
              dst,
              edgeType: "CONCEPT_PREREQ_OF",
              judgedBy: r.judged_by,
            });
          }
        }

        if (reg.ca) {
          const aRows = (
            await c.query<{ achievement_code: string; judged_by: string }>(`
              SELECT achievement_code, judged_by FROM kg.concept_achievements WHERE concept_id = $1
            `, [cidNum])
          ).rows;
          for (const a of aRows) {
            const aid = `ach:${a.achievement_code}`;
            addNode({
              id: aid,
              nodeType: "achievement",
              label: a.achievement_code,
            });
            addEdge({
              id: `ACH|${cidNum}|${a.achievement_code}`,
              src: nodeId,
              dst: aid,
              edgeType: "HAS_ACHIEVEMENT",
              judgedBy: a.judged_by,
            });
          }
        }
      }
    }

    // Case 3: 도서 / TOC / 페이지 / 문단 노드
    else if (nodeId.startsWith("book:")) {
      const stem = nodeId.replace(/^book:/, "");
      const linkRows = (
        await c.query<{
          node_id: string | null;
          unit_id: string;
          root_unit_id: string;
          toc_label: string;
          toc_page: number | null;
          page: number | null;
        }>(`
          SELECT node_id, unit_id, root_unit_id, toc_label, toc_page, page
            FROM kg.toc_unit_links
           WHERE book_stem = $1
           ORDER BY id ASC
           LIMIT $2
        `, [stem, limit])
      ).rows;
      for (const l of linkRows) {
        const targetId = l.node_id || l.unit_id;
        addEdge({
          id: `MAPS_TO|${nodeId}|${targetId}`,
          src: nodeId,
          dst: targetId,
          edgeType: "MAPS_TO",
        });
      }

      // kg.nodes 에 저장된 도서 하위 TOC/페이지
      const childRows = (
        await c.query<{ id: string; type: string; props: Record<string, unknown>; edge_type: GraphEdgeType }>(`
          SELECT n.id, n.type, n.props, e.type AS edge_type
            FROM kg.edges e JOIN kg.nodes n ON n.id = e.dst
           WHERE e.src = $1
           LIMIT $2
        `, [nodeId, limit])
      ).rows;
      for (const r of childRows) {
        addNode({
          id: r.id,
          nodeType: (r.type as GraphNodeType) || "toc",
          label: String(r.props.label ?? r.props.title ?? r.id),
          bookStem: stem,
          page: typeof r.props.page === "number" ? r.props.page : null,
        });
        addEdge({
          id: `${r.edge_type}|${nodeId}|${r.id}`,
          src: nodeId,
          dst: r.id,
          edgeType: r.edge_type,
        });
      }
    } else {
      // 일반 kg.nodes (toc:, page:, para:) 1-hop 이웃
      const nbRows = (
        await c.query<{
          id: string;
          type: string;
          props: Record<string, unknown>;
          edge_type: GraphEdgeType;
          dir: "out" | "in";
        }>(`
          SELECT n.id, n.type, n.props, e.type AS edge_type,
                 CASE WHEN e.src = $1 THEN 'out' ELSE 'in' END AS dir
            FROM kg.edges e
            JOIN kg.nodes n ON n.id = CASE WHEN e.src = $1 THEN e.dst ELSE e.src END
           WHERE e.src = $1 OR e.dst = $1
           LIMIT $2
        `, [nodeId, limit])
      ).rows;
      for (const r of nbRows) {
        const label =
          (r.props.name as string) ||
          (r.props.label as string) ||
          (r.props.title as string) ||
          (r.type === "page" ? `${r.props.page}p (${r.props.kind})` : "") ||
          (r.type === "paragraph" ? `${r.props.kind} #${Number(r.props.idx ?? 0) + 1}` : r.id);
        addNode({
          id: r.id,
          nodeType: (r.type === "level" && r.props.category === "TOC" ? "level_toc" : r.type) as GraphNodeType,
          label,
          kind: (r.props.kind as string) ?? null,
          category: (r.props.category as string) ?? null,
          page: typeof r.props.page === "number" ? r.props.page : null,
          snippet: typeof r.props.content === "string" ? r.props.content.slice(0, 80) : null,
        });
        const src = r.dir === "out" ? nodeId : r.id;
        const dst = r.dir === "out" ? r.id : nodeId;
        addEdge({
          id: `${r.edge_type}|${src}|${dst}`,
          src,
          dst,
          edgeType: r.edge_type,
        });
      }
    }

    return {
      nodes: [...nodes.values()],
      edges: [...edges.values()],
      truncated,
    };
  });
}

export async function getGraphNodeDetail(id: string) {
  return withReadOnly(async (c) => {
    const reg = (
      await c.query<{ mc: boolean; cue: boolean; cp: boolean; ca: boolean }>(`
        SELECT to_regclass('kg.math_concepts') IS NOT NULL AS mc,
               to_regclass('kg.concept_unit_edges') IS NOT NULL AS cue,
               to_regclass('kg.concept_prerequisites') IS NOT NULL AS cp,
               to_regclass('kg.concept_achievements') IS NOT NULL AS ca
      `)
    ).rows[0];

    // 1. 수학 개념 노드 (concept:{id})
    if (id.startsWith("concept:") && reg.mc) {
      const cid = Number.parseInt(id.replace("concept:", ""), 10);
      if (!Number.isFinite(cid)) return null;
      const row = (
        await c.query<{
          id: number;
          source_id: number;
          merged_source_ids: number[];
          title: string;
          statement: string;
          html_title: string | null;
          html_statement: string | null;
          concept_type: string | null;
          math_field: string | null;
          curriculum_type: string | null;
          school_type: string | null;
          curriculum_year: string | null;
          difficulty_level: number | null;
          img_path: string | null;
          merge_notes: unknown;
          written_by: string | null;
          written_at: string | null;
        }>(`
          SELECT id::int, source_id, merged_source_ids, title, statement, html_title, html_statement,
                 concept_type, math_field, curriculum_type, school_type, curriculum_year,
                 difficulty_level, img_path, merge_notes, written_by, written_at::text
            FROM kg.math_concepts
           WHERE id = $1
        `, [cid])
      ).rows[0];
      if (!row) return null;

      const unitEdges = reg.cue
        ? (
            await c.query<{
              id: number;
              unit_id: string;
              unit_name: string;
              unit_level: number;
              is_primary: boolean;
              is_active: boolean;
              confidence: string | null;
              judged_by: string;
              rationale: string | null;
              created_at: string;
            }>(`
              SELECT ce.id::int, ce.unit_id, COALESCE(n.props->>'name', ce.unit_id) AS unit_name,
                     COALESCE((n.props->>'level')::int, 3) AS unit_level,
                     ce.is_primary, ce.is_active, ce.confidence::text, ce.judged_by, ce.rationale,
                     ce.created_at::text
                FROM kg.concept_unit_edges ce
                LEFT JOIN kg.nodes n ON n.id = ce.unit_id
               WHERE ce.concept_id = $1
               ORDER BY ce.is_active DESC, ce.is_primary DESC, ce.id DESC
            `, [cid])
          ).rows
        : [];

      const achievements = reg.ca
        ? (
            await c.query<{ achievement_code: string; judged_by: string }>(`
              SELECT achievement_code, judged_by FROM kg.concept_achievements WHERE concept_id = $1 ORDER BY achievement_code
            `, [cid])
          ).rows
        : [];

      const prereqs = reg.cp
        ? (
            await c.query<{
              id: number;
              source_id: number;
              title: string;
              dir: "prereq" | "next";
              judged_by: string;
            }>(`
              SELECT mc.id::int, mc.source_id, mc.title,
                     CASE WHEN cp.dst_concept_id = $1 THEN 'prereq' ELSE 'next' END AS dir,
                     cp.judged_by
                FROM kg.concept_prerequisites cp
                JOIN kg.math_concepts mc ON mc.id = CASE WHEN cp.dst_concept_id = $1 THEN cp.src_concept_id ELSE cp.dst_concept_id END
               WHERE cp.src_concept_id = $1 OR cp.dst_concept_id = $1
            `, [cid])
          ).rows
        : [];

      return {
        id,
        nodeType: "concept" as const,
        concept: {
          id: row.id,
          sourceId: row.source_id,
          mergedSourceIds: row.merged_source_ids ?? [],
          title: stripHtml(row.title),
          rawTitle: row.title,
          statement: stripHtml(row.statement),
          rawStatement: row.statement,
          htmlStatement: row.html_statement,
          images: extractImages(row.statement || row.html_statement, row.img_path),
          conceptType: row.concept_type,
          mathField: row.math_field,
          curriculumType: row.curriculum_type,
          schoolType: row.school_type,
          curriculumYear: row.curriculum_year,
          difficultyLevel: row.difficulty_level,
          mergeNotes: row.merge_notes,
          writtenBy: row.written_by,
          writtenAt: row.written_at,
        },
        unitEdges: unitEdges.map((e) => ({
          id: e.id,
          unitId: e.unit_id,
          unitName: e.unit_name,
          unitLevel: e.unit_level,
          isPrimary: e.is_primary,
          isActive: e.is_active,
          confidence: e.confidence != null ? Number(e.confidence) : null,
          judgedBy: e.judged_by,
          rationale: e.rationale,
          createdAt: e.created_at,
        })),
        achievements,
        prereqConcepts: prereqs.filter((p) => p.dir === "prereq").map((p) => ({
          id: `concept:${p.id}`,
          conceptId: p.id,
          sourceId: p.source_id,
          title: stripHtml(p.title),
          judgedBy: p.judged_by,
        })),
        nextConcepts: prereqs.filter((p) => p.dir === "next").map((p) => ({
          id: `concept:${p.id}`,
          conceptId: p.id,
          sourceId: p.source_id,
          title: stripHtml(p.title),
          judgedBy: p.judged_by,
        })),
      };
    }

    // 2. 성취기준 노드 (ach:{code})
    if (id.startsWith("ach:") && reg.ca && reg.mc) {
      const code = id.replace("ach:", "");
      const concepts = (
        await c.query<{ id: number; source_id: number; title: string; concept_type: string | null; judged_by: string }>(`
          SELECT mc.id::int, mc.source_id, mc.title, mc.concept_type, ca.judged_by
            FROM kg.concept_achievements ca
            JOIN kg.math_concepts mc ON mc.id = ca.concept_id
           WHERE ca.achievement_code = $1
           ORDER BY mc.id
        `, [code])
      ).rows;
      return {
        id,
        nodeType: "achievement" as const,
        code,
        concepts: concepts.map((x) => ({
          id: `concept:${x.id}`,
          conceptId: x.id,
          sourceId: x.source_id,
          title: stripHtml(x.title),
          conceptType: x.concept_type,
          judgedBy: x.judged_by,
        })),
      };
    }

    // 3. 도서 노드 (book:{stem}) — kg.nodes 에 없어도 toc_unit_links / dictionary 에 있을 수 있음
    if (id.startsWith("book:")) {
      const stem = id.replace(/^book:/, "");
      const nodeRow = (await c.query<{ props: Record<string, unknown> }>(`SELECT props FROM kg.nodes WHERE id = $1`, [id])).rows[0];
      const tocLinks = (
        await c.query<{
          id: number;
          unit_id: string;
          unit_name: string;
          root_unit_id: string;
          node_id: string | null;
          toc_key: string;
          toc_label: string;
          toc_page: number | null;
          page: number | null;
          page_kind: string | null;
          book_title: string;
        }>(`
          SELECT tl.id::int, tl.unit_id, COALESCE(u.props->>'name', tl.unit_id) AS unit_name,
                 tl.root_unit_id, tl.node_id, tl.toc_key, tl.toc_label, tl.toc_page, tl.page, tl.page_kind, tl.book_title
            FROM kg.toc_unit_links tl
            LEFT JOIN kg.nodes u ON u.id = tl.unit_id
           WHERE tl.book_stem = $1
           ORDER BY tl.id ASC
        `, [stem])
      ).rows;

      const dictionary = (
        await c.query(`
          SELECT id::int, term, english_term, chapter_title, definition, formula, geometric_meaning, pages
            FROM kg.dictionary WHERE book_stem = $1 ORDER BY term ASC LIMIT 100
        `, [stem])
      ).rows;

      const flashcards = (
        await c.query(`
          SELECT id::int, chapter_title, front, back, hint, formula, pages
            FROM kg.flashcards WHERE book_stem = $1 ORDER BY id ASC LIMIT 60
        `, [stem])
      ).rows;

      const quizzes = (
        await c.query(`
          SELECT id::int, chapter_title, question, options, correct_option_id, explanation, pages
            FROM kg.quizzes WHERE book_stem = $1 ORDER BY id ASC LIMIT 60
        `, [stem])
      ).rows;

      return {
        id,
        nodeType: "book" as const,
        stem,
        title: (nodeRow?.props?.title as string) || tocLinks[0]?.book_title || stem,
        props: nodeRow?.props ?? { stem, title: tocLinks[0]?.book_title ?? stem },
        tocLinks,
        dictionary,
        flashcards,
        quizzes,
      };
    }

    // 4. kg.nodes (level / level_toc / toc / page / paragraph)
    const nodeRow = (
      await c.query<{ id: string; type: string; book: string; props: Record<string, unknown> }>(
        `SELECT id, type, book, props FROM kg.nodes WHERE id = $1`,
        [id]
      )
    ).rows[0];
    if (!nodeRow) return null;

    const labelExpr = `COALESCE(n.props->>'name', n.props->>'label', n.props->>'title',
      CASE WHEN n.type = 'page' THEN (n.props->>'page') || 'p' END,
      CASE WHEN n.type = 'paragraph' THEN (n.props->>'kind') || ' #' || ((n.props->>'idx')::int + 1) END, n.id)`;

    const outEdges = (
      await c.query<{ type: string; id: string; nodeType: string; label: string; category: string | null }>(`
        SELECT e.type, n.id, n.type AS "nodeType", ${labelExpr} AS label, n.props->>'category' AS category
          FROM kg.edges e JOIN kg.nodes n ON n.id = e.dst
         WHERE e.src = $1
         ORDER BY e.type, COALESCE((n.props->>'order')::int, (n.props->>'page')::int, (n.props->>'idx')::int, 0)
      `, [id])
    ).rows;

    const inEdges = (
      await c.query<{ type: string; id: string; nodeType: string; label: string; category: string | null }>(`
        SELECT e.type, n.id, n.type AS "nodeType", ${labelExpr} AS label, n.props->>'category' AS category
          FROM kg.edges e JOIN kg.nodes n ON n.id = e.src
         WHERE e.dst = $1
         ORDER BY e.type, label
      `, [id])
    ).rows;

    // Level / Level TOC 노드이면 매핑된 개념 목록 + 교재 TOC 등록 목록 + 연관 사전·퀴즈도 함께 조회
    if (nodeRow.type === "level") {
      const concepts =
        reg.mc && reg.cue
          ? (
              await c.query<{
                id: number;
                source_id: number;
                merged_count: number;
                title: string;
                statement: string;
                concept_type: string | null;
                math_field: string | null;
                school_type: string | null;
                unit_id: string;
                unit_name: string;
                is_primary: boolean;
                confidence: string | null;
                judged_by: string;
                rationale: string | null;
              }>(`
                WITH target_units AS (
                  SELECT $1::text AS uid
                  UNION
                  SELECT e.dst FROM kg.edges e WHERE e.src = $1 AND e.type = 'HAS_CHILD'
                )
                SELECT mc.id::int,
                       mc.source_id,
                       cardinality(mc.merged_source_ids)::int AS merged_count,
                       mc.title,
                       mc.statement,
                       mc.concept_type,
                       mc.math_field,
                       mc.school_type,
                       ce.unit_id,
                       COALESCE(un.props->>'name', ce.unit_id) AS unit_name,
                       ce.is_primary,
                       ce.confidence::text,
                       ce.judged_by,
                       ce.rationale
                  FROM kg.concept_unit_edges ce
                  JOIN kg.math_concepts mc ON mc.id = ce.concept_id
                  LEFT JOIN kg.nodes un ON un.id = ce.unit_id
                 WHERE ce.is_active = true
                   AND mc.source_id > 0
                   AND ce.unit_id IN (SELECT uid FROM target_units)
                 ORDER BY (ce.unit_id = $1) DESC, ce.is_primary DESC, mc.id ASC
                 LIMIT 120
              `, [id])
            ).rows.map((r) => ({
              id: `concept:${r.id}`,
              conceptId: r.id,
              sourceId: r.source_id,
              mergedCount: r.merged_count,
              title: stripHtml(r.title),
              snippet: stripHtml(r.statement).slice(0, 140),
              conceptType: r.concept_type,
              mathField: r.math_field,
              schoolType: r.school_type,
              unitId: r.unit_id,
              unitName: r.unit_name,
              isPrimary: r.is_primary,
              confidence: r.confidence != null ? Number(r.confidence) : null,
              judgedBy: r.judged_by,
              rationale: r.rationale,
            }))
          : [];

      const tocLinks = (
        await c.query<{
          id: number;
          unit_id: string;
          root_unit_id: string;
          node_id: string | null;
          book_stem: string;
          book_title: string;
          toc_key: string;
          toc_label: string;
          toc_page: number | null;
          page: number | null;
          page_kind: string | null;
        }>(`
          SELECT id::int, unit_id, root_unit_id, node_id, book_stem, book_title, toc_key, toc_label, toc_page, page, page_kind
            FROM kg.toc_unit_links
           WHERE unit_id = $1 OR root_unit_id = $1 OR node_id = $1
           ORDER BY id ASC
           LIMIT 100
        `, [id])
      ).rows;

      const unitName = String(nodeRow.props.name ?? "");
      const stems = [...new Set(tocLinks.map((t) => t.book_stem))];

      const dictionary = (
        await c.query(
          `SELECT id::int, book_stem, book_title, chapter_title, term, english_term, definition, formula, pages
             FROM kg.dictionary
            WHERE ($1::text <> '' AND (chapter_title ILIKE '%' || $1 || '%' OR term ILIKE '%' || $1 || '%'))
               OR (cardinality($2::text[]) > 0 AND book_stem = ANY($2::text[]))
            ORDER BY ($1::text <> '' AND (chapter_title ILIKE '%' || $1 || '%' OR term ILIKE '%' || $1 || '%')) DESC, term ASC
            LIMIT 40`,
          [unitName, stems]
        )
      ).rows;

      const quizzes = (
        await c.query(
          `SELECT id::int, book_stem, book_title, chapter_title, question, options, correct_option_id, explanation, pages
             FROM kg.quizzes
            WHERE ($1::text <> '' AND chapter_title ILIKE '%' || $1 || '%')
               OR (cardinality($2::text[]) > 0 AND book_stem = ANY($2::text[]))
            ORDER BY id ASC
            LIMIT 25`,
          [unitName, stems]
        )
      ).rows;

      const flashcards = (
        await c.query(
          `SELECT id::int, book_stem, book_title, chapter_title, front, back, hint, formula, pages
             FROM kg.flashcards
            WHERE ($1::text <> '' AND chapter_title ILIKE '%' || $1 || '%')
               OR (cardinality($2::text[]) > 0 AND book_stem = ANY($2::text[]))
            ORDER BY id ASC
            LIMIT 25`,
          [unitName, stems]
        )
      ).rows;

      return {
        id: nodeRow.id,
        nodeType: (nodeRow.props.category === "TOC" ? "level_toc" : "level") as GraphNodeType,
        props: nodeRow.props,
        out: outEdges,
        in: inEdges,
        concepts,
        tocLinks,
        dictionary,
        quizzes,
        flashcards,
      };
    }

    return {
      id: nodeRow.id,
      nodeType: nodeRow.type as GraphNodeType,
      book: nodeRow.book,
      props: nodeRow.props,
      out: outEdges,
      in: inEdges,
    };
  });
}

export type GraphSearchItem = {
  id: string;
  nodeType: GraphNodeType | "dictionary";
  title: string;
  subtitle: string;
  unitId?: string;
  bookStem?: string;
};

export async function searchGraphNodes(query: string, limit = 30): Promise<GraphSearchItem[]> {
  const q = query.trim();
  if (!q) return [];
  return withReadOnly(async (c) => {
    const reg = (
      await c.query<{ mc: boolean; cue: boolean }>(`
        SELECT to_regclass('kg.math_concepts') IS NOT NULL AS mc,
               to_regclass('kg.concept_unit_edges') IS NOT NULL AS cue
      `)
    ).rows[0];

    const out: GraphSearchItem[] = [];
    const like = `%${q}%`;

    // 1. 단원·TOC·도서 노드
    const nRows = (
      await c.query<{
        id: string;
        type: string;
        name: string;
        category: string | null;
        level: number | null;
        grade: number | null;
      }>(`
        SELECT id,
               type,
               COALESCE(props->>'name', props->>'label', props->>'title', id) AS name,
               props->>'category' AS category,
               (props->>'level')::int AS level,
               (props->>'grade')::int AS grade
          FROM kg.nodes
         WHERE id ILIKE $1
            OR props->>'name' ILIKE $1
            OR props->>'label' ILIKE $1
            OR props->>'title' ILIKE $1
         ORDER BY (type = 'level') DESC, COALESCE((props->>'level')::int, 9), id
         LIMIT $2
      `, [like, Math.ceil(limit / 2)])
    ).rows;

    for (const r of nRows) {
      const nodeType: GraphNodeType =
        r.type === "level" && r.category === "TOC" ? "level_toc" : (r.type as GraphNodeType);
      const sub =
        r.type === "level"
          ? `Level ${r.level ?? ""} · ${r.category ?? "영역"}${r.grade ? ` · 중${r.grade}` : ""} (${r.id})`
          : `${r.type} · ${r.id}`;
      out.push({
        id: r.id,
        nodeType,
        title: r.name,
        subtitle: sub,
        unitId: r.type === "level" ? r.id : undefined,
      });
    }

    // 2. 수학 개념 (kg.math_concepts)
    if (reg.mc) {
      const cRows = (
        await c.query<{
          id: number;
          source_id: number;
          title: string;
          concept_type: string | null;
          unit_id: string | null;
          unit_name: string | null;
        }>(`
          SELECT mc.id::int,
                 mc.source_id,
                 mc.title,
                 mc.concept_type,
                 ${reg.cue ? `(SELECT ce.unit_id FROM kg.concept_unit_edges ce WHERE ce.concept_id = mc.id AND ce.is_active = true ORDER BY ce.is_primary DESC LIMIT 1)` : `NULL`} AS unit_id,
                 ${reg.cue ? `(SELECT n.props->>'name' FROM kg.concept_unit_edges ce JOIN kg.nodes n ON n.id = ce.unit_id WHERE ce.concept_id = mc.id AND ce.is_active = true ORDER BY ce.is_primary DESC LIMIT 1)` : `NULL`} AS unit_name
            FROM kg.math_concepts mc
           WHERE mc.source_id > 0
             AND (mc.title ILIKE $1 OR mc.source_id::text = $2)
           ORDER BY (mc.source_id::text = $2) DESC, mc.id ASC
           LIMIT $3
        `, [like, q.replace(/^#/, ""), Math.ceil(limit / 2)])
      ).rows;

      for (const r of cRows) {
        out.push({
          id: `concept:${r.id}`,
          nodeType: "concept",
          title: stripHtml(r.title) || `개념 #${r.source_id}`,
          subtitle: `개념 #${r.source_id}${r.concept_type ? ` · ${r.concept_type}` : ""}${r.unit_name ? ` → ${r.unit_name}` : ""}`,
          unitId: r.unit_id ?? undefined,
        });
      }
    }

    // 3. 용어 사전 (kg.dictionary)
    if (out.length < limit) {
      const dRows = (
        await c.query<{ term: string; english_term: string | null; book_stem: string; book_title: string | null; chapter_title: string | null }>(`
          SELECT term, english_term, book_stem, book_title, chapter_title
            FROM kg.dictionary
           WHERE term ILIKE $1 OR english_term ILIKE $1
           ORDER BY term ASC
           LIMIT $2
        `, [like, limit - out.length])
      ).rows;
      for (const d of dRows) {
        out.push({
          id: `book:${d.book_stem}`,
          nodeType: "dictionary",
          title: `${d.term}${d.english_term ? ` (${d.english_term})` : ""}`,
          subtitle: `사전 · ${d.book_title || d.book_stem}${d.chapter_title ? ` › ${d.chapter_title}` : ""}`,
          bookStem: d.book_stem,
        });
      }
    }

    return out.slice(0, limit);
  });
}

