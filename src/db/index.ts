import 'dotenv/config';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function initSchema(): Promise<void> {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}
