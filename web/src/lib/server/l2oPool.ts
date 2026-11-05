import { Pool } from "pg";

// KG Postgres 연결 (l2o 스키마: db/l2o-schema.sql, npm run db:l2o 로 적용)
export const pool = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
