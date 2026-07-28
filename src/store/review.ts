import { pool, withTransaction } from '../db';
import { applySm2, dueAtFromInterval, normalizeSm2State } from '../services/sm2';

export interface ReviewArtifact {
  id: string;
  nuggetId: string;
  userId: string;
  kind: string;
  front: string;
  back: string;
  status: string;
  easeFactor: number;
  intervalDays: number;
  dueAt: string | null;
  createdAt: string;
  collectionId: string;
  collectionTitle: string;
}

export interface RecallAttempt {
  id: string;
  artifactId: string;
  userId: string;
  result: string;
  responseTimeMs: number | null;
  attemptedAt: string;
  nextDueAt: string;
  intervalDays: number;
}

function rowToReviewArtifact(r: Record<string, unknown>): ReviewArtifact {
  return {
    id:               r.id as string,
    nuggetId:         r.nugget_id as string,
    userId:           r.user_id as string,
    kind:             r.kind as string,
    front:            r.front as string,
    back:             r.back as string,
    status:           r.status as string,
    easeFactor:       Number(r.ease_factor),
    intervalDays:     Number(r.interval_days),
    dueAt:            r.due_at as string | null,
    createdAt:        r.created_at as string,
    collectionId:     r.collection_id as string,
    collectionTitle:  r.collection_title as string,
  };
}

export async function getDueArtifacts(userId: string, limit = 20): Promise<ReviewArtifact[]> {
  const { rows } = await pool.query(
    `SELECT a.*, col.id AS collection_id, col.title AS collection_title
     FROM artifacts a
     JOIN nuggets n ON a.nugget_id = n.id
     JOIN collections col ON n.collection_id = col.id
     WHERE a.user_id = $1
       AND a.status = 'accepted'
       AND (a.due_at IS NULL OR a.due_at <= NOW())
     ORDER BY a.due_at ASC NULLS FIRST
     LIMIT $2`,
    [userId, limit],
  );
  return rows.map(rowToReviewArtifact);
}

export async function getSessionsForCollection(collectionId: string, userId: string) {
  const { rows } = await pool.query(
    `SELECT s.*,
       (SELECT count(*) FROM captures c WHERE c.session_id = s.id)::int AS capture_count,
       (SELECT count(*) FROM nuggets n
          JOIN captures c ON n.capture_id = c.id WHERE c.session_id = s.id)::int AS nugget_count,
       (SELECT count(*) FROM artifacts a
          JOIN nuggets n ON a.nugget_id = n.id
          JOIN captures c ON n.capture_id = c.id WHERE c.session_id = s.id)::int AS artifact_count
     FROM sessions s
     WHERE s.collection_id = $1 AND s.user_id = $2
     ORDER BY s.started_at DESC`,
    [collectionId, userId],
  );
  return rows.map((r: Record<string, unknown>) => ({
    id:            r.id as string,
    collectionId:  r.collection_id as string,
    userId:        r.user_id as string,
    inputMode:     r.input_mode as string,
    status:        r.status as string,
    captureCount:  Number(r.capture_count),
    nuggetCount:   Number(r.nugget_count),
    artifactCount: Number(r.artifact_count),
    startedAt:     r.started_at as string,
    completedAt:   r.completed_at as string | null,
  }));
}

export interface UserStats {
  totalAccepted: number;
  reviewedToday: number;
  dueNow: number;
  streakDays: number;
  totalCollections: number;
  totalNuggets: number;
}

export async function getUserStats(userId: string): Promise<UserStats> {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*) FROM artifacts WHERE user_id = $1 AND status = 'accepted')::int AS total_accepted,
       (SELECT count(*) FROM recall_attempts WHERE user_id = $1 AND attempted_at >= NOW() - INTERVAL '24 hours')::int AS reviewed_today,
       (SELECT count(*) FROM artifacts WHERE user_id = $1 AND status = 'accepted' AND (due_at IS NULL OR due_at <= NOW()))::int AS due_now,
       (SELECT count(*) FROM collections WHERE user_id = $1)::int AS total_collections,
       (SELECT count(*) FROM nuggets WHERE user_id = $1)::int AS total_nuggets`,
    [userId],
  );
  const r = rows[0];

  // Streak: count consecutive days with at least one recall attempt going back from today
  const { rows: streakRows } = await pool.query(
    `WITH daily AS (
       SELECT date_trunc('day', attempted_at AT TIME ZONE 'UTC') AS day
       FROM recall_attempts
       WHERE user_id = $1
       GROUP BY 1
     ),
     numbered AS (
       SELECT day, row_number() OVER (ORDER BY day DESC) AS rn
       FROM daily
     )
     SELECT count(*)::int AS streak
     FROM numbered
     WHERE day = (date_trunc('day', NOW()) - (rn - 1) * INTERVAL '1 day')`,
    [userId],
  );

  return {
    totalAccepted:     Number(r.total_accepted),
    reviewedToday:     Number(r.reviewed_today),
    dueNow:            Number(r.due_now),
    streakDays:        Number(streakRows[0]?.streak ?? 0),
    totalCollections:  Number(r.total_collections),
    totalNuggets:      Number(r.total_nuggets),
  };
}

// SM-2 spaced repetition update
export async function recordRecallAttempt(input: {
  artifactId: string;
  userId: string;
  result: 'correct' | 'incorrect' | 'skipped';
  responseTimeMs?: number;
}): Promise<RecallAttempt> {
  return withTransaction(async (client) => {
    // Lock the row for the read-modify-write below so two concurrent reviews of
    // the same card can't both schedule from the same starting interval.
    const { rows: artRows } = await client.query(
      `SELECT ease_factor, interval_days FROM artifacts WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [input.artifactId, input.userId],
    );
    if (!artRows[0]) throw new Error('Artifact not found');

    const { easeFactor, intervalDays } = applySm2(
      normalizeSm2State({
        easeFactor:   Number(artRows[0].ease_factor),
        intervalDays: Number(artRows[0].interval_days),
      }),
      input.result,
    );

    const nextDueAt = dueAtFromInterval(intervalDays);

    if (input.result !== 'skipped') {
      await client.query(
        `UPDATE artifacts SET ease_factor = $1, interval_days = $2, due_at = $3 WHERE id = $4`,
        [easeFactor, intervalDays, nextDueAt, input.artifactId],
      );
    }

    // Same transaction as the reschedule above, so a card can never be
    // rescheduled without the attempt that caused it being recorded.
    const { rows } = await client.query(
      `INSERT INTO recall_attempts (artifact_id, user_id, result, response_time_ms)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.artifactId, input.userId, input.result, input.responseTimeMs ?? null],
    );
    const r = rows[0];
    return {
      id:             r.id as string,
      artifactId:     r.artifact_id as string,
      userId:         r.user_id as string,
      result:         r.result as string,
      responseTimeMs: r.response_time_ms as number | null,
      attemptedAt:    r.attempted_at as string,
      nextDueAt,
      intervalDays,
    };
  });
}
