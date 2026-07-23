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

// Reset any captures that were left mid-processing when the server last restarted.
// They'll be re-queued the next time the client polls for session status.
export async function resetStuckCaptures(): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE captures SET processing_status = 'pending'
     WHERE processing_status = 'extracting'`,
  );
  if ((rowCount ?? 0) > 0) {
    console.log({ event: 'stuck_captures_reset', count: rowCount });
  }
}

// Prune expired refresh tokens so the table doesn't grow unboundedly.
export async function pruneExpiredTokens(): Promise<void> {
  const { rowCount } = await pool.query(
    `DELETE FROM refresh_tokens WHERE expires_at < NOW()`,
  );
  if ((rowCount ?? 0) > 0) {
    console.log({ event: 'expired_tokens_pruned', count: rowCount });
  }
}
