import 'dotenv/config';
import { Pool, type PoolClient } from 'pg';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max:                     parseInt(process.env.PG_POOL_MAX ?? '20', 10),
  idleTimeoutMillis:       30_000,
  connectionTimeoutMillis: 5_000,
  // Backstop against a single pathological query pinning a connection. Long
  // background work (Claude calls) happens outside the DB, so 15s is generous.
  statement_timeout:       15_000,
});

// Without this listener, an error on an *idle* client is emitted as an
// unhandled 'error' event on the pool, which terminates the process.
pool.on('error', (err: Error) => {
  logger.error({ event: 'pg_pool_error', err: err.message });
});

// Arbitrary but stable key. Two instances booting at once would otherwise run
// the same CREATE/ALTER statements concurrently and can deadlock against each
// other's DDL locks; the loser of this lock waits and then no-ops.
const SCHEMA_LOCK_KEY = 0x57524154;

export async function initSchema(): Promise<void> {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    // DDL plus backfills can take far longer than the pool-wide
    // statement_timeout, which is sized for request-path queries.
    await client.query('SET statement_timeout = 0');
    await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK_KEY]);
    try {
      await client.query(sql);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK_KEY]);
    }
  } finally {
    // Destroy rather than return to the pool: pg does not reset session state
    // on release, so this connection would keep statement_timeout = 0.
    client.release(true);
  }
}

// Anything that can run a query: the pool itself, or a client bound to an open
// transaction. Store functions accept this so a caller can compose several of
// them into one transaction without the store duplicating its SQL.
export type Queryable = Pick<PoolClient, 'query'>;

// Runs `fn` inside a single transaction on a dedicated connection. Every query
// in `fn` must go through the client it receives — using the module-level pool
// inside the callback would run outside the transaction.
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch((rollbackErr: unknown) =>
      logger.error({ event: 'tx_rollback_failed', err: String(rollbackErr) }),
    );
    throw err;
  } finally {
    client.release();
  }
}

// Reset any captures that were left mid-processing when the server last restarted.
// They'll be re-queued the next time the client polls for session status.
export async function resetStuckCaptures(): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE captures SET processing_status = 'pending'
     WHERE processing_status = 'extracting'`,
  );
  if ((rowCount ?? 0) > 0) {
    logger.info({ event: 'stuck_captures_reset', count: rowCount });
  }
}

// Prune expired refresh tokens so the table doesn't grow unboundedly.
export async function pruneExpiredTokens(): Promise<void> {
  const { rowCount } = await pool.query(
    `DELETE FROM refresh_tokens WHERE expires_at < NOW()`,
  );
  if ((rowCount ?? 0) > 0) {
    logger.info({ event: 'expired_tokens_pruned', count: rowCount });
  }
}
