import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from '../middleware/asyncHandler';

export const retentionGraphRouter = Router();

// GET /retention-graph/:collectionId
// Returns nuggets for a collection with proficiency scores (0–1) derived from
// recall attempt history. Nuggets with no attempts get a baseline from interval_days.
retentionGraphRouter.get('/:collectionId', asyncHandler(async (req, res) => {
  const userId       = res.locals.userId!;
  const collectionId = req.params.collectionId;

  // Verify the collection belongs to this user
  const collCheck = await pool.query(
    `SELECT id, title FROM collections WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`,
    [collectionId, userId],
  );
  if (!collCheck.rows.length) {
    return res.status(404).json({ error: { message: 'Collection not found' } });
  }
  const collection = collCheck.rows[0];

  // Fetch nuggets with aggregated recall stats across all their accepted artifacts
  const { rows } = await pool.query(
    `SELECT
       n.id,
       n.content                                          AS label,
       n.created_at,
       COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'accepted')   AS artifact_count,
       MAX(a.interval_days) FILTER (WHERE a.status = 'accepted')   AS max_interval,
       COUNT(ra.id)                                                  AS total_attempts,
       COUNT(ra.id) FILTER (WHERE ra.result = 'correct')            AS correct_attempts,
       MAX(ra.attempted_at)                                          AS last_reviewed_at
     FROM nuggets n
     LEFT JOIN artifacts a ON a.nugget_id = n.id AND a.user_id = $1
     LEFT JOIN recall_attempts ra ON ra.artifact_id = a.id AND ra.user_id = $1
     WHERE n.collection_id = $2 AND n.user_id = $1
     GROUP BY n.id, n.content, n.created_at
     ORDER BY n.created_at ASC`,
    [userId, collectionId],
  );

  const nodes = rows.map((r) => {
    const totalAttempts   = Number(r.total_attempts);
    const correctAttempts = Number(r.correct_attempts);
    const maxInterval     = Number(r.max_interval ?? 1);
    const artifactCount   = Number(r.artifact_count ?? 0);

    let proficiency: number;
    if (totalAttempts > 0) {
      // Blend recall rate (80%) with interval signal (20%) for stability
      const recallRate     = correctAttempts / totalAttempts;
      // interval_days caps SRS at ~21 days for well-known cards; normalise to 0–1
      const intervalScore  = Math.min(maxInterval / 21, 1);
      proficiency = recallRate * 0.8 + intervalScore * 0.2;
    } else if (artifactCount > 0) {
      // Has artifacts but never reviewed — low but non-zero baseline
      proficiency = 0.1;
    } else {
      // Newly extracted nugget, no artifacts yet
      proficiency = 0.05;
    }

    return {
      id:             r.id as string,
      label:          (r.label as string).slice(0, 80),
      proficiency:    Math.round(proficiency * 100) / 100,
      totalAttempts,
      correctAttempts,
      lastReviewedAt: r.last_reviewed_at as string | null,
      createdAt:      r.created_at as string,
    };
  });

  // Average proficiency across the collection
  const avgProficiency = nodes.length
    ? Math.round((nodes.reduce((s, n) => s + n.proficiency, 0) / nodes.length) * 100)
    : 0;

  res.json({
    collection: { id: collection.id as string, title: collection.title as string },
    nodes,
    avgProficiency,
  });
}));
