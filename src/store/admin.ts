import { pool } from '../db';

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  callCount: number;
}

export interface UsageByDimension extends UsageSummary {
  key: string;
}

export async function getUsageSummary(opts: { since?: Date }): Promise<UsageSummary> {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(input_tokens), 0)::bigint  AS total_input_tokens,
       COALESCE(SUM(output_tokens), 0)::bigint AS total_output_tokens,
       COUNT(*)::int                            AS call_count
     FROM token_usage
     WHERE ($1::timestamptz IS NULL OR created_at >= $1)`,
    [opts.since ?? null],
  );
  const row = rows[0];
  return {
    totalInputTokens: Number(row.total_input_tokens),
    totalOutputTokens: Number(row.total_output_tokens),
    callCount: row.call_count,
  };
}

export async function getUsageByModel(opts: { since?: Date }): Promise<UsageByDimension[]> {
  const { rows } = await pool.query(
    `SELECT
       model AS key,
       COALESCE(SUM(input_tokens), 0)::bigint  AS total_input_tokens,
       COALESCE(SUM(output_tokens), 0)::bigint AS total_output_tokens,
       COUNT(*)::int                            AS call_count
     FROM token_usage
     WHERE ($1::timestamptz IS NULL OR created_at >= $1)
     GROUP BY model
     ORDER BY SUM(input_tokens) + SUM(output_tokens) DESC`,
    [opts.since ?? null],
  );
  return rows.map((row) => ({
    key: row.key,
    totalInputTokens: Number(row.total_input_tokens),
    totalOutputTokens: Number(row.total_output_tokens),
    callCount: row.call_count,
  }));
}

export async function getTopUsersByUsage(opts: {
  since?: Date;
  limit: number;
}): Promise<(UsageByDimension & { email: string })[]> {
  const { rows } = await pool.query(
    `SELECT
       u.id AS key,
       u.email,
       COALESCE(SUM(t.input_tokens), 0)::bigint  AS total_input_tokens,
       COALESCE(SUM(t.output_tokens), 0)::bigint AS total_output_tokens,
       COUNT(t.id)::int                           AS call_count
     FROM token_usage t
     JOIN users u ON u.id = t.user_id
     WHERE ($1::timestamptz IS NULL OR t.created_at >= $1)
     GROUP BY u.id, u.email
     ORDER BY SUM(t.input_tokens) + SUM(t.output_tokens) DESC
     LIMIT $2`,
    [opts.since ?? null, opts.limit],
  );
  return rows.map((row) => ({
    key: row.key,
    email: row.email,
    totalInputTokens: Number(row.total_input_tokens),
    totalOutputTokens: Number(row.total_output_tokens),
    callCount: row.call_count,
  }));
}

export interface StuckSession {
  id: string;
  collectionId: string;
  userId: string;
  status: string;
  startedAt: string;
}

export interface StuckCapture {
  id: string;
  sessionId: string;
  userId: string;
  processingStatus: string;
  createdAt: string;
}

// "Stuck" = still in a non-terminal state after longer than would ever be
// expected for normal processing (terminal states are complete/failed/done).
export async function getStuckSessions(olderThanMinutes: number): Promise<StuckSession[]> {
  const { rows } = await pool.query(
    `SELECT id, collection_id, user_id, status, started_at
     FROM sessions
     WHERE status IN ('active','processing')
       AND started_at < NOW() - ($1 || ' minutes')::interval
     ORDER BY started_at ASC`,
    [olderThanMinutes],
  );
  return rows.map((row) => ({
    id: row.id,
    collectionId: row.collection_id,
    userId: row.user_id,
    status: row.status,
    startedAt: row.started_at,
  }));
}

export async function getStuckCaptures(olderThanMinutes: number): Promise<StuckCapture[]> {
  const { rows } = await pool.query(
    `SELECT id, session_id, user_id, processing_status, created_at
     FROM captures
     WHERE processing_status IN ('pending','transcribing','extracting')
       AND created_at < NOW() - ($1 || ' minutes')::interval
     ORDER BY created_at ASC`,
    [olderThanMinutes],
  );
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    processingStatus: row.processing_status,
    createdAt: row.created_at,
  }));
}

export interface PendingArtifact {
  id: string;
  nuggetId: string;
  userId: string;
  kind: string;
  front: string;
  back: string;
  createdAt: string;
}

export async function getPendingArtifacts(opts: {
  limit: number;
  offset: number;
}): Promise<{ items: PendingArtifact[]; total: number }> {
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM artifacts WHERE status = 'pending_review'`,
  );
  const { rows } = await pool.query(
    `SELECT id, nugget_id, user_id, kind, front, back, created_at
     FROM artifacts
     WHERE status = 'pending_review'
     ORDER BY created_at ASC
     LIMIT $1 OFFSET $2`,
    [opts.limit, opts.offset],
  );
  return {
    total: countRows[0]?.count ?? 0,
    items: rows.map((row) => ({
      id: row.id,
      nuggetId: row.nugget_id,
      userId: row.user_id,
      kind: row.kind,
      front: row.front,
      back: row.back,
      createdAt: row.created_at,
    })),
  };
}
